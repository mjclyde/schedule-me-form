import { hy } from "hydratable";
import { DateTime } from "luxon";
import { BaseDoc, BaseModel } from "./baseDoc";
import { PublicSchedule, ScheduleState } from "../../common/schedule";

export interface ScheduleNotify {
  id: string;
  name: string;
  phone: string;
}

export interface ScheduleModel extends BaseModel {
  /** `_id` is a slug used in URLs, e.g. "2026spring". */
  name: string;
  type: string;
  description: string;

  /** Whose Google tokens and calendar this schedule books against. */
  ownerPersonId: string;
  calendarId: string;
  timeZone: string;

  durationMins: number;
  incrementMins?: number;
  bufferBeforeMins?: number;
  bufferAfterMins?: number;
  minNoticeMins?: number;
  maxDaysOut?: number;
  alignTo?: "hour" | "window";

  /**
   * Absolute booking window, as calendar dates ("YYYY-MM-DD") resolved against
   * `timeZone`. `endDate` is inclusive. Stored as strings rather than Dates: a
   * Date for "May 31" is UTC midnight, which is May 30 in America/Denver.
   */
  startDate?: string;
  endDate?: string;

  appointmentTitle?: string;
  requireEmail?: boolean;
  active?: boolean;

  /** People who get an SMS when someone books or cancels. */
  notify?: ScheduleNotify[];
}

/** The fields the window calculation actually needs. */
export interface BookingWindowConfig {
  timeZone: string;
  minNoticeMins?: number;
  maxDaysOut?: number;
  startDate?: string;
  endDate?: string;
  active?: boolean;
}

export interface BookableRange {
  start: DateTime;
  /** Null when neither `maxDaysOut` nor `endDate` bounds the window. */
  end: DateTime | null;
}

export const DEFAULT_MIN_NOTICE_MINS = 60;

export class Schedule extends BaseDoc<ScheduleModel> implements ScheduleModel {
  @hy("string") name: string;
  @hy("string") type: string;
  @hy("string") description: string;
  @hy("string") ownerPersonId: string;
  @hy("string") calendarId: string;
  @hy("string") timeZone: string;
  @hy("number") durationMins: number;
  @hy("number") incrementMins?: number;
  @hy("number") bufferBeforeMins?: number;
  @hy("number") bufferAfterMins?: number;
  @hy("number") minNoticeMins?: number;
  @hy("number") maxDaysOut?: number;
  @hy("string") alignTo?: "hour" | "window";
  @hy("string") startDate?: string;
  @hy("string") endDate?: string;
  @hy("string") appointmentTitle?: string;
  @hy("bool") requireEmail?: boolean;
  @hy("bool") active?: boolean;
  @hy("array", { arrayElementType: "object" }) notify?: ScheduleNotify[];

  getOpenState(now: DateTime) {
    return getOpenState(this, now);
  }

  getBookableRange(now: DateTime) {
    return getBookableRange(this, now);
  }

  /** Strips the owner's calendar address and notify phone numbers. */
  toPublic(now: DateTime): PublicSchedule {
    const range = this.getBookableRange(now);
    return {
      _id: this._id,
      name: this.name,
      type: this.type,
      description: this.description,
      timeZone: this.timeZone,
      durationMins: this.durationMins,
      state: this.getOpenState(now),
      requireEmail: this.requireEmail,
      startDate: this.startDate,
      endDate: this.endDate,
      bookableFrom: range?.start.toISO() ?? undefined,
      bookableTo: range?.end?.toISO() ?? undefined,
    };
  }
}

/**
 * Which of the four page states the schedule is in.
 *
 * `before`/`closed` reflect only the absolute date window — a schedule inside
 * its window is `open` even when the minimum notice period leaves nothing
 * bookable today.
 */
export function getOpenState(
  config: BookingWindowConfig,
  now: DateTime,
): ScheduleState {
  if (config.active === false) {
    return "disabled";
  }
  const opensAt = startOfDay(config.startDate, config.timeZone);
  if (opensAt && now < opensAt) {
    return "before";
  }
  const closesAt = endOfDayExclusive(config.endDate, config.timeZone);
  if (closesAt && now >= closesAt) {
    return "closed";
  }
  return "open";
}

/**
 * The intersection of the rolling window (minimum notice → `maxDaysOut`) and
 * the absolute one (`startDate` → `endDate`). Whichever is tighter wins.
 *
 * @returns null when the schedule is disabled or the intersection is empty.
 */
export function getBookableRange(
  config: BookingWindowConfig,
  now: DateTime,
): BookableRange | null {
  if (config.active === false) {
    return null;
  }

  const minNotice = config.minNoticeMins ?? DEFAULT_MIN_NOTICE_MINS;
  let start = now.plus({ minutes: minNotice });
  const opensAt = startOfDay(config.startDate, config.timeZone);
  if (opensAt && opensAt > start) {
    start = opensAt;
  }

  let end: DateTime | null = null;
  if (config.maxDaysOut !== undefined) {
    end = now.plus({ days: config.maxDaysOut });
  }
  const closesAt = endOfDayExclusive(config.endDate, config.timeZone);
  if (closesAt && (!end || closesAt < end)) {
    end = closesAt;
  }

  if (end && end <= start) {
    return null;
  }
  return { start, end };
}

function startOfDay(date: string | undefined, timeZone: string) {
  return parseDay(date, timeZone);
}

/**
 * The instant the inclusive `endDate` stops being bookable: the start of the
 * following day. Using start-of-next-day rather than 23:59:59.999 keeps the
 * bound exact and stays correct across a DST change on that date.
 */
function endOfDayExclusive(date: string | undefined, timeZone: string) {
  return parseDay(date, timeZone)?.plus({ days: 1 }) ?? null;
}

function parseDay(date: string | undefined, timeZone: string) {
  if (!date) {
    return null;
  }
  const parsed = DateTime.fromISO(date, { zone: timeZone }).startOf("day");
  if (!parsed.isValid) {
    throw new Error(
      `Invalid schedule date "${date}" for time zone "${timeZone}": ${parsed.invalidReason}`,
    );
  }
  return parsed;
}
