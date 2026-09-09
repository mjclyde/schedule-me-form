import { assert } from "chai";
import { DateTime } from "luxon";
import { toMyBooking, ownsBooking } from "../src/google/bookingView";
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
  return {
    id: "evt1",
    status: "confirmed",
    start: { dateTime: at("2026-03-02T09:00").toISO() },
    end: { dateTime: at("2026-03-02T09:15").toISO() },
    extendedProperties: {
      private: {
        app: "schedule-me",
        scheduleId: "2026spring",
        personId: "person1",
      },
    },
    ...overrides,
  };
}

describe("toMyBooking", () => {
  it("combines the event's times with the schedule's naming", () => {
    const booking = toMyBooking(bookingEvent(), makeSchedule());

    assert.deepEqual(booking, {
      id: "evt1",
      scheduleId: "2026spring",
      scheduleName: "Spring Tune-Ups 2026",
      scheduleType: "Tune-Up",
      startAt: at("2026-03-02T09:00").toISO(),
      endAt: at("2026-03-02T09:15").toISO(),
      timeZone: TZ,
      durationMins: 15,
    });
  });

  it("derives duration from the event, not the schedule's current setting", () => {
    // The schedule moved to 30-minute appointments after this was booked.
    const booking = toMyBooking(
      bookingEvent(),
      makeSchedule({ durationMins: 30 }),
    );

    assert.equal(booking?.durationMins, 15);
  });

  it("ignores an event this app did not create", () => {
    // A calendar holds plenty of events that are not bookings.
    const foreign = bookingEvent({ extendedProperties: undefined });

    assert.isNull(toMyBooking(foreign, makeSchedule()));
  });

  it("ignores a cancelled event", () => {
    const cancelled = bookingEvent({ status: "cancelled" });

    assert.isNull(toMyBooking(cancelled, makeSchedule()));
  });

  it("ignores an untimed event", () => {
    // A booking is always timed; an all-day event carrying our tags is corrupt.
    const allDay = bookingEvent({
      start: { date: "2026-03-02" },
      end: { date: "2026-03-03" },
    });

    assert.isNull(toMyBooking(allDay, makeSchedule()));
  });

  it("ignores an event with no id, which cannot be cancelled later", () => {
    assert.isNull(toMyBooking(bookingEvent({ id: null }), makeSchedule()));
  });
});

describe("ownsBooking", () => {
  it("accepts the person named in the event's tags", () => {
    assert.isTrue(ownsBooking(bookingEvent(), "person1"));
  });

  it("rejects a different person", () => {
    assert.isFalse(ownsBooking(bookingEvent(), "person2"));
  });

  it("rejects an event this app did not create", () => {
    // Without this, an OTP holder could delete arbitrary calendar entries.
    const foreign = { id: "evt1", extendedProperties: undefined };

    assert.isFalse(ownsBooking(foreign, "person1"));
  });
});
