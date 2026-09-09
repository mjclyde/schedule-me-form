# schedule-me-form

A small, self-hosted appointment booker backed by Google Calendar.

> Point it at a Google calendar and say: *let people book 15-minute
> appointments anywhere this calendar is free.*

There is no slot database. Availability is derived from the calendar on every
request, and a confirmed booking **is** a calendar event. People book from a
public page with just a name and a phone number; they manage their bookings
through a one-time code sent by SMS.

- **Architecture and rationale:** [`docs/calendar-pivot-plan.md`](docs/calendar-pivot-plan.md)
- **End-to-end local walkthrough:** [`docs/testing-the-pivot.md`](docs/testing-the-pivot.md)

---

## How availability works

This is the one concept worth understanding before anything else.

**A bookable window is a *timed* event on the calendar with `Show as: Free`.**
Title and description are ignored — there is no naming convention to remember.

| On the calendar | Effect |
| --- | --- |
| Timed event, **Show as: Free** | Bookable window |
| Timed event, Show as: Busy | Blocks bookings |
| All-day event, Show as: Busy | Blocks bookings |
| All-day event, **Show as: Free** | **Ignored entirely** |
| A booking this app made | Blocks bookings (written as Busy) |

All-day Free events are ignored on purpose. Calendar clients commonly default
all-day events to Free, so honouring one would turn a whole day of "PTO" into
bookable time — the exact opposite of the intent.

Everything else on that calendar counts as busy, so **use a calendar you are
happy to have read as your availability.** A personal calendar full of
"dentist" entries works fine — the app only ever reads whether time is free,
never what the entries say — but a shared one exposes your bookings to
whoever else can write to it.

### Marking a window Free

In Google Calendar: create an event → open it → set **Busy** to **Free** in
the availability dropdown → save. Repeat, or make it recurring. That is the
whole authoring workflow; the app has no availability editor and does not
need one.

Bookings are written back to the same calendar as Busy events, tagged in
`extendedProperties.private` so the app can find its own again. That tagging
is also how double-booking is prevented: a booking occupies the window the
same way any other Busy event does.

---

## Setup

### Prerequisites

- Node 20, MongoDB 7 (`docker compose up mongo -d` starts one).
- **`.npmrc` at the repo root.** `@ncss/api-decorator` is a private package and
  the file is gitignored, so `npm install` fails without it.
- A **Google Cloud OAuth client** (type: Web application) with the Calendar API
  enabled and your redirect URI registered.
- A **Twilio** account. SMS is not optional: `NotificationService` builds its
  client in the constructor, so the server will not start without credentials.

### `backend/.env` (gitignored)

```sh
ENV=DEV                              # PROD also starts the reminder cron
DB_URI=mongodb://localhost:27017
DB_NAME=schedule-me
PORT=3000

GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
GOOGLE_REDIRECT_URL=http://localhost:3000/GoogleAuth/Redirect
# OAUTH_STATE_SECRET is optional; it falls back to GOOGLE_CLIENT_SECRET.

TWILIO_SID=...
TWILIO_SECRET_TOKEN=...
TWILIO_MESSAGING_SERVICE_ID=...
```

### `frontend/.env`

This file **is** tracked and points at production. For local work, flip it and
don't commit the change:

```sh
VITE_API_HOST="http://localhost:3000"
```

### Run it

```sh
docker compose up mongo -d
cd backend  && npm install && npm run dev     # :3000
cd frontend && npm install && npm run dev     # :5173
```

---

## Linking a calendar

There is no admin UI yet, so setup is three CLI steps. The full version with
expected output is in [the runbook](docs/testing-the-pivot.md).

**1. Create the owner and get a one-time code.** The OTP flow cannot bootstrap
itself — an OTP needs a person, and people are otherwise only created by
booking — so the first person is made server-side:

```sh
cd backend
npm run owner -- "+15555550100" "Your Name"
# ->   ownerPersonId : 6712...
#      otp           : a1b2c3
```

**2. Link the Google account.** `/Google/AuthUrl` returns JSON rather than
redirecting, because a redirect cannot carry the `Authorization` header:

```sh
export API=http://localhost:3000
curl -H "Authorization: a1b2c3" $API/Google/AuthUrl   # -> {"url": "https://accounts.google.com/..."}
# open that url, approve, land on "Google Account Linked"
curl -H "Authorization: a1b2c3" $API/Google/Calendars # -> pick the calendarId
```

**3. Seed a schedule** — the config object that ties a public URL to that
calendar. It stays server-side because it names the owner's calendar and
carries the phone numbers notified on every booking:

```jsonc
// my-schedule.json
{
  "_id": "2026spring",              // the slug in the public URL
  "name": "Spring Tune-Ups 2026",
  "type": "Tune-Up",                // used in SMS copy
  "description": "15-minute tune-up appointments.",
  "ownerPersonId": "6712...",       // from step 1
  "calendarId": "you@example.com",  // from step 2
  "timeZone": "America/Denver",
  "durationMins": 15,
  "startDate": "2026-03-01",        // optional; when sign-ups open
  "endDate": "2026-05-31"           // optional; the last bookable day
}
```

```sh
npm run schedule -- ./my-schedule.json
```

The booking page is then `/?scheduleId=2026spring`.

---

## Scripts

Run from `backend/`:

| Command | What it does |
| --- | --- |
| `npm run dev` | API with reload on :3000 |
| `npm test` | Mocha + nyc |
| `npm run build` | `tsc` to `dist/` |
| `npm run owner -- "<phone>" "<name>"` | Create a person and mint an OTP |
| `npm run schedule -- <file.json>` | Create or update a schedule |
| `npm run reminders` | Run one reminder sweep by hand (**sends real SMS**) |
| `npm run drop-slot-data` | Retire the pre-pivot `slots`/`events` collections (dry run; `-- --confirm` to apply) |

In production the reminder sweep runs on a cron at `0 12-18 * * *`. It looks
ahead to the **end of tomorrow**, not a rolling 24 hours: since the cron never
runs in the evening, a rolling window would never reach tomorrow night, and a
19:00 appointment would first be seen at noon on the day itself.

---

## API

Auth is a one-time code in a bare `Authorization` header — `Authorization: a1b2c3`,
no `Bearer` scheme.

| Endpoint | Auth | Purpose |
| --- | --- | --- |
| `GET /Schedules/:id` | public | Schedule config, minus the owner's private fields |
| `GET /Schedules/:id/Availability?from=&to=` | public | Bookable slots in a range |
| `POST /Schedules/:id/Bookings` | public | Book a slot |
| `POST /Schedules/:id/CreateOTP` | public | Text a manage link to a known phone |
| `GET /Schedule` | OTP | Which schedule this OTP was minted for |
| `GET /MyBookings` | OTP | This person's bookings, ~90 days back |
| `DELETE /Bookings/:id?scheduleId=` | OTP | Cancel; texts both parties |
| `GET /Bookings/:id/CalendarEvent?scheduleId=` | OTP | `.ics` download |
| `GET /Me`, `GET /Google/*` | OTP | Owner account and calendar linking |

The two public read endpoints go through `Schedule.toPublic()`, which strips
`calendarId`, `ownerPersonId` and `notify`. Adding a field to the public shape
means deciding it is public.

`POST /Schedules/:id/CreateOTP` answers `204` whether or not the phone is
known, and sends nothing to an unknown one, so the form cannot be used to test
which numbers are customers.

---

## Layout

```
backend/src/
  api/            route handlers (schedules, bookings, persons)
  google/         calendar client, booking tags, pure availability maths
  models/         Mongo documents (schedule, person, notification)
  services/       data access, availability, notifications
  scripts/        CLI entry points
  reminders.ts    the day-before sweep
common/           types shared by both halves
frontend/src/     Vue 3 + Pinia
docs/             architecture plan and local runbook
```

Mongo holds only `persons` (identity, OTP, Google tokens), `schedules`
(config) and `notifications` (SMS audit log). No appointment data.

## Known gaps

- **No admin UI.** Schedules are created by the CLI above.
- **One booking per window.** Group slots would need a different encoding; see
  §10 of the plan.
- **Editing a booking directly in Google Calendar** changes app state silently,
  with no cancellation SMS. An accepted cost of the design; §4 of the plan
  covers why, and what would close it.
