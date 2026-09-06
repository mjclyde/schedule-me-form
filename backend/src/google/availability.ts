import { DateTime } from "luxon";

/**
 * Pure availability engine.
 *
 * Deliberately free of any `googleapis` import so it can be unit tested without
 * a network or an OAuth client. `CalendarEventLike` is a structural subset of
 * `calendar_v3.Schema$Event`, so real Google events satisfy it as-is.
 *
 * The rules (see docs/calendar-pivot-plan.md §3):
 *   - a *timed* event marked "Show as: Free" is a bookable window
 *   - everything else on the calendar is busy
 *   - an *all-day* Free event is ignored entirely, because calendar clients
 *     commonly default all-day events to Free and a single all-day "PTO" entry
 *     would otherwise turn the whole day into bookable time
 */

export interface CalendarEventDateLike {
  /** All-day events use `date` ("YYYY-MM-DD"). Google treats the end date as exclusive. */
  date?: string | null;
  /** Timed events use `dateTime` (RFC3339, normally carrying a UTC offset). */
  dateTime?: string | null;
  timeZone?: string | null;
}

export interface CalendarEventLike {
  status?: string | null;
  transparency?: string | null;
  start?: CalendarEventDateLike | null;
  end?: CalendarEventDateLike | null;
}

export interface TimeRange {
  start: DateTime;
  end: DateTime;
}

export interface SplitResult {
  /** Bookable windows, merged and sorted. */
  windows: TimeRange[];
  /** Conflicts, merged and sorted. */
  busy: TimeRange[];
}

export interface GenerateSlotsParams {
  windows: TimeRange[];
  busy: TimeRange[];
  /** Length of the appointment itself. */
  durationMins: number;
  /** Spacing between consecutive start times. Defaults to `durationMins`. */
  incrementMins?: number;
  /** Padding required before/after the appointment; not offered to the visitor. */
  bufferBeforeMins?: number;
  bufferAfterMins?: number;
  /** How far ahead the earliest bookable slot must be. */
  minNoticeMins?: number;
  /**
   * `hour` (default) anchors start times to the top of the hour, so a window
   * starting at 9:07 still yields 9:15 / 9:30. `window` anchors to the window's
   * own start, yielding 9:07 / 9:22.
   */
  alignTo?: "hour" | "window";
  now: DateTime;
}

const TRANSPARENT = "transparent";
const CANCELLED = "cancelled";

/**
 * Classifies raw calendar events into bookable windows and busy time.
 *
 * @param events - Events from a single `events.list` call over the target range
 * @param opts.defaultTimeZone - The calendar's own time zone, used for all-day
 *   events and for any timed event that omits an offset
 */
export function splitWindowsAndBusy(
  events: CalendarEventLike[],
  opts: { defaultTimeZone: string },
): SplitResult {
  const windows: TimeRange[] = [];
  const busy: TimeRange[] = [];

  for (const event of events) {
    if (event.status === CANCELLED) {
      continue;
    }

    const isFree = event.transparency === TRANSPARENT;
    const isAllDay = !!event.start?.date && !event.start?.dateTime;

    // All-day Free events are neither available nor busy. See the note above.
    if (isFree && isAllDay) {
      continue;
    }

    const range = toTimeRange(event, opts.defaultTimeZone);
    if (!range) {
      continue;
    }

    (isFree ? windows : busy).push(range);
  }

  return { windows: mergeRanges(windows), busy: mergeRanges(busy) };
}

/**
 * Expands bookable windows into concrete appointment start times, dropping any
 * that collide with busy time.
 *
 * `windows` should already be clamped to the caller's requested range; this
 * function only applies `minNoticeMins` on top of it.
 */
export function generateSlots(params: GenerateSlotsParams): TimeRange[] {
  const {
    durationMins,
    bufferBeforeMins = 0,
    bufferAfterMins = 0,
    minNoticeMins = 0,
    alignTo = "hour",
    now,
  } = params;
  const incrementMins = params.incrementMins ?? durationMins;

  if (durationMins <= 0) {
    throw new Error(`durationMins must be positive, got ${durationMins}`);
  }
  // A non-positive increment would never advance the cursor.
  if (incrementMins <= 0) {
    throw new Error(`incrementMins must be positive, got ${incrementMins}`);
  }

  const earliest = now.plus({ minutes: minNoticeMins });
  const windows = mergeRanges(params.windows);
  const busy = mergeRanges(params.busy);
  const slots: TimeRange[] = [];

  for (const window of windows) {
    const from = window.start > earliest ? window.start : earliest;
    let cursor = alignUp(from, incrementMins, alignTo, window.start);

    while (cursor.plus({ minutes: durationMins }) <= window.end) {
      const end = cursor.plus({ minutes: durationMins });
      const padded: TimeRange = {
        start: cursor.minus({ minutes: bufferBeforeMins }),
        end: end.plus({ minutes: bufferAfterMins }),
      };
      if (!busy.some((b) => overlaps(padded, b))) {
        slots.push({ start: cursor, end });
      }
      cursor = cursor.plus({ minutes: incrementMins });
    }
  }

  return slots;
}

/**
 * Trims ranges to `bound`, dropping any that fall entirely outside it.
 *
 * Availability windows routinely extend past the range the caller asked about
 * (a window running to 5pm when the request ends at noon); without this they
 * would yield slots outside the requested range.
 */
export function clampRanges(ranges: TimeRange[], bound: TimeRange): TimeRange[] {
  const clamped: TimeRange[] = [];
  for (const range of ranges) {
    const start = range.start > bound.start ? range.start : bound.start;
    const end = range.end < bound.end ? range.end : bound.end;
    if (start < end) {
      clamped.push({ start, end });
    }
  }
  return clamped;
}

/** Half-open overlap: touching ranges (a.end === b.start) do not conflict. */
export function overlaps(a: TimeRange, b: TimeRange) {
  return a.start < b.end && b.start < a.end;
}

/** Sorts by start and collapses overlapping or touching ranges. */
export function mergeRanges(ranges: TimeRange[]): TimeRange[] {
  const sorted = [...ranges].sort((a, b) => a.start.toMillis() - b.start.toMillis());
  const merged: TimeRange[] = [];

  for (const range of sorted) {
    const last = merged[merged.length - 1];
    if (last && range.start <= last.end) {
      if (range.end > last.end) {
        last.end = range.end;
      }
    } else {
      merged.push({ start: range.start, end: range.end });
    }
  }

  return merged;
}

/**
 * Rounds `dt` up to the next valid start time.
 *
 * Anchors to the top of the hour or to the window's start depending on
 * `alignTo`. Uses real elapsed minutes, so a DST transition inside the window
 * shifts the wall-clock times rather than dropping slots.
 */
function alignUp(
  dt: DateTime,
  incrementMins: number,
  alignTo: "hour" | "window",
  windowStart: DateTime,
): DateTime {
  const anchor = alignTo === "window" ? windowStart : dt.startOf("hour");
  const elapsed = dt.diff(anchor, "minutes").minutes;
  if (elapsed <= 0) {
    return anchor;
  }
  const steps = Math.ceil(elapsed / incrementMins);
  return anchor.plus({ minutes: steps * incrementMins });
}

function toTimeRange(
  event: CalendarEventLike,
  defaultTimeZone: string,
): TimeRange | null {
  const start = toDateTime(event.start, defaultTimeZone);
  const end = toDateTime(event.end, defaultTimeZone);
  if (!start || !end || !start.isValid || !end.isValid || end <= start) {
    return null;
  }
  return { start, end };
}

function toDateTime(
  value: CalendarEventDateLike | null | undefined,
  defaultTimeZone: string,
): DateTime | null {
  if (!value) {
    return null;
  }
  if (value.dateTime) {
    // `dateTime` normally carries its own offset, so the instant is already
    // unambiguous; the zone here only controls how it is rendered downstream.
    return DateTime.fromISO(value.dateTime, {
      zone: value.timeZone || defaultTimeZone,
    });
  }
  if (value.date) {
    // Google's all-day end date is exclusive, which is exactly the semantics of
    // an interval end, so it needs no adjustment.
    return DateTime.fromISO(value.date, { zone: defaultTimeZone });
  }
  return null;
}
