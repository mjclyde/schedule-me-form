import { assert } from "chai";
import { DateTime } from "luxon";
import { BookingsAPI } from "../src/api/bookings.api";
import { AvailabilityService } from "../src/services/availability.service";
import { Schedule, ScheduleModel } from "../src/models/schedule";

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
    ...overrides,
  } as ScheduleModel);
}

function bookingEvent(overrides: any = {}) {
  const tags = {
    app: "schedule-me",
    scheduleId: "2026spring",
    personId: "person1",
    ...(overrides.tags || {}),
  };
  delete overrides.tags;
  return {
    id: "evt1",
    status: "confirmed",
    // Far future by default: cancelling refuses an appointment that has
    // already happened, so a fixture pinned to a real past date would rot.
    start: { dateTime: at("2099-03-02T09:00").toISO() },
    end: { dateTime: at("2099-03-02T09:15").toISO() },
    extendedProperties: { private: tags },
    ...overrides,
  };
}

interface HarnessOptions {
  schedules?: Schedule[];
  /** Events per calendarId. */
  events?: { [calendarId: string]: any[] };
  /** Calendars whose owner's tokens no longer work. */
  brokenCalendars?: string[];
}

function buildApi(options: HarnessOptions = {}) {
  const schedules = options.schedules || [makeSchedule()];
  const events = options.events || {};
  const calls = {
    listed: [] as any[],
    deleted: [] as { calendarId: string; eventId: string }[],
    sms: [] as { phone: string; message: string }[],
    invalidated: [] as string[],
  };

  const calendar = {
    listAppEvents: async (params: any) => {
      if ((options.brokenCalendars || []).includes(params.calendarId)) {
        throw new Error("invalid_grant");
      }
      calls.listed.push(params);
      return events[params.calendarId] || [];
    },
    getEvent: async (calendarId: string, eventId: string) => {
      const found = (events[calendarId] || []).find((e) => e.id === eventId);
      if (!found) {
        throw Object.assign(new Error("Not Found"), { code: 404 });
      }
      return found;
    },
    deleteEvent: async (calendarId: string, eventId: string) => {
      calls.deleted.push({ calendarId, eventId });
    },
  };

  const api = new BookingsAPI({ find: () => ({}) } as any);
  (api as any).schedules = {
    find: async () => schedules,
    findById: async (id: string) => schedules.find((s) => s._id === id) || null,
  };
  (api as any).persons = {
    findById: async () => ({ _id: "person1", name: "Jane Doe", phone: "+15555550123" }),
  };
  (api as any).notifications = {
    send: async (n: any) => calls.sms.push({ phone: n.phone, message: n.message }),
  };
  (api as any).calendarManager = { getCalendar: async () => calendar };

  // A fresh instance per test: the shared cache would otherwise leak between them.
  const availability = new (AvailabilityService as any)({});
  (availability as any).calendarManager = { getCalendar: async () => calendar };
  availability.invalidate = (s: Schedule) => calls.invalidated.push(s._id);
  (api as any).availability = availability;

  return { api, calls };
}

function fakeRes() {
  return {
    body: undefined as any,
    headers: {} as { [key: string]: string },
    code: 200,
    set(field: string, value: string) {
      this.headers[field] = value;
      return this;
    },
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

function authed(overrides: any = {}) {
  return {
    person: { _id: "person1", name: "Jane Doe", phone: "+15555550123" },
    params: {},
    query: {},
    ...overrides,
  } as any;
}

describe("GET /MyBookings", () => {
  it("returns the authenticated person's bookings", async () => {
    const { api } = buildApi({
      events: { "owner@example.com": [bookingEvent()] },
    });
    const res = fakeRes();

    await api.findMyBookings(authed(), res as any);

    assert.lengthOf(res.body, 1);
    assert.equal(res.body[0].id, "evt1");
    assert.equal(res.body[0].scheduleName, "Spring Tune-Ups 2026");
    assert.equal(res.body[0].durationMins, 15);
  });

  it("asks Google only for events belonging to this person", async () => {
    // The filter has to be server-side; pulling the whole calendar and
    // filtering here would expose every other booking to a crash or a typo.
    const { api, calls } = buildApi({
      events: { "owner@example.com": [bookingEvent()] },
    });

    await api.findMyBookings(authed(), fakeRes() as any);

    assert.deepEqual(calls.listed[0].filters, { personId: "person1" });
  });

  it("reads each distinct calendar once, not once per schedule", async () => {
    // Two schedules sharing one calendar is the normal case; querying twice
    // would double the Google calls and duplicate every booking.
    const { api, calls } = buildApi({
      schedules: [
        makeSchedule(),
        makeSchedule({ _id: "2026fall", name: "Fall Tune-Ups 2026" }),
      ],
      events: { "owner@example.com": [bookingEvent()] },
    });
    const res = fakeRes();

    await api.findMyBookings(authed(), res as any);

    assert.lengthOf(calls.listed, 1);
    assert.lengthOf(res.body, 1);
  });

  it("returns bookings in chronological order across calendars", async () => {
    const { api } = buildApi({
      schedules: [
        makeSchedule(),
        makeSchedule({
          _id: "other",
          name: "Other",
          ownerPersonId: "owner2",
          calendarId: "other@example.com",
        }),
      ],
      events: {
        "owner@example.com": [
          bookingEvent({
            id: "later",
            start: { dateTime: at("2026-03-05T09:00").toISO() },
            end: { dateTime: at("2026-03-05T09:15").toISO() },
          }),
        ],
        "other@example.com": [
          bookingEvent({
            id: "earlier",
            start: { dateTime: at("2026-03-01T09:00").toISO() },
            end: { dateTime: at("2026-03-01T09:15").toISO() },
            tags: { scheduleId: "other" },
          }),
        ],
      },
    });
    const res = fakeRes();

    await api.findMyBookings(authed(), res as any);

    assert.deepEqual(
      res.body.map((b: any) => b.id),
      ["earlier", "later"],
    );
  });

  it("still lists the other calendars when one owner's tokens are broken", async () => {
    // A revoked Google grant on one schedule must not blank the whole page.
    const { api } = buildApi({
      schedules: [
        makeSchedule({
          _id: "broken",
          ownerPersonId: "owner2",
          calendarId: "broken@example.com",
        }),
        makeSchedule(),
      ],
      events: { "owner@example.com": [bookingEvent()] },
      brokenCalendars: ["broken@example.com"],
    });
    const res = fakeRes();

    await api.findMyBookings(authed(), res as any);

    assert.lengthOf(res.body, 1);
    assert.equal(res.body[0].id, "evt1");
  });

  it("skips an event whose schedule no longer exists", async () => {
    const { api } = buildApi({
      events: {
        "owner@example.com": [bookingEvent({ tags: { scheduleId: "deleted" } })],
      },
    });
    const res = fakeRes();

    await api.findMyBookings(authed(), res as any);

    assert.isEmpty(res.body);
  });
});

describe("DELETE /Bookings/:id", () => {
  const events = { "owner@example.com": [bookingEvent()] };

  it("deletes the calendar event and reports no content", async () => {
    const { api, calls } = buildApi({ events });
    const res = fakeRes();

    await api.cancel(
      authed({ params: { id: "evt1" }, query: { scheduleId: "2026spring" } }),
      res as any,
    );

    assert.equal(res.code, 204);
    assert.deepEqual(calls.deleted, [
      { calendarId: "owner@example.com", eventId: "evt1" },
    ]);
  });

  it("frees the slot again by dropping the cached availability", async () => {
    const { api, calls } = buildApi({ events });

    await api.cancel(
      authed({ params: { id: "evt1" }, query: { scheduleId: "2026spring" } }),
      fakeRes() as any,
    );

    assert.deepEqual(calls.invalidated, ["2026spring"]);
  });

  it("texts the person and the schedule's notify list", async () => {
    const { api, calls } = buildApi({
      schedules: [
        makeSchedule({
          notify: [{ id: "owner1", name: "Owner", phone: "+15555550100" }],
        }),
      ],
      events,
    });

    await api.cancel(
      authed({ params: { id: "evt1" }, query: { scheduleId: "2026spring" } }),
      fakeRes() as any,
    );

    assert.lengthOf(calls.sms, 2);
    assert.include(calls.sms[0].message, "has been cancelled");
    assert.include(calls.sms[1].message, "Jane Doe");
  });

  it("refuses to delete a booking belonging to someone else", async () => {
    const { api, calls } = buildApi({
      events: {
        "owner@example.com": [bookingEvent({ tags: { personId: "someone-else" } })],
      },
    });
    const res = fakeRes();

    await api.cancel(
      authed({ params: { id: "evt1" }, query: { scheduleId: "2026spring" } }),
      res as any,
    );

    assert.equal(res.code, 404);
    assert.isEmpty(calls.deleted);
  });

  it("refuses to delete an event this app did not create", async () => {
    // Otherwise any OTP holder could delete the owner's private calendar.
    const { api, calls } = buildApi({
      events: {
        "owner@example.com": [
          { id: "evt1", status: "confirmed", extendedProperties: undefined },
        ],
      },
    });
    const res = fakeRes();

    await api.cancel(
      authed({ params: { id: "evt1" }, query: { scheduleId: "2026spring" } }),
      res as any,
    );

    assert.equal(res.code, 404);
    assert.isEmpty(calls.deleted);
  });

  it("refuses a booking tagged for a different schedule on the same calendar", async () => {
    // Two schedules sharing one calendar is the documented normal case. Only
    // the event's own tag says which it belongs to; without checking it, the
    // cancellation SMS names the wrong appointment type and the wrong
    // schedule's availability cache is dropped.
    const { api, calls } = buildApi({
      schedules: [
        makeSchedule({ _id: "2026spring" }),
        makeSchedule({ _id: "2026fall", name: "Fall" }),
      ],
      events: {
        "owner@example.com": [bookingEvent({ tags: { scheduleId: "2026fall" } })],
      },
    });
    const res = fakeRes();

    await api.cancel(
      authed({ params: { id: "evt1" }, query: { scheduleId: "2026spring" } }),
      res as any,
    );

    assert.equal(res.code, 404);
    assert.isEmpty(calls.deleted);
  });

  it("refuses to cancel an appointment that has already happened", async () => {
    // /MyBookings deliberately returns 90 days of history. Deleting one would
    // remove a real calendar record and text everyone that an appointment
    // they already attended "has been cancelled".
    const { api, calls } = buildApi({
      events: {
        "owner@example.com": [
          bookingEvent({
            start: { dateTime: at("2020-03-02T09:00").toISO() },
            end: { dateTime: at("2020-03-02T09:15").toISO() },
          }),
        ],
      },
    });
    const res = fakeRes();

    await api.cancel(
      authed({ params: { id: "evt1" }, query: { scheduleId: "2026spring" } }),
      res as any,
    );

    assert.equal(res.code, 409);
    assert.isEmpty(calls.deleted);
    assert.isEmpty(calls.sms);
  });

  it("404s an unknown event or schedule", async () => {
    const unknownEvent = buildApi({ events });
    const eventRes = fakeRes();
    await unknownEvent.api.cancel(
      authed({ params: { id: "nope" }, query: { scheduleId: "2026spring" } }),
      eventRes as any,
    );
    assert.equal(eventRes.code, 404);

    const unknownSchedule = buildApi({ events });
    const scheduleRes = fakeRes();
    await unknownSchedule.api.cancel(
      authed({ params: { id: "evt1" }, query: { scheduleId: "nope" } }),
      scheduleRes as any,
    );
    assert.equal(scheduleRes.code, 404);
  });

  it("rejects a request that does not say which schedule", async () => {
    // The event id alone does not name a calendar to delete from.
    const { api, calls } = buildApi({ events });
    const res = fakeRes();

    await api.cancel(authed({ params: { id: "evt1" } }), res as any);

    assert.equal(res.code, 400);
    assert.isEmpty(calls.deleted);
  });
});

describe("GET /Bookings/:id/CalendarEvent", () => {
  const events = { "owner@example.com": [bookingEvent()] };

  it("returns an .ics for the caller's own booking", async () => {
    const { api } = buildApi({ events });
    const res = fakeRes();

    await api.calendarEvent(
      authed({ params: { id: "evt1" }, query: { scheduleId: "2026spring" } }),
      res as any,
    );

    assert.equal(res.code, 200);
    assert.include(res.body, "BEGIN:VCALENDAR");
    assert.include(res.body, "SUMMARY:Tune-Up");
    assert.include(res.headers["Content-Type"], "text/calendar");
  });

  it("names the download so it does not arrive as a random id", async () => {
    const { api } = buildApi({ events });
    const res = fakeRes();

    await api.calendarEvent(
      authed({ params: { id: "evt1" }, query: { scheduleId: "2026spring" } }),
      res as any,
    );

    assert.include(res.headers["Content-Disposition"], "Tune-Up.ics");
  });

  it("refuses a booking belonging to someone else", async () => {
    const { api } = buildApi({
      events: {
        "owner@example.com": [bookingEvent({ tags: { personId: "someone-else" } })],
      },
    });
    const res = fakeRes();

    await api.calendarEvent(
      authed({ params: { id: "evt1" }, query: { scheduleId: "2026spring" } }),
      res as any,
    );

    assert.equal(res.code, 404);
  });

  it("rejects a request that does not say which schedule", async () => {
    const { api } = buildApi({ events });
    const res = fakeRes();

    await api.calendarEvent(authed({ params: { id: "evt1" } }), res as any);

    assert.equal(res.code, 400);
  });
});
