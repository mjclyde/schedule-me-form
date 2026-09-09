import { assert } from "chai";
import { DateTime } from "luxon";
import { Reminders, dueForReminder, shouldSweep } from "../src/reminders";
import { Schedule, ScheduleModel } from "../src/models/schedule";

const TZ = "America/Denver";

function at(local: string, zone = TZ) {
  return DateTime.fromISO(local, { zone });
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
    bookedAt: "2026-03-01T10:00:00.000Z",
    ...(overrides.tags || {}),
  };
  delete overrides.tags;
  return {
    id: "evt1",
    status: "confirmed",
    start: { dateTime: at("2026-03-02T09:00").toISO() },
    end: { dateTime: at("2026-03-02T09:15").toISO() },
    extendedProperties: { private: tags },
    ...overrides,
  };
}

describe("shouldSweep", () => {
  it("skips a disabled schedule", () => {
    const schedule = makeSchedule({ active: false, endDate: "2026-05-31" });

    assert.isFalse(shouldSweep(schedule, at("2026-03-02T12:00")));
  });

  it("still sweeps on the last bookable day", () => {
    // The cutoff is endDate + 1 day, not endDate: appointments happen *on*
    // the last bookable day, so their reminders are still due during it.
    const schedule = makeSchedule({ endDate: "2026-05-31" });

    assert.isTrue(shouldSweep(schedule, at("2026-05-31T13:00")));
  });

  it("stops sweeping once the window has closed", () => {
    const schedule = makeSchedule({ endDate: "2026-05-31" });

    assert.isFalse(shouldSweep(schedule, at("2026-06-01T00:30")));
  });

  it("sweeps a schedule that has not opened yet", () => {
    // An appointment at 09:00 on the opening day needs its reminder the day
    // before, while the schedule still reads as "before".
    const schedule = makeSchedule({ startDate: "2026-03-02" });

    assert.isTrue(shouldSweep(schedule, at("2026-03-01T13:00")));
  });

  it("sweeps a schedule with no end date", () => {
    assert.isTrue(shouldSweep(makeSchedule(), at("2030-01-01T13:00")));
  });
});

describe("dueForReminder", () => {
  it("returns a booking that has not been reminded", () => {
    assert.lengthOf(dueForReminder([bookingEvent()]), 1);
  });

  it("skips a booking already stamped", () => {
    const stamped = bookingEvent({
      tags: { reminderSentAt: "2026-03-01T13:00:00.000Z" },
    });

    assert.isEmpty(dueForReminder([stamped]));
  });

  it("skips an event this app did not create", () => {
    assert.isEmpty(dueForReminder([{ id: "x", extendedProperties: undefined }]));
  });
});

interface HarnessOptions {
  schedules?: Schedule[];
  events?: { [calendarId: string]: any[] };
  brokenCalendars?: string[];
}

function buildJob(options: HarnessOptions = {}) {
  const schedules = options.schedules || [makeSchedule()];
  const events = options.events || { "owner@example.com": [bookingEvent()] };
  const calls = {
    sms: [] as { phone: string; message: string }[],
    patched: [] as { eventId: string; body: any }[],
  };

  const calendar = {
    listAppEvents: async (params: any) => {
      if ((options.brokenCalendars || []).includes(params.calendarId)) {
        throw new Error("invalid_grant");
      }
      return events[params.calendarId] || [];
    },
    patchEvent: async (_calendarId: string, eventId: string, body: any) => {
      calls.patched.push({ eventId, body });
    },
  };

  const job = new Reminders({ find: () => ({}) } as any);
  (job as any).schedules = { find: async () => schedules };
  (job as any).persons = {
    findById: async () => ({
      _id: "person1",
      name: "Jane Doe",
      phone: "+15555550123",
    }),
  };
  (job as any).notifications = {
    send: async (n: any) => calls.sms.push({ phone: n.phone, message: n.message }),
  };
  (job as any).calendarManager = { getCalendar: async () => calendar };

  return { job, calls };
}

describe("Reminders.run", () => {
  const now = at("2026-03-01T13:00");

  it("texts the person about an appointment inside the window", async () => {
    const { job, calls } = buildJob();

    await job.run(now);

    assert.lengthOf(calls.sms, 1);
    assert.equal(calls.sms[0].phone, "+15555550123");
    assert.include(calls.sms[0].message, "Tune-Up");
    assert.include(calls.sms[0].message, "9:00 AM");
  });

  it("stamps the event so the next sweep skips it", async () => {
    const { job, calls } = buildJob();

    await job.run(now);

    assert.lengthOf(calls.patched, 1);
    assert.equal(calls.patched[0].eventId, "evt1");
    assert.isString(
      calls.patched[0].body.extendedProperties.private.reminderSentAt,
    );
  });

  it("stamps only reminderSentAt, leaving the booking's tags intact", async () => {
    // A patch that carried the whole private map could drop app/scheduleId/
    // personId, which would orphan the booking from every query the app makes.
    const { job, calls } = buildJob();

    await job.run(now);

    assert.deepEqual(
      Object.keys(calls.patched[0].body.extendedProperties.private),
      ["reminderSentAt"],
    );
  });

  it("does not text twice for a booking already reminded", async () => {
    const { job, calls } = buildJob({
      events: {
        "owner@example.com": [
          bookingEvent({ tags: { reminderSentAt: "2026-03-01T12:00:00.000Z" } }),
        ],
      },
    });

    await job.run(now);

    assert.isEmpty(calls.sms);
    assert.isEmpty(calls.patched);
  });

  it("formats the time in the schedule's zone, not a hardcoded one", async () => {
    // Bug #8: reminders.ts hardcoded America/Denver.
    const { job, calls } = buildJob({
      schedules: [makeSchedule({ timeZone: "America/New_York" })],
      events: {
        "owner@example.com": [
          bookingEvent({
            start: { dateTime: at("2026-03-02T09:00", "America/New_York").toISO() },
            end: { dateTime: at("2026-03-02T09:15", "America/New_York").toISO() },
          }),
        ],
      },
    });

    await job.run(at("2026-03-01T13:00", "America/New_York"));

    assert.include(calls.sms[0].message, "9:00 AM");
  });

  it("skips a schedule whose window has closed", async () => {
    const { job, calls } = buildJob({
      schedules: [makeSchedule({ endDate: "2026-01-31" })],
    });

    await job.run(now);

    assert.isEmpty(calls.sms);
  });

  it("keeps going when one schedule's calendar cannot be read", async () => {
    const { job, calls } = buildJob({
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

    await job.run(now);

    assert.lengthOf(calls.sms, 1);
  });

  it("still stamps when the person can no longer be found", async () => {
    // Otherwise the sweep retries this booking every hour, forever.
    const { job, calls } = buildJob();
    (job as any).persons = { findById: async () => null };

    await job.run(now);

    assert.isEmpty(calls.sms);
    assert.lengthOf(calls.patched, 1);
  });
});
