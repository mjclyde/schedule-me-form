import { assert } from "chai";
import { DateTime } from "luxon";
import {
  CalendarEventLike,
  clampRanges,
  generateSlots,
  mergeRanges,
  splitWindowsAndBusy,
  TimeRange,
} from "../src/google/availability";

const TZ = "America/Denver";

/** A timed event. `transparency: "transparent"` marks it as a bookable window. */
function timed(
  start: string,
  end: string,
  extra: Partial<CalendarEventLike> = {},
): CalendarEventLike {
  return {
    start: { dateTime: start, timeZone: TZ },
    end: { dateTime: end, timeZone: TZ },
    ...extra,
  };
}

/** An all-day event. Google's end date is exclusive. */
function allDay(
  start: string,
  end: string,
  extra: Partial<CalendarEventLike> = {},
): CalendarEventLike {
  return {
    start: { date: start },
    end: { date: end },
    ...extra,
  };
}

const free = { transparency: "transparent" };

function at(local: string) {
  return DateTime.fromISO(local, { zone: TZ });
}

/** Renders slots as "HH:mm" for readable assertions. */
function times(slots: TimeRange[]) {
  return slots.map((s) => s.start.setZone(TZ).toFormat("HH:mm"));
}

function days(slots: TimeRange[]) {
  return slots.map((s) => s.start.setZone(TZ).toFormat("yyyy-LL-dd HH:mm"));
}

describe("splitWindowsAndBusy", () => {
  it("treats a timed Free event as a bookable window", () => {
    const { windows, busy } = splitWindowsAndBusy(
      [timed("2026-03-02T09:00:00-07:00", "2026-03-02T11:00:00-07:00", free)],
      { defaultTimeZone: TZ },
    );

    assert.lengthOf(windows, 1);
    assert.lengthOf(busy, 0);
    assert.equal(windows[0].start.setZone(TZ).toFormat("HH:mm"), "09:00");
    assert.equal(windows[0].end.setZone(TZ).toFormat("HH:mm"), "11:00");
  });

  it("treats a timed Busy event as a conflict", () => {
    const { windows, busy } = splitWindowsAndBusy(
      [timed("2026-03-02T09:00:00-07:00", "2026-03-02T10:00:00-07:00")],
      { defaultTimeZone: TZ },
    );

    assert.lengthOf(windows, 0);
    assert.lengthOf(busy, 1);
  });

  it("ignores an all-day Free event entirely", () => {
    // Calendar clients commonly default all-day events to Free. Honouring one
    // would turn a whole day into bookable time.
    const { windows, busy } = splitWindowsAndBusy(
      [allDay("2026-03-02", "2026-03-03", free)],
      { defaultTimeZone: TZ },
    );

    assert.lengthOf(windows, 0);
    assert.lengthOf(busy, 0);
  });

  it("still blocks on an all-day Busy event, using the exclusive end date", () => {
    const { busy } = splitWindowsAndBusy([allDay("2026-03-02", "2026-03-03")], {
      defaultTimeZone: TZ,
    });

    assert.lengthOf(busy, 1);
    assert.equal(busy[0].start.setZone(TZ).toISO(), at("2026-03-02T00:00").toISO());
    assert.equal(busy[0].end.setZone(TZ).toISO(), at("2026-03-03T00:00").toISO());
  });

  it("skips cancelled events", () => {
    const { windows, busy } = splitWindowsAndBusy(
      [
        timed("2026-03-02T09:00:00-07:00", "2026-03-02T11:00:00-07:00", {
          ...free,
          status: "cancelled",
        }),
        timed("2026-03-02T09:00:00-07:00", "2026-03-02T10:00:00-07:00", {
          status: "cancelled",
        }),
      ],
      { defaultTimeZone: TZ },
    );

    assert.lengthOf(windows, 0);
    assert.lengthOf(busy, 0);
  });

  it("skips malformed and zero-length events", () => {
    const { windows, busy } = splitWindowsAndBusy(
      [
        { transparency: "transparent", start: null, end: null },
        timed("2026-03-02T09:00:00-07:00", "2026-03-02T09:00:00-07:00", free),
        timed("2026-03-02T11:00:00-07:00", "2026-03-02T09:00:00-07:00", free),
      ],
      { defaultTimeZone: TZ },
    );

    assert.lengthOf(windows, 0);
    assert.lengthOf(busy, 0);
  });

  it("merges overlapping windows", () => {
    const { windows } = splitWindowsAndBusy(
      [
        timed("2026-03-02T09:00:00-07:00", "2026-03-02T11:00:00-07:00", free),
        timed("2026-03-02T10:00:00-07:00", "2026-03-02T12:00:00-07:00", free),
      ],
      { defaultTimeZone: TZ },
    );

    assert.lengthOf(windows, 1);
    assert.equal(windows[0].end.setZone(TZ).toFormat("HH:mm"), "12:00");
  });
});

describe("mergeRanges", () => {
  it("collapses touching ranges and leaves gaps alone", () => {
    const merged = mergeRanges([
      { start: at("2026-03-02T11:00"), end: at("2026-03-02T12:00") },
      { start: at("2026-03-02T09:00"), end: at("2026-03-02T10:00") },
      { start: at("2026-03-02T10:00"), end: at("2026-03-02T11:00") },
      { start: at("2026-03-02T14:00"), end: at("2026-03-02T15:00") },
    ]);

    assert.lengthOf(merged, 2);
    assert.equal(merged[0].start.toFormat("HH:mm"), "09:00");
    assert.equal(merged[0].end.toFormat("HH:mm"), "12:00");
    assert.equal(merged[1].start.toFormat("HH:mm"), "14:00");
  });

  it("does not mutate its input", () => {
    const input = [
      { start: at("2026-03-02T09:00"), end: at("2026-03-02T10:00") },
      { start: at("2026-03-02T10:00"), end: at("2026-03-02T11:00") },
    ];
    mergeRanges(input);

    assert.equal(input[0].end.toFormat("HH:mm"), "10:00");
  });
});

describe("clampRanges", () => {
  const bound: TimeRange = {
    start: at("2026-03-02T09:00"),
    end: at("2026-03-02T17:00"),
  };

  it("trims a range that overhangs the bound on both sides", () => {
    const [clamped] = clampRanges(
      [{ start: at("2026-03-02T08:00"), end: at("2026-03-02T18:00") }],
      bound,
    );

    assert.equal(clamped.start.toFormat("HH:mm"), "09:00");
    assert.equal(clamped.end.toFormat("HH:mm"), "17:00");
  });

  it("leaves a range already inside the bound untouched", () => {
    const inside = { start: at("2026-03-02T10:00"), end: at("2026-03-02T11:00") };
    const [clamped] = clampRanges([inside], bound);

    assert.equal(clamped.start.toFormat("HH:mm"), "10:00");
    assert.equal(clamped.end.toFormat("HH:mm"), "11:00");
  });

  it("drops ranges outside the bound, including ones that merely touch it", () => {
    assert.isEmpty(
      clampRanges(
        [
          { start: at("2026-03-01T09:00"), end: at("2026-03-01T17:00") },
          { start: at("2026-03-02T17:00"), end: at("2026-03-02T18:00") },
          { start: at("2026-03-02T08:00"), end: at("2026-03-02T09:00") },
        ],
        bound,
      ),
    );
  });
});

describe("generateSlots", () => {
  const window9to11: TimeRange = {
    start: at("2026-03-02T09:00"),
    end: at("2026-03-02T11:00"),
  };
  // Well before the window, so min-notice never interferes unless tested.
  const now = at("2026-03-01T08:00");

  it("fills a window back to back", () => {
    const slots = generateSlots({
      windows: [window9to11],
      busy: [],
      durationMins: 15,
      now,
    });

    assert.deepEqual(times(slots), [
      "09:00", "09:15", "09:30", "09:45",
      "10:00", "10:15", "10:30", "10:45",
    ]);
  });

  it("never emits a slot that would run past the end of the window", () => {
    const slots = generateSlots({
      windows: [{ start: at("2026-03-02T09:00"), end: at("2026-03-02T09:50") }],
      busy: [],
      durationMins: 15,
      now,
    });

    assert.deepEqual(times(slots), ["09:00", "09:15", "09:30"]);
  });

  it("drops slots that collide with busy time", () => {
    const slots = generateSlots({
      windows: [window9to11],
      busy: [{ start: at("2026-03-02T09:30"), end: at("2026-03-02T10:00") }],
      durationMins: 15,
      now,
    });

    assert.deepEqual(times(slots), [
      "09:00", "09:15",
      "10:00", "10:15", "10:30", "10:45",
    ]);
  });

  it("allows a slot that merely touches busy time", () => {
    const slots = generateSlots({
      windows: [{ start: at("2026-03-02T09:00"), end: at("2026-03-02T09:30") }],
      busy: [{ start: at("2026-03-02T09:15"), end: at("2026-03-02T10:00") }],
      durationMins: 15,
      now,
    });

    assert.deepEqual(times(slots), ["09:00"]);
  });

  it("honours buffers around the appointment", () => {
    // Padding widens each candidate by 10 minutes on both sides, so 09:15
    // (which pads forward to 09:40) and 10:00 (which pads back to 09:50) both
    // reach into the 09:30 meeting even though the appointments themselves do not.
    const slots = generateSlots({
      windows: [window9to11],
      busy: [{ start: at("2026-03-02T09:30"), end: at("2026-03-02T10:00") }],
      durationMins: 15,
      bufferAfterMins: 10,
      bufferBeforeMins: 10,
      now,
    });

    assert.deepEqual(times(slots), ["09:00", "10:15", "10:30", "10:45"]);
  });

  it("hides slots inside the minimum notice period", () => {
    const slots = generateSlots({
      windows: [window9to11],
      busy: [],
      durationMins: 15,
      minNoticeMins: 120,
      now: at("2026-03-02T08:20"),
    });

    // 08:20 + 2h = 10:20, rounded up to the next 15-minute mark.
    assert.deepEqual(times(slots), ["10:30", "10:45"]);
  });

  it("separates the appointment length from the spacing between starts", () => {
    const slots = generateSlots({
      windows: [{ start: at("2026-03-02T09:00"), end: at("2026-03-02T10:00") }],
      busy: [],
      durationMins: 30,
      incrementMins: 15,
      now,
    });

    assert.deepEqual(times(slots), ["09:00", "09:15", "09:30"]);
  });

  describe("alignment", () => {
    const ragged: TimeRange = {
      start: at("2026-03-02T09:07"),
      end: at("2026-03-02T10:00"),
    };

    it("anchors to the top of the hour by default", () => {
      const slots = generateSlots({
        windows: [ragged],
        busy: [],
        durationMins: 15,
        now,
      });

      assert.deepEqual(times(slots), ["09:15", "09:30", "09:45"]);
    });

    it("anchors to the window start when asked", () => {
      const slots = generateSlots({
        windows: [ragged],
        busy: [],
        durationMins: 15,
        alignTo: "window",
        now,
      });

      assert.deepEqual(times(slots), ["09:07", "09:22", "09:37"]);
    });
  });

  it("offers a slot spanning the seam between two adjacent windows", () => {
    const slots = generateSlots({
      windows: [
        { start: at("2026-03-02T09:00"), end: at("2026-03-02T09:30") },
        { start: at("2026-03-02T09:30"), end: at("2026-03-02T10:00") },
      ],
      busy: [],
      durationMins: 30,
      now,
    });

    assert.deepEqual(times(slots), ["09:00", "09:30"]);
  });

  it("advances in real time across a spring-forward transition", () => {
    // 2026-03-08: America/Denver skips 02:00-03:00, so midnight to 06:00 local
    // is only five real hours and yields five hour-long slots.
    const slots = generateSlots({
      windows: [
        { start: at("2026-03-08T00:00"), end: at("2026-03-08T06:00") },
      ],
      busy: [],
      durationMins: 60,
      now: at("2026-03-01T00:00"),
    });

    assert.deepEqual(times(slots), ["00:00", "01:00", "03:00", "04:00", "05:00"]);
  });

  it("advances in real time across a fall-back transition", () => {
    // 2026-11-01: 01:00-02:00 happens twice, so the same wall-clock span is one
    // hour longer and both passes through 01:00 are offered.
    const slots = generateSlots({
      windows: [
        { start: at("2026-11-01T00:00"), end: at("2026-11-01T04:00") },
      ],
      busy: [],
      durationMins: 60,
      now: at("2026-10-01T00:00"),
    });

    assert.deepEqual(times(slots), ["00:00", "01:00", "01:00", "02:00", "03:00"]);
  });

  it("returns slots across multiple days in chronological order", () => {
    const slots = generateSlots({
      windows: [
        { start: at("2026-03-03T09:00"), end: at("2026-03-03T09:30") },
        { start: at("2026-03-02T09:00"), end: at("2026-03-02T09:30") },
      ],
      busy: [],
      durationMins: 30,
      now,
    });

    assert.deepEqual(days(slots), [
      "2026-03-02 09:00",
      "2026-03-03 09:00",
    ]);
  });

  it("rejects parameters that would not advance the cursor", () => {
    assert.throws(
      () => generateSlots({ windows: [window9to11], busy: [], durationMins: 0, now }),
      /durationMins must be positive/,
    );
    assert.throws(
      () =>
        generateSlots({
          windows: [window9to11],
          busy: [],
          durationMins: 15,
          incrementMins: 0,
          now,
        }),
      /incrementMins must be positive/,
    );
  });
});

describe("splitWindowsAndBusy + generateSlots", () => {
  it("derives bookable times from a realistic calendar day", () => {
    const events: CalendarEventLike[] = [
      // Two availability windows the owner blocked out as Free.
      timed("2026-03-02T09:00:00-07:00", "2026-03-02T12:00:00-07:00", free),
      timed("2026-03-02T13:00:00-07:00", "2026-03-02T14:00:00-07:00", free),
      // A real meeting inside the morning window.
      timed("2026-03-02T10:00:00-07:00", "2026-03-02T11:00:00-07:00"),
      // An existing booking this app created; opaque, so it blocks like any other.
      timed("2026-03-02T09:30:00-07:00", "2026-03-02T10:00:00-07:00"),
      // Noise that must not affect the result.
      allDay("2026-03-02", "2026-03-03", free),
      timed("2026-03-02T11:00:00-07:00", "2026-03-02T11:30:00-07:00", {
        status: "cancelled",
      }),
    ];

    const { windows, busy } = splitWindowsAndBusy(events, { defaultTimeZone: TZ });
    const slots = generateSlots({
      windows,
      busy,
      durationMins: 30,
      now: at("2026-03-01T09:00"),
    });

    assert.deepEqual(times(slots), ["09:00", "11:00", "11:30", "13:00", "13:30"]);
  });
});
