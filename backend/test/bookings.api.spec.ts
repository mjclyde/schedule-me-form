import { assert } from "chai";
import { DateTime } from "luxon";
import { BookingsAPI, parseBookingRequest } from "../src/api/bookings.api";
import { AvailabilityService } from "../src/services/availability.service";
import { Schedule, ScheduleModel } from "../src/models/schedule";
import { CalendarEventLike } from "../src/google/availability";
import { calendar_v3 } from "googleapis";

const TZ = "America/Denver";

function at(local: string) {
  return DateTime.fromISO(local, { zone: TZ });
}

function makeSchedule(overrides: Partial<ScheduleModel> = {}) {
  return new Schedule({
    _id: "2026spring",
    name: "Spring Tune-Ups 2026",
    type: "Tune-Up",
    description: "15-minute appointments.",
    ownerPersonId: "owner1",
    calendarId: "owner@example.com",
    timeZone: TZ,
    durationMins: 15,
    minNoticeMins: 0,
    ...overrides,
  } as ScheduleModel);
}

/** A Free window on the target calendar, i.e. bookable time. */
function freeWindow(start: string, end: string): CalendarEventLike {
  return {
    transparency: "transparent",
    start: { dateTime: at(start).toISO(), timeZone: TZ },
    end: { dateTime: at(end).toISO(), timeZone: TZ },
  };
}

interface FakeCalendarOptions {
  /** Events already on the calendar before we book. */
  existing?: any[];
  /** Extra events that appear only in the post-insert conflict read. */
  raceWinner?: any;
  /** Simulates minting the manage-link OTP failing. */
  otpFails?: boolean;
}

function buildApi(
  schedule: Schedule | null,
  options: FakeCalendarOptions = {},
) {
  const calls = {
    inserted: [] as calendar_v3.Schema$Event[],
    deleted: [] as string[],
    sms: [] as { phone: string; message: string }[],
  };
  const calendarEvents = [...(options.existing || [])];

  const calendar = {
    listEvents: async (params: any) => {
      const isConflictRead = !!params.privateExtendedProperty;
      if (isConflictRead && options.raceWinner) {
        return [...calendarEvents.filter(isOurs), options.raceWinner];
      }
      return isConflictRead ? calendarEvents.filter(isOurs) : calendarEvents;
    },
    insertEvent: async (_calendarId: string, event: calendar_v3.Schema$Event) => {
      const created = {
        ...event,
        id: `evt${calls.inserted.length + 1}`,
        created: "2026-03-01T10:00:05.000Z",
      };
      calls.inserted.push(created);
      calendarEvents.push(created);
      return created;
    },
    deleteEvent: async (_calendarId: string, eventId: string) => {
      calls.deleted.push(eventId);
      const i = calendarEvents.findIndex((e) => e.id === eventId);
      if (i >= 0) {
        calendarEvents.splice(i, 1);
      }
    },
  };

  const persons = {
    findByPhone: async () => null,
    create: async (p: any) => ({ _id: "person1", ...p }),
    update: async () => {},
    createOTP: async () =>
      options.otpFails
        ? null
        : { _id: "person1", name: "Jane Doe", otp: { value: "abc123" } },
  };

  const api = new BookingsAPI({ find: () => ({}) } as any);
  (api as any).schedules = { findById: async () => schedule };
  (api as any).persons = persons;
  (api as any).notifications = {
    send: async (n: any) => calls.sms.push({ phone: n.phone, message: n.message }),
  };
  (api as any).calendarManager = { getCalendar: async () => calendar };

  const availability = new (AvailabilityService as any)({});
  (availability as any).calendarManager = { getCalendar: async () => calendar };
  (api as any).availability = availability;

  return { api, calls };
}

function isOurs(event: any) {
  return event?.extendedProperties?.private?.app === "schedule-me";
}

function fakeRes() {
  return {
    body: undefined as any,
    code: 200,
    send(body: any) {
      this.body = body;
      return this;
    },
    status(code: number) {
      this.code = code;
      return this;
    },
    sendStatus(code: number) {
      this.code = code;
      return this;
    },
  };
}

function req(id: string, body: any) {
  return { params: { id }, body } as any;
}

const validBody = {
  startAt: at("2099-03-02T09:00").toISO(),
  name: "Jane Doe",
  phone: "(555) 555-0123",
};

describe("parseBookingRequest", () => {
  const schedule = { timeZone: TZ };

  it("normalizes a ten-digit phone number", () => {
    const parsed = parseBookingRequest(
      { ...validBody, phone: "(555) 555-0123" } as any,
      schedule,
    );

    assert.equal(parsed.phone, "+15555550123");
  });

  it("defaults remindMe to true but honours an explicit false", () => {
    assert.isTrue(parseBookingRequest(validBody as any, schedule).remindMe);
    assert.isFalse(
      parseBookingRequest({ ...validBody, remindMe: false } as any, schedule).remindMe,
    );
  });

  it("rejects a missing name, bad phone, or bad date", () => {
    assert.throws(
      () => parseBookingRequest({ ...validBody, name: "  " } as any, schedule),
      /`name` is required/,
    );
    assert.throws(
      () => parseBookingRequest({ ...validBody, phone: "123" } as any, schedule),
      /valid phone number/,
    );
    assert.throws(
      () => parseBookingRequest({ ...validBody, startAt: "soon" } as any, schedule),
      /not a valid date/,
    );
  });

  it("treats email as optional unless the schedule requires it", () => {
    assert.isUndefined(parseBookingRequest(validBody as any, schedule).email);
    assert.throws(
      () => parseBookingRequest(validBody as any, { ...schedule, requireEmail: true }),
      /`email` is required/,
    );
    assert.throws(
      () => parseBookingRequest({ ...validBody, email: "nope" } as any, schedule),
      /valid email address/,
    );
  });
});

describe("POST /Schedules/:id/Bookings", () => {
  const existing = [freeWindow("2099-03-02T09:00", "2099-03-02T10:00")];

  it("writes an opaque, tagged event to the calendar", async () => {
    const { api, calls } = buildApi(makeSchedule(), { existing });
    const res = fakeRes();

    await api.create(req("2026spring", validBody), res as any);

    assert.equal(res.code, 200);
    assert.lengthOf(calls.inserted, 1);
    assert.equal(calls.inserted[0].transparency, "opaque");
    assert.equal(
      calls.inserted[0].extendedProperties?.private?.scheduleId,
      "2026spring",
    );
    assert.equal(res.body.id, "evt1");
    assert.equal(res.body.endAt, at("2099-03-02T09:15").toISO());
    assert.isFalse(res.body.invited);
  });

  it("invites the person when an email is supplied", async () => {
    const { api, calls } = buildApi(makeSchedule(), { existing });
    const res = fakeRes();

    await api.create(
      req("2026spring", { ...validBody, email: "jane@example.com" }),
      res as any,
    );

    assert.deepEqual(calls.inserted[0].attendees, [
      { email: "jane@example.com", displayName: "Jane Doe" },
    ]);
    assert.isTrue(res.body.invited);
  });

  it("texts the booker and the notify list", async () => {
    const schedule = makeSchedule({
      notify: [{ id: "owner1", name: "Owner", phone: "+15555550100" }],
    });
    const { api, calls } = buildApi(schedule, { existing });

    await api.create(req("2026spring", validBody), fakeRes() as any);

    assert.lengthOf(calls.sms, 2);
    assert.include(calls.sms[0].message, "You are scheduled for Tune-Up");
    assert.include(calls.sms[1].message, "Jane Doe has signed up");
  });

  it("gives the booker an OTP link to manage the appointment", async () => {
    const { api, calls } = buildApi(makeSchedule(), { existing });

    await api.create(req("2026spring", validBody), fakeRes() as any);

    assert.include(calls.sms[0].message, "abc123");
  });

  it("still confirms the booking when the manage link cannot be minted", async () => {
    // The appointment is already on the calendar; a missing link must not
    // cost the booker their confirmation.
    const { api, calls } = buildApi(makeSchedule(), { existing, otpFails: true });
    const res = fakeRes();

    await api.create(req("2026spring", validBody), res as any);

    assert.equal(res.code, 200);
    assert.include(calls.sms[0].message, "You are scheduled for Tune-Up");
    assert.notInclude(calls.sms[0].message, "undefined");
  });

  it("refuses a time the calendar does not offer", async () => {
    // Nothing is free at 14:00, so no event may be written.
    const { api, calls } = buildApi(makeSchedule(), { existing });
    const res = fakeRes();

    await api.create(
      req("2026spring", { ...validBody, startAt: at("2099-03-02T14:00").toISO() }),
      res as any,
    );

    assert.equal(res.code, 409);
    assert.isEmpty(calls.inserted);
  });

  it("refuses a time outside the schedule's date window", async () => {
    const schedule = makeSchedule({
      startDate: "2099-03-01",
      endDate: "2099-03-31",
    });
    const { api, calls } = buildApi(schedule, { existing });
    const res = fakeRes();

    await api.create(
      req("2026spring", { ...validBody, startAt: at("2099-04-02T09:00").toISO() }),
      res as any,
    );

    assert.equal(res.code, 422);
    assert.isEmpty(calls.inserted);
  });

  it("refuses a slot already taken by an existing booking", async () => {
    // The previous booking is opaque, so the slot is simply busy.
    const taken = {
      id: "existing",
      created: "2026-03-01T09:00:00.000Z",
      transparency: "opaque",
      start: { dateTime: at("2099-03-02T09:00").toISO() },
      end: { dateTime: at("2099-03-02T09:15").toISO() },
      extendedProperties: {
        private: { app: "schedule-me", scheduleId: "2026spring", personId: "other" },
      },
    };
    const { api, calls } = buildApi(makeSchedule(), {
      existing: [...existing, taken],
    });
    const res = fakeRes();

    await api.create(req("2026spring", validBody), res as any);

    assert.equal(res.code, 409);
    assert.isEmpty(calls.inserted);
  });

  it("deletes its own event and reports a loss when it loses the race", async () => {
    // Someone inserted the same slot a second earlier, between our
    // availability check and our insert.
    const { api, calls } = buildApi(makeSchedule(), {
      existing,
      raceWinner: {
        id: "theirs",
        created: "2026-03-01T10:00:00.000Z",
        start: { dateTime: at("2099-03-02T09:00").toISO() },
        end: { dateTime: at("2099-03-02T09:15").toISO() },
        extendedProperties: {
          private: { app: "schedule-me", scheduleId: "2026spring", personId: "other" },
        },
      },
    });
    const res = fakeRes();

    await api.create(req("2026spring", validBody), res as any);

    assert.equal(res.code, 409);
    assert.deepEqual(calls.deleted, ["evt1"]);
    assert.isEmpty(calls.sms, "a losing booking must not send a confirmation");
  });

  it("404s an unknown or disabled schedule", async () => {
    const missing = buildApi(null);
    const missingRes = fakeRes();
    await missing.api.create(req("nope", validBody), missingRes as any);
    assert.equal(missingRes.code, 404);

    const disabled = buildApi(makeSchedule({ active: false }), { existing });
    const disabledRes = fakeRes();
    await disabled.api.create(req("2026spring", validBody), disabledRes as any);
    assert.equal(disabledRes.code, 404);
  });

  it("stops offering the slot once it is booked", async () => {
    // The cache must not keep serving the slot for the rest of its TTL.
    const schedule = makeSchedule();
    const { api } = buildApi(schedule, { existing });
    const availability = (api as any).availability as AvailabilityService;
    const range = {
      start: at("2099-03-02T00:00"),
      end: at("2099-03-03T00:00"),
    };
    const now = at("2099-03-01T00:00");

    const before = await availability.computeSlots(schedule, range, now);
    await api.create(req("2026spring", validBody), fakeRes() as any);
    const after = await availability.computeSlots(schedule, range, now);

    assert.equal(before.length - after.length, 1);
    assert.notInclude(
      after.map((s) => s.start.toISO()),
      at("2099-03-02T09:00").toISO(),
    );
  });
});
