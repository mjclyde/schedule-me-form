import { describe, it, expect } from "vitest";
import { formatTimeOfDay } from "./formatTime";

// Locale is pinned so the assertions do not depend on where this runs; the
// app itself passes nothing and renders in the visitor's own locale.
const EN = "en-US";

// Constructed in local time on purpose: toLocaleTimeString renders in the
// runtime's zone, so a UTC literal would make these assertions machine-specific.
function at(hour: number, minute: number) {
  return new Date(2026, 8, 9, hour, minute);
}

describe("formatTimeOfDay", () => {
  it("drops the minutes on a whole hour", () => {
    expect(formatTimeOfDay(at(19, 0), EN)).toBe("7 PM");
  });

  it("keeps the minutes on a quarter hour", () => {
    // A 15-minute schedule renders four slots an hour. Dropping the minutes
    // makes every one of them read "7 PM".
    expect(formatTimeOfDay(at(19, 15), EN)).toBe("7:15 PM");
  });

  it("renders every slot in an hour distinctly", () => {
    const shown = [at(19, 0), at(19, 15), at(19, 30), at(19, 45)].map((d) =>
      formatTimeOfDay(d, EN),
    );

    expect(shown).toEqual(["7 PM", "7:15 PM", "7:30 PM", "7:45 PM"]);
  });

  it("pads a single-digit minute", () => {
    expect(formatTimeOfDay(at(9, 5), EN)).toBe("9:05 AM");
  });

  it("renders midnight and noon", () => {
    expect(formatTimeOfDay(at(0, 0), EN)).toBe("12 AM");
    expect(formatTimeOfDay(at(12, 30), EN)).toBe("12:30 PM");
  });
});
