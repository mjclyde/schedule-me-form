# Testing the calendar pivot locally

A walkthrough for booking a real appointment against a real Google calendar,
end to end, and then managing it. See `README.md` for setup and the concepts,
and `calendar-pivot-plan.md` for the architecture and what is still missing.

## 0. Prerequisites

- **`.npmrc` at the repo root.** `@ncss/api-decorator` is private and
  gitignored, so `npm install` fails without it. Nothing else in the project
  needs it.
- **A Google Cloud OAuth client** (Web application) with the Calendar API
  enabled, and `http://localhost:3000/GoogleAuth/Redirect` added as an
  authorized redirect URI.
- **`backend/.env`** (gitignored):

  ```sh
  ENV=DEV
  DB_URI=mongodb://localhost:27017
  DB_NAME=schedule-me
  PORT=3000

  GOOGLE_CLIENT_ID=...
  GOOGLE_CLIENT_SECRET=...
  GOOGLE_REDIRECT_URL=http://localhost:3000/GoogleAuth/Redirect
  # OAUTH_STATE_SECRET is optional; it falls back to GOOGLE_CLIENT_SECRET.

  # Required. NotificationService builds a Twilio client in its constructor,
  # which throws on a missing SID — so the server and `npm run reminders` both
  # fail to start without these, not just the SMS.
  TWILIO_SID=...
  TWILIO_SECRET_TOKEN=...
  TWILIO_MESSAGING_SERVICE_ID=...
  ```

- **`frontend/.env`** — point it at the local API (the committed value is
  production):

  ```sh
  VITE_API_HOST="http://localhost:3000"
  ```

## 1. Start Mongo and the API

```sh
docker compose up mongo -d
cd backend && npm install && npm run dev
export API=http://localhost:3000
```

## 2. Create the owner and link a calendar

The OTP flow cannot bootstrap itself — `createOTP` updates an existing person
rather than upserting, and persons are otherwise only created by booking. So
the first person has to be made server-side:

```sh
npm run owner -- "+15555550100" "Your Name"
# ->   ownerPersonId : 6712...
#      otp           : a1b2c3
```

Then link your Google account. `/Google/AuthUrl` returns the consent URL as
JSON rather than redirecting, because a redirect cannot carry the OTP header:

```sh
curl -H "Authorization: <otp>" $API/Google/AuthUrl
# open the returned url in a browser, approve, land on "Google Account Linked"

curl -H "Authorization: <otp>" $API/Google/Calendars
# pick the `id` of the calendar you want to book against
```

## 3. Mark some availability

In Google Calendar, on the calendar you just picked, create a **timed** event
and set **Show as: Free**. Title and description don't matter.

Two rules to know:
- **All-day Free events are ignored.** Calendar clients commonly default
  all-day events to Free, and honouring one would turn a whole day bookable.
- **Everything else on that calendar is busy** and blocks slots, so use a
  calendar you're happy to have read as your availability.

## 4. Seed a schedule

```jsonc
// my-schedule.json
{
  "_id": "testrun",
  "name": "Test Run",
  "type": "Tune-Up",
  "description": "15-minute appointments.",
  "ownerPersonId": "<from step 2>",
  "calendarId": "<from step 2>",
  "timeZone": "America/Denver",
  "durationMins": 15,
  "minNoticeMins": 0,
  "startDate": "2026-09-01",
  "endDate": "2026-11-30"
}
```

```sh
npm run schedule -- ./my-schedule.json   # re-runnable; upserts by _id
```

`minNoticeMins: 0` matters for a test — the default is 60, which hides
anything in the next hour.

## 5. Check availability over the API

```sh
curl "$API/Schedules/testrun"
curl "$API/Schedules/testrun/Availability?from=2026-09-07&to=2026-09-14"
```

Expect `{ timeZone, state, slots: [{ startAt, endAt }] }`. Slots have no ids —
they are derived per request, not stored.

If `slots` is empty, in order of likelihood: the Free event is all-day; it is
outside the `from`/`to` range; it is outside `startDate`/`endDate`; something
opaque overlaps it; or `minNoticeMins` is hiding it.

## 6. Book through the UI

```sh
cd frontend && npm install && npm run dev
```

Open `http://localhost:5173/?scheduleId=testrun`. Pick a day and time, fill in
name and phone, optionally an email, and book.

Then check: the appointment is on the Google calendar as a **busy** event, the
slot is gone from the page, and if you gave an email you have a calendar
invite.

Or straight over the API:

```sh
curl -X POST "$API/Schedules/testrun/Bookings" \
  -H 'Content-Type: application/json' \
  -d '{"startAt":"<startAt from step 5>","name":"Jane Doe","phone":"(555) 555-0123"}'
```

Responses worth provoking: `409` for a slot that is gone or already taken,
`422` for a time outside the schedule's date window.

**Book once with an email address.** The attendee-invite path
(`sendUpdates: "all"`) only runs when one is supplied, so a phone-only test
never exercises it. You should get a real Google Calendar invite.

## 7. Manage the booking

The confirmation SMS now carries a manage link (`/otp/<code>`). Open it, or go
to `http://localhost:5173/my-events?scheduleId=testrun` and enter the phone
number you booked with.

Over the API, with the OTP from the SMS:

```sh
curl -H "Authorization: <otp>" $API/MyBookings
# -> [{ id, scheduleId, scheduleName, scheduleType, startAt, endAt, timeZone, durationMins }]

curl -H "Authorization: <otp>" "$API/Bookings/<id>/CalendarEvent?scheduleId=testrun"
# -> an .ics body

curl -X DELETE -H "Authorization: <otp>" "$API/Bookings/<id>?scheduleId=testrun"
# -> 204, the calendar event is gone, and the slot is offered again
```

`scheduleId` is required on the two `/Bookings/:id` routes: a Google event id
does not name the calendar holding it. `/MyBookings` needs no id — it is scoped
to the person and covers every schedule they have booked.

Worth provoking: a `404` from `DELETE` using someone else's booking id, or an
event id you copied off the owner's calendar that the app did not create.
Both answer the same `404` on purpose.

## 8. Reminders

The cron only starts when `ENV=PROD`, so run one sweep by hand rather than
waiting on `0 12-18 * * *`. Book something for later today or tomorrow first:

```sh
npm run reminders
```

This sends **real** text messages to anyone with an appointment between now and
the end of tomorrow who has not already been reminded. Twilio credentials are
required to run it at all — see the note in §0.

After a successful sweep the calendar event gains a `reminderSentAt` in its
private extended properties, and a second sweep is a no-op — that stamp is the
only record that the reminder went out. Check it with:

```sh
curl -H "Authorization: <otp>" $API/MyBookings   # still listed, unchanged
```

or by opening the event in Google Calendar (the stamp is not shown in the UI;
`events.get` is the way to see it).

## Known gaps at this point

- **No admin UI.** Schedules are seeded by the CLI above.
- **Slot-era code is gone** (Phase 5). If you are testing against a database
  that predates the pivot, `npm run drop-slot-data` reports what is left of it
  and, with `--confirm`, removes it.
- Editing or deleting a booking directly in Google Calendar changes app state
  silently — no cancellation SMS. That is an accepted cost of the
  calendar-as-database design; see §4 of the plan.
