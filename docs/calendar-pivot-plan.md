# Architecture Pivot: Google Calendar as the Source of Truth

Status: **Phases 1–4 complete**; Phase 5 not yet started
Branch: `claude/google-calendar-integration-arch-sefqo2`

## Goal

Stop managing appointment slots as Mongo documents. Instead, point the app at a Google
Calendar and say: *"let people book 15-minute appointments anywhere this calendar is free."*
Availability is derived on demand from the calendar; a confirmed booking **is** a calendar
event. Effectively a small, self-hosted Calendly.

---

## 1. How the app works today

### Data model (Mongo)

| Collection | Purpose |
| --- | --- |
| `events` | The thing people sign up for (`_id` is a slug like `2025tdfa`), plus `owners[]` for SMS notification and per-owner `syncGoogleCalendar` |
| `slots` | Pre-created appointment slots: `eventId`, `startAt`, `durationMins`, `capacity.min/max`, and an embedded `persons[]` array of signups with `signedUpAt` / `reminderSentAt` |
| `persons` | Name, phone, `optOutSMS`, a 6-char `otp` (value/expiresAt/eventId), and `googleTokens` |
| `notifications` | Audit log of every Twilio SMS sent |

### Flow

1. An admin (manually / by script — there is no UI) creates an `event` and a batch of
   `slots` via `POST /Slots`.
2. The public page (`EventPicker.vue`) calls `GET /AvailableSlots?eventId=…`, which:
   - runs a Mongo aggregation for future slots with `persons.length < capacity.max`,
   - then, for each owner who linked a Google account, calls `GoogleCalendar.getBusyTime()`
     and drops slots overlapping busy time. **The calendar is already read-only input to
     availability today — this is the seed of the pivot.**
3. `PUT /Slots/:id/SignUp` upserts the `person` by phone, `$push`es them onto `slot.persons`,
   sends a confirmation SMS with an OTP deep link, and SMSes the event owners.
4. `MyEvents.vue` authenticates with the OTP (`Authorization: <otp>` header, no bearer scheme),
   lists the person's slots, and can cancel one (`DELETE /Slots/:slotId/Persons/:personId`).
5. A cron (`0 12-18 * * *`, America/Denver) walks `findRemindersDue()` and SMSes a
   24-hour reminder, stamping `persons.$.reminderSentAt`.
6. Adding to the visitor's own calendar is a **manual `.ics` download**
   (`GET /Slots/:id/CalendarEvent`).

### Correction to a prior assumption

The app does **not** auto-create a Google Calendar event when someone signs up. Nothing in
the codebase calls `events.insert`. What the last commit (`6f9eb12`, "added basic google
calendar integration") actually added was the *opposite* direction: OAuth token storage per
person, and reading an owner's calendar to **filter out** slots that collide with their busy
time. Writing to the calendar is new work in this pivot.

### Stack

- **Backend**: Express + a decorator-based DI/routing lib (`@ncss/api-decorator`), raw
  `mongodb` driver, `hydratable` models, `googleapis`, `luxon`, `twilio`, `cron`. TS.
- **Frontend**: Vue 3 + Pinia + `@vueuse/core` fetch + Tailwind + headlessui/heroicons.
- **Shared**: `common/` is symlinked/copied into the backend image and imported by both.

---

## 2. Target architecture

### The one-sentence version

> A **Schedule** points at a Google calendar. Any *timed* event on that calendar marked
> **Show as: Free** is a bookable window. Everything else on the calendar is busy.
> Booking writes a real (opaque) event back to that calendar, tagged with
> `extendedProperties.private` so the app can find its own bookings again.

### Decisions taken

| Question | Decision |
| --- | --- |
| How is availability marked? | **Any `transparency: "transparent"` event.** No title convention. |
| Where do bookings live? | **Google only**, identified via `extendedProperties.private`. No Mongo booking/slot records. |
| Attendee email | **Optional.** If provided, add as a GCal attendee (real invite). Keep `.ics` download as the phone-only fallback. |
| Existing `2025tdfa` / `2025tdnl4` data | **Dropped.** No migration; clean break. |

### What stays in Mongo

- `persons` — phone, name, `optOutSMS`, OTP, Google tokens. Still needed: SMS and the OTP
  login are the app's identity system, and Google can't hold refresh tokens for us.
- `schedules` — the config (replaces `events`).
- `notifications` — SMS audit log.

### What leaves Mongo entirely

- `slots` collection, `Slot` model, `SlotService`, `SlotAPI`, `common/slot.ts`, and the whole
  `filterSlots` / `getStartAndEndOfSlots` block in `slots.api.ts`.

---

## 3. Availability rules

A single `events.list` call over the requested window returns both the availability windows
and the conflicts, because Google marks each event's transparency inline.

**A calendar event is an availability window iff:**
- `transparency === "transparent"` (Show as: Free), **and**
- it is a **timed** event (`start.dateTime`, not `start.date`), **and**
- `status !== "cancelled"`.

**Everything else is busy**, i.e. any event without `transparency === "transparent"`.

### Why the "timed" rule matters

Google Calendar clients commonly default **all-day events to Free**. Without this rule, a
single all-day "PTO" entry would turn an entire day into bookable time — the exact opposite
of the intent. All-day Free events are therefore ignored (neither available nor busy).
All-day *Busy* events still block, as they do today.

### Slot generation (pure, unit-testable)

```
generateSlots({ windows, busy, durationMins, incrementMins,
                bufferBeforeMins, bufferAfterMins, minNoticeMins, alignTo, now, tz })

  windows := merge(overlapping availability windows)
  for each window:
    cursor := alignUp(max(window.start, now + minNotice), incrementMins, alignTo)
    while cursor + durationMins <= window.end:
      candidate := [cursor, cursor + durationMins]
      padded   := [candidate.start - bufferBefore, candidate.end + bufferAfter]
      if not overlapsAny(padded, busy): emit { startAt: cursor, endAt: candidate.end }
      cursor += incrementMins
```

- `incrementMins` defaults to `durationMins` (back-to-back slots).
- `alignTo: 'hour' | 'window'` — default `'hour'`, so a window starting at 9:07 still yields
  9:15 / 9:30 / … rather than 9:07 / 9:22. Predictable times matter more than packing.
- Bookings the app already made are opaque events, so they land in `busy` automatically.
  **There is no separate "is it taken" check** — that is the main simplification.
- All arithmetic in the calendar's `timeZone` via Luxon, so DST transitions inside a window
  behave.

---

## 4. Booking representation

A booking is a normal calendar event on the target calendar:

```jsonc
{
  "summary": "Tune-Up — Jane Doe",        // from schedule.appointmentTitle template
  "description": "Jane Doe\n(555) 123-4567\njane@example.com\n\nManage: <otp link>",
  "start":  { "dateTime": "…", "timeZone": "America/Denver" },
  "end":    { "dateTime": "…", "timeZone": "America/Denver" },
  "transparency": "opaque",               // REQUIRED — this is what blocks re-booking
  "attendees": [{ "email": "jane@example.com" }],   // only if email supplied
  "extendedProperties": {
    "private": {
      "app": "schedule-me",
      "scheduleId": "2026spring",
      "personId": "<mongo person _id>",
      "bookedAt": "2026-03-01T17:04:22.000Z",
      "reminderSentAt": "…"               // patched in later by the reminder cron
    }
  }
}
```

`events.list` supports `privateExtendedProperty=key=value` (repeatable, AND-ed), which gives
us every query the app needs without a database:

| Need | Query |
| --- | --- |
| This person's bookings | `privateExtendedProperty=[app=schedule-me, personId=<id>]` |
| Reminders due | `privateExtendedProperty=app=schedule-me`, `timeMin=now`, `timeMax=end of tomorrow`, filter where `reminderSentAt` is absent |
| Verify a booking on cancel | `events.get(eventId)`, check `private.personId` matches the OTP holder |

Limits are not a concern: 1024 chars per value, 32 KB per event.

### Double-booking

Google has no conditional insert, so this is optimistic rather than locked:

1. Recompute availability for the target day and confirm `startAt` is still offered.
2. `events.insert`.
3. Re-list events overlapping `[start, end)` carrying `app=schedule-me`. If more than one
   exists and ours does not have the earliest `created` timestamp, `events.delete` ours and
   return **409** so the UI shows "that time was just taken."

The race window shrinks to a couple of hundred milliseconds and resolves deterministically
(earliest `created` wins) with no lock table. For a one-owner booking page this is ample.

### Trade-off being accepted

The calendar is now the database. That means a booking edited or deleted directly in Google
Calendar changes app state silently — no cancellation SMS fires, and the person's "My Events"
list just changes. That is a genuine cost of "Google only," and the right mitigation later is
a `watch`/push-notification channel; it is explicitly out of scope for v1.

---

## 5. Schedule model (replaces `Event`)

```ts
export interface ScheduleModel extends BaseModel {
  _id: string;               // slug used in URLs, e.g. "2026spring"
  name: string;              // page/document title
  type: string;              // short label used in SMS copy, e.g. "Tune-Up"
  description: string;

  ownerPersonId: string;     // whose googleTokens + calendar we use
  calendarId: string;        // target Google calendar
  timeZone: string;          // cached from calendarList

  durationMins: number;      // 15
  incrementMins?: number;    // default = durationMins
  bufferBeforeMins?: number;
  bufferAfterMins?: number;
  minNoticeMins?: number;    // default 60
  maxDaysOut?: number;       // rolling cap; optional, no default when a window is set
  alignTo?: 'hour' | 'window';

  // Absolute booking window. Calendar dates ("YYYY-MM-DD"), NOT Date objects —
  // interpreted in this schedule's timeZone. `endDate` is INCLUSIVE.
  startDate?: string;        // e.g. "2026-03-01"; omit for "open now"
  endDate?: string;          // e.g. "2026-05-31"; omit for "no end"

  appointmentTitle?: string; // template, default "{type} — {name}"
  requireEmail?: boolean;
  active?: boolean;

  notify?: { id: string; name: string; phone: string }[];  // SMS on book/cancel
}
```

`owners[]` collapses into `ownerPersonId` (single calendar + token source) plus `notify[]`
(who gets an SMS). The current per-owner `syncGoogleCalendar` sub-document disappears.

### 5.1 The bookable range

`startDate`/`endDate` scope a schedule to a campaign — "spring tune-ups run March through
May" — which is the primary use case. There are now two independent constraints on *when*
someone may book, and they intersect:

| | Constraint | Shape |
| --- | --- | --- |
| Rolling | `now + minNoticeMins` … `now + maxDaysOut` | moves with the clock |
| Absolute | `startDate` 00:00 … `endDate` 24:00 (schedule tz) | fixed |

```
bookableRange(schedule, now) := intersect(
  [ now + minNoticeMins,  maxDaysOut ? now + maxDaysOut : +∞ ],
  [ startDate ?? -∞,      endDate ? endOfDay(endDate) : +∞ ]
)   // empty range => schedule is not currently open
```

`maxDaysOut` is a *rolling* cap ("book up to 60 days out"); `startDate`/`endDate` are
*absolute*. Both are optional and the tighter one wins, so a several-month campaign just
sets the two dates and leaves `maxDaysOut` unset. Keeping both is worth it — a long campaign
that still shouldn't accept bookings five months early sets both.

**Store dates as `"YYYY-MM-DD"` strings, not `Date` objects.** A `Date` for "May 31" is
UTC midnight, which is May 30 in America/Denver — the exact off-by-one-day class of bug the
codebase already has elsewhere with hardcoded timezones. Resolve the string against
`schedule.timeZone` with Luxon at the point of use.

**Enforce it in exactly one place.** `getBookableRange(schedule, now)` is a pure function,
and both consumers call it:
- `GET /Schedules/:id/Availability` clamps the requested `from`/`to` to it before hitting
  Google (which also caps Google API calls for out-of-window months at zero);
- `POST /Schedules/:id/Bookings` validates `startAt` against it — otherwise a crafted POST
  books outside the window regardless of what the UI offers.

`generateSlots()` itself stays unaware of the window; it only ever sees the clamped range.

### 5.2 Open / closed states

`active` and the date window answer different questions, so keep both:

| State | Condition | Page shows |
| --- | --- | --- |
| Disabled | `active === false` | 404 / hidden — a manual kill switch |
| Not yet open | `now < startDate` | "Sign-ups open March 1" |
| Open | in window | the booking calendar |
| Closed | `now > endDate` | "Sign-ups closed May 31" |

These are distinct from "open, but nothing free this month," which is the empty-calendar
state and needs different copy.

---

## 6. API surface

### New / changed

| Method | Path | Auth | Notes |
| --- | --- | --- | --- |
| `GET` | `/Schedules/:id` | public | Config for the booking page (duration, tz, description) + the resolved `bookableRange` and open/closed state |
| `GET` | `/Schedules/:id/Availability?from=&to=` | public | `{ timeZone, state, slots: [{ startAt, endAt }] }`. Slots are **ephemeral** — no ids. Range clamped to `bookableRange`. |
| `POST` | `/Schedules/:id/Bookings` | public | `{ startAt, name, phone, email?, remindMe? }` → `{ bookingId, startAt, endAt }`; `409` on race, `422` if outside `bookableRange` |
| `GET` | `/MyBookings` | OTP | Derived from the calendar, across every schedule the person has booked |
| `DELETE` | `/Bookings/:id?scheduleId=` | OTP | Ownership checked via `extendedProperties.private.personId` |
| `GET` | `/Bookings/:id/CalendarEvent?scheduleId=` | OTP | `.ics` fallback, generated in memory |
| `GET` | `/Schedule` | OTP | The schedule the caller's OTP was minted for |
| `POST` | `/Schedules/:id/CreateOTP` | public | Rename of `/Events/:id/CreateOTP` |

**Why the endpoints take a `scheduleId`.** A Google event id does not name the
calendar holding it, and neither does a person id — so both `/MyBookings` and
the two `/Bookings/:id` routes resolve the calendar through a schedule.
`/MyBookings` collapses every schedule onto the distinct
`(ownerPersonId, calendarId)` pairs behind them — normally one — and queries
each once. Querying per schedule would both cost more and return a booking once
per schedule sharing its calendar. It is scoped to the **person**, not to the
OTP's schedule, so an OTP minted while booking one schedule does not hide a
booking on another.

The two `/Bookings/:id` routes answer a single `404` for "no such event", "not
a booking of ours" and "not yours". Distinguishing them would let any OTP
holder probe the owner's calendar for which event ids exist. An untagged event
always fails the ownership check, so neither route can ever touch something the
app did not create.

`/Bookings/:id/CalendarEvent` is behind OTP auth rather than public as first
specced: it is only ever reached from the authenticated My Bookings page, so
requiring the header costs nothing and stops a guessed event id from returning
an appointment's title and time.

### Unchanged

`GET /Google/Calendars` (OTP) — used by the owner to pick `calendarId`; `GET /GoogleAuth`
and `/GoogleAuth/Redirect` (with the fixes in §8).

### Deleted

`GET /Slots`, `GET /AvailableSlots`, `GET /MySlots`, `POST /Slots`,
`PUT /Slots/:id/SignUp`, `DELETE /Slots/:slotId/Persons/:personId`,
`GET /Slots/:id/CalendarEvent`, and all of `/Events*`.

### Guard rails on the public availability endpoint

It is unauthenticated and proxies to Google, so:
- clamp `from`/`to` to `bookableRange` (§5.1) and reject ranges longer than 62 days — an
  out-of-window month then costs zero Google calls and returns `[]`;
- in-memory TTL cache keyed `${calendarId}:${dayISO}`, ~30s, to collapse the burst of
  requests a single visitor's month-flipping produces.

---

## 7. Frontend changes

- `common/slot.ts` → `common/booking.ts`:
  `AvailableSlot { startAt: string; endAt: string }`, `BookingRequest`, `Booking`.
- `store/event.ts` → `store/schedule.ts`; `store/slots.ts` → `store/availability.ts`.
- **Slots lose their `_id`** — selection is keyed by ISO `startAt`. `Calendar.vue` and
  `Slots.vue` need that swap; `durationMins` moves from the slot to the schedule config.
- Availability becomes a **range query per visible month** instead of one fetch-everything
  call, so `fetchSlots()` re-runs on month navigation.
- The date window gives a principled answer to two things the current code guesses at:
  - **Opening month** — open on `max(today, startDate)`'s month, replacing today's
    "jump to the month containing the first slot" heuristic (which needs all slots up front
    and can't survive a range query).
  - **Month navigation bounds** — disable prev/next past the window, so nobody pages through
    empty months. Without this a several-month campaign is a lot of dead clicking.
- Render the four states from §5.2. "Closed on May 31" and "no times left this month" look
  identical to a visitor otherwise, and they need different next actions.
- `EventPicker.vue`: add an optional email field; POST to `/Schedules/:id/Bookings`; handle
  `409` with the existing "no longer available" alert.
- `MyEvents.vue`: bookings instead of slots; cancel by booking id.
- Show the **schedule's timezone** next to the times. The browser renders in the visitor's
  local zone, and without a label that is a reliable source of confusion.

---

## 8. Bugs found while reading (fix as we go)

Items 1–3, 7 and 9 are **fixed** in Phase 1.

1. ~~**`persons.api.ts:41` — OAuth `state` is always `undefined`.**~~ `state: req.params.personId`
   on a route with no `:personId` param. Google therefore omitted `state` from the callback,
   and `/GoogleAuth/Redirect` hit a bare `return;` — never responding, never saving tokens.
   **Calendar linking could never complete.** Fixed by deriving the person from the
   authenticated session instead of the request.
2. ~~**`GET /GoogleAuth` is unauthenticated**~~ and took the person id from the query string,
   so anyone could start a flow for any person id and the redirect would write tokens under
   whatever `state` said. Replaced by `GET /Google/AuthUrl` behind OTP auth, which returns
   the consent URL as JSON rather than redirecting — a redirect is a browser navigation and
   cannot carry the OTP header, which is precisely what forced the id into the query string.
   `state` is now HMAC-signed and expires in 10 minutes (`src/google/oauthState.ts`).
3. ~~**`OAuthClientManager` caches an `OAuth2Client` per person forever**~~ and never persisted
   refreshed access tokens. Fixed with a `tokens` listener that writes them back, plus an
   `evict()` for re-link/revoke.
4. **`slot.service.ts findAvailable`** — `{ $lt: [{ $size: "$persons" }, "$capacity.max"] }`
   evaluates false when `capacity.max` is absent, so any slot without an explicit max is
   never bookable. Moot after the pivot, but it explains any "slot never appeared" reports.
5. ~~**`app.ts` hardcodes `2025tdfa` / `2025tdnl4`** in the reminder cron.~~ Fixed in
   Phase 4: the sweep walks active schedules and skips any whose window has closed, so a
   finished campaign costs no Google call. The cutoff is `endDate + 1 day`, not `endDate` —
   appointments happen *on* the last bookable day, so their reminders are still due during
   it. Schedules that have not opened yet are swept too: an appointment at 09:00 on the
   opening day needs its reminder the day before.
6. ~~**`slots.api.ts` `.ics` handling** writes the file into the process CWD and unlinks
   after download — racy and leaks on failed downloads.~~ The replacement,
   `GET /Bookings/:id/CalendarEvent`, builds the string in memory and `res.send`s it. The
   slot-era route itself dies with the slot code in Phase 5.
7. ~~**`backend/test/index.spec.ts` imports `Thing` from `../src/index`, which does not exist**~~ —
   the suite could not compile, so `npm test` was dead. Removed; real specs took its place.
8. Hardcoded `America/Denver` in `utils/formatTime.ts`, ~~`reminders.ts`~~, and
   `slots.api.ts` message builders. `reminders.ts` was rewritten in Phase 4 and now formats
   in the schedule's own `timeZone`. The remaining two are in the slot path and die with it
   in Phase 5.
10. ~~**`PersonService.createOTP` does not upsert**, and persons are only ever created by
   booking, so `POST /Events/:id/CreateOTP` returned 500 for a phone number that had never
   signed up (the "Find My Events" form's likely failure mode).~~ Fixed in Phase 4:
   `createOTP` now returns `null` for an unknown phone, and both CreateOTP endpoints answer
   `204` either way, sending nothing. An unknown number is an ordinary outcome, not an
   error — and distinguishing it would turn the form into an oracle for which numbers are
   customers. The bootstrap chicken-and-egg (linking a calendar needs an OTP, an OTP needs a
   person, a person needs a booking, a booking needs a linked calendar) is still worked
   around by `npm run owner`; see docs/testing-the-pivot.md.
9. ~~**`GoogleCalendar.listEvents` paginated in an infinite loop.**~~ It tracked
   `nextPageToken` but never fed it back into the request, so any range holding more events
   than Google's page size (250 by default) re-fetched page one forever — hanging the request
   and growing the array without bound. Latent today because the slot windows are small; it
   would have fired on the first busy calendar queried over a multi-month range, which is
   exactly what this pivot introduces. Fixed.

11. **`POST /Schedules/:id/CreateOTP` is unauthenticated and unthrottled.** It has to be —
   it is how someone with no session asks for their manage link — but that means anyone who
   knows a customer's number can make us text them repeatedly. Phase 4 removed the worse
   half of this: the endpoint now reuses a live OTP instead of rotating one, so repeated
   calls can no longer churn someone's access token and invalidate the links they hold.
   The SMS flood remains, and wants per-phone/per-IP rate limiting. Inherited from
   `/Events/:id/CreateOTP`, but Phase 4 makes this the primary path.

---

## 9. Phasing

Each phase is independently shippable and leaves the app working.

**Phase 1 — Foundation (no behaviour change)** ✅ *done*
- Fixed bugs 1–3, 7 and 9.
- `GoogleCalendar` gained `getEvent`, `insertEvent`, `patchEvent`, `deleteEvent` and
  `listAppEvents`.
- `google/bookingTags.ts`: builds/reads the `extendedProperties.private` payload and the
  `privateExtendedProperty` query filters.
- `google/availability.ts`: pure `splitWindowsAndBusy()` + `generateSlots()`, with 40 unit
  tests across the three new modules covering DST in both directions, all-day-Free exclusion,
  buffers, min-notice, alignment, window merging, and state tampering/expiry.

**Linking a calendar now** (there is still no UI — Phase 5's admin page is the fix):

```sh
curl -H "Authorization: <otp>" $API/Google/AuthUrl   # -> {"url": "https://accounts.google.com/..."}
# open that url in a browser, approve, land on /GoogleAuth/Redirect
curl -H "Authorization: <otp>" $API/Google/Calendars # -> pick the calendarId
```

`OAUTH_STATE_SECRET` is optional; it falls back to `GOOGLE_CLIENT_SECRET`.

**Phase 2 — Read path** ✅ *done*
- `Schedule` model + `ScheduleService`, with pure `getBookableRange()` / `getOpenState()`
  and `toPublic()`, which strips `calendarId`, `ownerPersonId` and `notify` — the endpoint
  is public.
- `GET /Schedules/:id` and `GET /Schedules/:id/Availability`, with range clamping, a 30s
  `TtlCache` that also de-duplicates in-flight calls, and a 62-day ceiling.
- `common/schedule.ts` carries the shared `PublicSchedule` / `AvailabilityResponse` types.
- 80 tests total. The API specs drive the class with a stubbed store and calendar, so the
  clamping, the four states, and "no Google call outside the window" are all covered
  without Mongo or Google.

**Seeding a schedule** (no admin UI yet; creation stays server-side because a schedule
names the owner's calendar and carries notify phone numbers). See
**docs/testing-the-pivot.md** for the full end-to-end runbook:

```sh
npm run schedule -- ./my-schedule.json
```

```jsonc
{
  "_id": "2026spring",              // the slug in the public URL
  "name": "Spring Tune-Ups 2026",
  "type": "Tune-Up",                // used in SMS copy
  "description": "15-minute tune-up appointments.",
  "ownerPersonId": "<person _id>",  // must have linked Google
  "calendarId": "you@example.com",
  "timeZone": "America/Denver",
  "durationMins": 15,
  "startDate": "2026-03-01",
  "endDate": "2026-05-31"
}
```

Then, with some Free events on the calendar:

```sh
curl "$API/Schedules/2026spring"
curl "$API/Schedules/2026spring/Availability?from=2026-03-01&to=2026-03-31"
```

**Phase 3 — Write path** ✅ *done*
- `POST /Schedules/:id/Bookings`: validate → re-check availability → insert → conflict
  check → invalidate cache → SMS. Returns `422` outside the window, `409` when the slot is
  gone or the race is lost.
- `AvailabilityService` extracted from `SchedulesAPI`, so booking validates a slot through
  the same code path that produced it.
- Attendee invite when an email is supplied (`sendUpdates: "all"`).
- Frontend cut over: `BookingPage.vue` (replaces `EventPicker.vue`), `store/schedule.ts`
  and `store/availability.ts`. Slots are keyed by `startAt` — no ids. Availability is a
  per-visible-month range query, the calendar opens on the schedule's first bookable month,
  month navigation is bounded by the window, and the four states render distinctly.
- 107 tests.

**The booking page is now `/?scheduleId=<slug>`**, not `?eventId=`.

**Phase 4 — Lifecycle** ✅ *done*
- `GET /MyBookings` and `DELETE /Bookings/:id`, plus `GET /Bookings/:id/CalendarEvent`
  (the `.ics` fallback) and `GET /Schedule`. See §6 for why they take a `scheduleId`.
- The OTP manage link is back in the confirmation SMS. An OTP now scopes to a
  `scheduleId` rather than an `eventId`; both fields live on the sub-document until
  Phase 5 removes the slot-era pages that read `eventId`.
- Reminder cron rewritten off the calendar: it lists each schedule's own bookings between
  now and the **end of tomorrow**, skips the ones already stamped, texts the rest, and
  patches `reminderSentAt` onto the event. `findRemindersDue` / `reminderHasBeenSent`
  deleted. The window is not a rolling 24 hours: the cron only runs 12:00–18:00, so a
  rolling window never reaches tomorrow evening, and a 19:00 appointment would first be
  seen at noon on the day itself — ~7 hours' notice, in a text reading "on \<today\>".
  The Mongo query this replaced reached the end of tomorrow for the same reason.
- `MyEvents.vue` moved onto bookings, with `store/bookings.ts` and `BookingCard.vue`.
  `MainHeader.vue` moved off `store/event.ts` — it had been rendering blank since the
  Phase 3 cutover, because it read a store populated from `?eventId=`.
- Bugs 5, 6 and 10 fixed; 8 fixed for `reminders.ts`.
- 159 tests.

**Two things worth knowing about the reminder patch.** Google merges
`extendedProperties.private` key by key, so the sweep patches *only*
`reminderSentAt`; sending the whole map would drop `app` / `scheduleId` /
`personId` and orphan the booking from every query the app makes. There is a test
pinning that. And a failed SMS deliberately leaves the booking unstamped so the next
sweep retries — self-limiting, because the booking leaves the 24-hour window once it
passes. A booking whose person has been deleted *is* stamped, since that will not fix
itself and would otherwise be retried every hour.

**Phase 5 — Teardown**
- Delete `Slot` model/service/API and `common/slot.ts`, plus `EventService` / `EventAPI`
  and `common/event.ts`.
- Frontend: `store/slots.ts`, `store/event.ts` and `MySlot.vue` now reference only each
  other and have no live consumer — delete them.
- Drop `otp.eventId` from the person sub-document once nothing reads it.
- Drop the `slots` and `events` collections.
- Remaining hardcoded `America/Denver` in `utils/formatTime.ts` and `slots.api.ts`
  goes with the slot code (bug #8).
- README/setup notes: how to mark a window Free, how to link the calendar.

---

## 10. Open questions (not blocking Phase 1)

- **Capacity > 1.** The current model supports `capacity.min/max`; the calendar-backed design
  is 1-per-slot (Calendly-style). If group slots are still needed, the natural encoding is a
  count parsed from the availability event (e.g. a `x3` suffix) with the app counting its own
  bookings in the window instead of relying on opacity. Deferred until there's a real use.
- **Owner-facing setup UI.** Schedules are still created by hand. A small admin page
  (pick calendar → set duration → get a share link) is what turns this from "my app" into
  the Calendly replacement, but it is a separate piece of work.
- **Push notifications.** A Google `watch` channel would close the "edited directly in
  Calendar" gap in §4. Out of scope for v1.
