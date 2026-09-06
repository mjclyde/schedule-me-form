import { assert } from "chai";
import { DateTime } from "luxon";
import {
  BookingWindowConfig,
  DEFAULT_MIN_NOTICE_MINS,
  getBookableRange,
  getOpenState,
} from "../src/models/schedule";

const TZ = "America/Denver";

function at(local: string) {
  return DateTime.fromISO(local, { zone: TZ });
}

/** A several-month campaign, the primary use case. */
const campaign: BookingWindowConfig = {
  timeZone: TZ,
  startDate: "2026-03-01",
  endDate: "2026-05-31",
  minNoticeMins: 0,
};

describe("getOpenState", () => {
  it("is open inside the window", () => {
    assert.equal(getOpenState(campaign, at("2026-04-15T12:00")), "open");
  });

  it("is before the window until the first moment of startDate", () => {
    assert.equal(getOpenState(campaign, at("2026-02-28T23:59")), "before");
    assert.equal(getOpenState(campaign, at("2026-03-01T00:00")), "open");
  });

  it("treats endDate as inclusive", () => {
    // The last bookable day is May 31, so the schedule stays open all day.
    assert.equal(getOpenState(campaign, at("2026-05-31T23:59")), "open");
    assert.equal(getOpenState(campaign, at("2026-06-01T00:00")), "closed");
  });

  it("reports disabled ahead of any date reasoning", () => {
    const disabled = { ...campaign, active: false };

    assert.equal(getOpenState(disabled, at("2026-04-15T12:00")), "disabled");
    assert.equal(getOpenState(disabled, at("2026-01-01T12:00")), "disabled");
  });

  it("is open indefinitely with no dates configured", () => {
    assert.equal(getOpenState({ timeZone: TZ }, at("2030-01-01T00:00")), "open");
  });

  it("stays open when minimum notice leaves nothing bookable today", () => {
    // "Open but nothing free" is an empty slot list, not a closed schedule.
    const config = { ...campaign, minNoticeMins: 60 * 24 * 365 };

    assert.equal(getOpenState(config, at("2026-05-31T12:00")), "open");
  });
});

describe("getBookableRange", () => {
  it("starts at the minimum notice horizon inside the window", () => {
    const range = getBookableRange(
      { ...campaign, minNoticeMins: 90 },
      at("2026-04-15T12:00"),
    );

    assert.equal(range?.start.toISO(), at("2026-04-15T13:30").toISO());
  });

  it("defaults the minimum notice when unset", () => {
    const range = getBookableRange(
      { timeZone: TZ },
      at("2026-04-15T12:00"),
    );

    assert.equal(
      range?.start.toISO(),
      at("2026-04-15T12:00").plus({ minutes: DEFAULT_MIN_NOTICE_MINS }).toISO(),
    );
  });

  it("starts at startDate while the campaign is still in the future", () => {
    const range = getBookableRange(campaign, at("2026-01-10T12:00"));

    assert.equal(range?.start.toISO(), at("2026-03-01T00:00").toISO());
  });

  it("ends at the start of the day after endDate", () => {
    const range = getBookableRange(campaign, at("2026-04-15T12:00"));

    assert.equal(range?.end?.toISO(), at("2026-06-01T00:00").toISO());
  });

  it("keeps a Denver schedule open through local midnight, not UTC midnight", () => {
    // The off-by-one this design exists to avoid: a Date for "2026-05-31" is
    // UTC midnight, which is 18:00 on May 30 in Denver.
    const range = getBookableRange(campaign, at("2026-05-31T18:00"));

    assert.isNotNull(range);
    assert.isTrue(range!.end! > at("2026-05-31T23:59"));
    assert.equal(range!.end!.setZone(TZ).toFormat("yyyy-LL-dd HH:mm"), "2026-06-01 00:00");
  });

  it("is unbounded when neither maxDaysOut nor endDate is set", () => {
    const range = getBookableRange({ timeZone: TZ }, at("2026-04-15T12:00"));

    assert.isNull(range?.end ?? null);
  });

  describe("intersection of the rolling and absolute windows", () => {
    it("lets maxDaysOut cut a long campaign short", () => {
      const range = getBookableRange(
        { ...campaign, maxDaysOut: 14 },
        at("2026-03-02T12:00"),
      );

      assert.equal(range?.end?.toISO(), at("2026-03-16T12:00").toISO());
    });

    it("lets endDate win when it falls inside the rolling window", () => {
      const range = getBookableRange(
        { ...campaign, maxDaysOut: 60 },
        at("2026-05-20T12:00"),
      );

      assert.equal(range?.end?.toISO(), at("2026-06-01T00:00").toISO());
    });
  });

  it("returns null once the campaign has closed", () => {
    assert.isNull(getBookableRange(campaign, at("2026-06-02T12:00")));
  });

  it("returns null when minimum notice pushes past the end of the campaign", () => {
    const range = getBookableRange(
      { ...campaign, minNoticeMins: 60 * 48 },
      at("2026-05-31T12:00"),
    );

    assert.isNull(range);
  });

  it("returns null when disabled", () => {
    assert.isNull(
      getBookableRange({ ...campaign, active: false }, at("2026-04-15T12:00")),
    );
  });

  it("counts maxDaysOut in real days across a DST change", () => {
    // 2026-03-08 springs forward, so 10 calendar days is 239 real hours.
    const range = getBookableRange(
      { timeZone: TZ, minNoticeMins: 0, maxDaysOut: 10 },
      at("2026-03-05T12:00"),
    );

    assert.equal(
      range?.end?.setZone(TZ).toFormat("yyyy-LL-dd HH:mm"),
      "2026-03-15 12:00",
    );
  });

  it("rejects an unparseable date rather than silently ignoring it", () => {
    assert.throws(
      () => getBookableRange({ timeZone: TZ, startDate: "not-a-date" }, at("2026-04-15T12:00")),
      /Invalid schedule date/,
    );
  });

  it("rejects an unknown time zone", () => {
    assert.throws(
      () =>
        getBookableRange(
          { timeZone: "Mars/Olympus", startDate: "2026-03-01" },
          at("2026-04-15T12:00"),
        ),
      /Invalid schedule date/,
    );
  });
});
