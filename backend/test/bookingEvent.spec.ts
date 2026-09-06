import { assert } from "chai";
import { DateTime } from "luxon";
import {
  buildBookingEvent,
  isBookingWinner,
  overlappingBookings,
} from "../src/google/bookingEvent";
import { readBookingTags } from "../src/google/bookingTags";

const TZ = "America/Denver";

function at(local: string) {
  return DateTime.fromISO(local, { zone: TZ });
}

const params = {
  scheduleId: "2026spring",
  scheduleType: "Tune-Up",
  timeZone: TZ,
  slot: { start: at("2026-03-02T09:00"), end: at("2026-03-02T09:15") },
  person: { id: "person1", name: "Jane Doe", phone: "+15555550123" },
};

describe("buildBookingEvent", () => {
  it("marks the event opaque so the slot stops being offered", () => {
    // This is the whole double-booking mechanism; there is no separate flag.
    assert.equal(buildBookingEvent(params).transparency, "opaque");
  });

  it("tags the event so the app can find it again", () => {
    const event = buildBookingEvent(params);
    const tags = readBookingTags(event as any);

    assert.equal(tags?.scheduleId, "2026spring");
    assert.equal(tags?.personId, "person1");
    assert.isOk(tags?.bookedAt);
  });

  it("fills the title template", () => {
    assert.equal(buildBookingEvent(params).summary, "Tune-Up — Jane Doe");
    assert.equal(
      buildBookingEvent({ ...params, appointmentTitle: "{name} ({type})" }).summary,
      "Jane Doe (Tune-Up)",
    );
  });

  it("carries the slot times in the schedule's zone", () => {
    const event = buildBookingEvent(params);

    assert.equal(event.start?.timeZone, TZ);
    assert.equal(
      DateTime.fromISO(event.end!.dateTime!).setZone(TZ).toFormat("HH:mm"),
      "09:15",
    );
  });

  it("invites the person only when an email was given", () => {
    assert.isUndefined(buildBookingEvent(params).attendees);

    const invited = buildBookingEvent({ ...params, email: "jane@example.com" });
    assert.deepEqual(invited.attendees, [
      { email: "jane@example.com", displayName: "Jane Doe" },
    ]);
  });

  it("puts the contact details in the description", () => {
    const event = buildBookingEvent({ ...params, email: "jane@example.com" });

    assert.include(event.description, "Jane Doe");
    assert.include(event.description, "+15555550123");
    assert.include(event.description, "jane@example.com");
  });
});

describe("isBookingWinner", () => {
  it("gives the slot to the earliest created event", () => {
    const candidates = [
      { id: "theirs", created: "2026-03-01T10:00:00.000Z" },
      { id: "ours", created: "2026-03-01T10:00:01.000Z" },
    ];

    assert.isFalse(isBookingWinner(candidates, "ours"));
    assert.isTrue(isBookingWinner(candidates, "theirs"));
  });

  it("reaches the same verdict whichever racer asks", () => {
    // Both sides run this independently; exactly one must keep its event.
    const candidates = [
      { id: "b", created: "2026-03-01T10:00:00.000Z" },
      { id: "a", created: "2026-03-01T10:00:00.000Z" },
    ];
    const winners = ["a", "b"].filter((id) => isBookingWinner(candidates, id));

    assert.deepEqual(winners, ["a"]);
  });

  it("keeps an uncontested booking", () => {
    assert.isTrue(
      isBookingWinner([{ id: "ours", created: "2026-03-01T10:00:00.000Z" }], "ours"),
    );
  });

  it("keeps ours when the read comes back empty", () => {
    // An eventually-consistent list must not make us delete a confirmed booking.
    assert.isTrue(isBookingWinner([], "ours"));
  });

  it("ranks an event with no created timestamp last", () => {
    const candidates = [
      { id: "undated", created: null },
      { id: "ours", created: "2026-03-01T10:00:00.000Z" },
    ];

    assert.isTrue(isBookingWinner(candidates, "ours"));
  });
});

describe("overlappingBookings", () => {
  const slot = { start: at("2026-03-02T09:00"), end: at("2026-03-02T09:15") };

  function event(id: string, start: string, end: string) {
    return {
      id,
      start: { dateTime: at(start).toISO() },
      end: { dateTime: at(end).toISO() },
    };
  }

  it("keeps events that overlap the slot", () => {
    const found = overlappingBookings(
      [
        event("same", "2026-03-02T09:00", "2026-03-02T09:15"),
        event("partial", "2026-03-02T09:10", "2026-03-02T09:30"),
      ],
      slot,
    );

    assert.deepEqual(found.map((e) => e.id), ["same", "partial"]);
  });

  it("drops adjacent events that only touch the slot", () => {
    const found = overlappingBookings(
      [
        event("before", "2026-03-02T08:45", "2026-03-02T09:00"),
        event("after", "2026-03-02T09:15", "2026-03-02T09:30"),
      ],
      slot,
    );

    assert.isEmpty(found);
  });

  it("ignores all-day events, which carry no dateTime", () => {
    assert.isEmpty(
      overlappingBookings([{ start: { dateTime: null }, end: { dateTime: null } }], slot),
    );
  });
});
