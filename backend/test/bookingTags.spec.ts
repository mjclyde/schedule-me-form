import { assert } from "chai";
import {
  APP_TAG,
  readBookingTags,
  toPrivateProps,
  toQueryFilters,
} from "../src/google/bookingTags";

describe("bookingTags", () => {
  const tags = {
    scheduleId: "2026spring",
    personId: "abc123",
    bookedAt: new Date("2026-03-01T17:04:22.000Z"),
  };

  it("round-trips through the wire format", () => {
    const props = toPrivateProps(tags);
    const read = readBookingTags({ extendedProperties: { private: props } });

    assert.deepEqual(read, { ...tags, reminderSentAt: undefined });
  });

  it("stamps the app tag so queries cannot match foreign events", () => {
    assert.equal(toPrivateProps(tags).app, APP_TAG);
  });

  it("omits optional dates rather than writing empty values", () => {
    const props = toPrivateProps({ scheduleId: "s", personId: "p" });

    assert.notProperty(props, "bookedAt");
    assert.notProperty(props, "reminderSentAt");
  });

  it("carries reminderSentAt once the cron has stamped it", () => {
    const sent = new Date("2026-03-01T18:00:00.000Z");
    const props = toPrivateProps({ ...tags, reminderSentAt: sent });
    const read = readBookingTags({ extendedProperties: { private: props } });

    assert.deepEqual(read?.reminderSentAt, sent);
  });

  describe("readBookingTags", () => {
    it("returns null for an event this app did not create", () => {
      // A calendar is full of events that are not bookings; treating one as a
      // booking would expose an unrelated meeting as somebody's appointment.
      assert.isNull(readBookingTags({}));
      assert.isNull(readBookingTags({ extendedProperties: { private: {} } }));
      assert.isNull(
        readBookingTags({
          extendedProperties: { private: { app: "some-other-app" } },
        }),
      );
    });

    it("returns null when a required tag is missing", () => {
      assert.isNull(
        readBookingTags({
          extendedProperties: { private: { app: APP_TAG, scheduleId: "s" } },
        }),
      );
      assert.isNull(
        readBookingTags({
          extendedProperties: { private: { app: APP_TAG, personId: "p" } },
        }),
      );
    });

    it("tolerates an unparseable date instead of throwing", () => {
      const read = readBookingTags({
        extendedProperties: {
          private: { ...toPrivateProps(tags), reminderSentAt: "not-a-date" },
        },
      });

      assert.isUndefined(read?.reminderSentAt);
    });
  });

  describe("toQueryFilters", () => {
    it("always scopes to this app", () => {
      assert.deepEqual(toQueryFilters(), [`app=${APP_TAG}`]);
    });

    it("narrows by schedule and person", () => {
      assert.deepEqual(toQueryFilters({ personId: "abc123" }), [
        `app=${APP_TAG}`,
        "personId=abc123",
      ]);
      assert.deepEqual(
        toQueryFilters({ scheduleId: "2026spring", personId: "abc123" }),
        [`app=${APP_TAG}`, "scheduleId=2026spring", "personId=abc123"],
      );
    });
  });
});
