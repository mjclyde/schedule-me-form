import { DateTime } from "luxon";
import { calendar_v3 } from "googleapis";
import { PersonService } from "./person.service";
import { GoogleCalendarManager } from "../google/googleCalendarManager";
import {
  clampRanges,
  generateSlots,
  splitWindowsAndBusy,
  TimeRange,
} from "../google/availability";
import { DEFAULT_MIN_NOTICE_MINS, Schedule } from "../models/schedule";
import { TtlCache } from "../utils/ttlCache";

/** Long enough to collapse a burst of month-flipping, short enough to stay fresh. */
const CALENDAR_CACHE_TTL_MS = 30 * 1000;

/**
 * Turns a calendar into bookable slots.
 *
 * A singleton rather than a DI service so the availability endpoint and the
 * booking endpoint share one cache — and, more importantly, one definition of
 * "is this slot offered". A booking validated against different rules than the
 * ones that produced the slot is how double-bookings get in.
 */
export class AvailabilityService {
  private static instance: AvailabilityService;

  static GetInstance(persons: PersonService) {
    if (!this.instance) {
      this.instance = new AvailabilityService(persons);
    }
    return this.instance;
  }

  private calendarManager: GoogleCalendarManager;
  private cache = new TtlCache<calendar_v3.Schema$Event[]>(
    CALENDAR_CACHE_TTL_MS,
  );

  private constructor(persons: PersonService) {
    this.calendarManager = GoogleCalendarManager.GetInstance(persons);
  }

  async computeSlots(schedule: Schedule, range: TimeRange, now: DateTime) {
    const events = await this.listEvents(schedule, range);
    const { windows, busy } = splitWindowsAndBusy(events, {
      defaultTimeZone: schedule.timeZone,
    });

    return generateSlots({
      windows: clampRanges(windows, range),
      busy,
      durationMins: schedule.durationMins,
      incrementMins: schedule.incrementMins,
      bufferBeforeMins: schedule.bufferBeforeMins,
      bufferAfterMins: schedule.bufferAfterMins,
      minNoticeMins: schedule.minNoticeMins ?? DEFAULT_MIN_NOTICE_MINS,
      alignTo: schedule.alignTo,
      now,
    });
  }

  /**
   * Whether `start` is a slot this schedule would currently offer.
   *
   * Recomputed from the calendar rather than trusted from the client, and
   * deliberately the same code path that produced the slot in the first place.
   */
  async isSlotOffered(schedule: Schedule, start: DateTime, now: DateTime) {
    const range: TimeRange = {
      start: start.startOf("day"),
      end: start.endOf("day"),
    };
    const slots = await this.computeSlots(schedule, range, now);
    return slots.some((slot) => slot.start.toMillis() === start.toMillis());
  }

  async listEvents(schedule: Schedule, range: TimeRange) {
    const key = this.cacheKey(schedule, range);
    return this.cache.wrap(key, async () => {
      const calendar = await this.calendarManager.getCalendar(
        schedule.ownerPersonId,
      );
      // Busy events starting before the range can still overlap into it, so
      // widen the query by a day rather than trusting the range boundary.
      return calendar.listEvents({
        calendarId: schedule.calendarId,
        timeMin: range.start.minus({ days: 1 }).toJSDate(),
        timeMax: range.end.plus({ days: 1 }).toJSDate(),
      });
    });
  }

  /**
   * Drops every cached range for a schedule's calendar.
   *
   * Called after a booking: the new event makes the slot busy, and without this
   * the availability endpoint would keep offering it for the rest of the TTL.
   * The conflict check still catches a genuine race, so this is about not
   * showing people a slot that is already gone.
   */
  invalidate(schedule: Schedule) {
    this.cache.deleteByPrefix(this.cachePrefix(schedule));
  }

  /** Bypasses the cache — used before a write, where staleness is not acceptable. */
  async listEventsUncached(schedule: Schedule, range: TimeRange) {
    this.invalidate(schedule);
    return this.listEvents(schedule, range);
  }

  private cacheKey(schedule: Schedule, range: TimeRange) {
    return (
      this.cachePrefix(schedule) +
      [range.start.toISO(), range.end.toISO()].join("|")
    );
  }

  private cachePrefix(schedule: Schedule) {
    return [schedule.ownerPersonId, schedule.calendarId, ""].join("|");
  }
}
