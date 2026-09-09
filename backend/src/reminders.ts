import { Injector } from "@ncss/api-decorator";
import { DateTime } from "luxon";
import { NotificationService } from "./services/notification.service";
import { PersonService } from "./services/person.service";
import { ScheduleService } from "./services/schedule.service";
import { GoogleCalendarManager } from "./google/googleCalendarManager";
import { GoogleCalendar } from "./google/googleCalendar";
import { readBookingTags } from "./google/bookingTags";
import { BookingEventLike } from "./google/bookingView";
import { BookingWindowConfig, getOpenState, Schedule } from "./models/schedule";
import { appointmentReminder } from "./utils/bookingMessages";

/**
 * How far ahead a sweep looks: through the end of the following day, not a
 * rolling 24 hours.
 *
 * The cron only runs 12:00-18:00, so a rolling window never reaches tomorrow
 * evening — an appointment at 19:00 tomorrow would first be seen at noon on
 * the day itself, giving ~7 hours' notice and a text reading "on <today>".
 * The Mongo query this replaced reached the end of tomorrow for the same
 * reason. Already-reminded bookings are skipped, so a wider window costs
 * nothing but the one extra day of events to filter.
 */
export function reminderWindowEnd(now: DateTime) {
  return now.plus({ days: 1 }).endOf("day");
}

/**
 * The day-before reminder sweep, run off the calendar rather than Mongo.
 *
 * Each sweep asks Google for this schedule's own bookings starting between now
 * and the end of tomorrow, skips the ones already stamped, texts the rest, and
 * stamps them. The
 * stamp lives in `extendedProperties.private.reminderSentAt` on the event
 * itself, so there is no reminder state anywhere else to drift out of sync.
 */
export class Reminders {
  private schedules: ScheduleService;
  private persons: PersonService;
  private notifications: NotificationService;
  private calendarManager: GoogleCalendarManager;

  constructor(injector: Injector) {
    this.schedules = injector.find(ScheduleService);
    this.persons = injector.find(PersonService);
    this.notifications = injector.find(NotificationService);
    this.calendarManager = GoogleCalendarManager.GetInstance(this.persons);
  }

  async run(now: DateTime = DateTime.now()) {
    for (const schedule of await this.schedules.find()) {
      // The whole per-schedule step is guarded, not just the sweep: a
      // malformed startDate/endDate makes getOpenState throw, and one bad row
      // must not skip every remaining schedule — nor, from the cron, escape
      // as an unhandled rejection.
      try {
        const localNow = now.setZone(schedule.timeZone);
        if (shouldSweep(schedule, localNow)) {
          await this.sweep(schedule, localNow);
        }
      } catch (err) {
        console.error(`Reminder sweep failed for ${schedule._id}: ${err}`);
      }
    }
  }

  private async sweep(schedule: Schedule, now: DateTime) {
    const calendar = await this.calendarManager.getCalendar(
      schedule.ownerPersonId,
    );
    const events = await calendar.listAppEvents({
      calendarId: schedule.calendarId,
      timeMin: now.toJSDate(),
      timeMax: reminderWindowEnd(now).toJSDate(),
      // Two schedules can share a calendar; only remind for this one's.
      filters: { scheduleId: schedule._id },
    });

    for (const event of dueForReminder(events)) {
      await this.remind(calendar, schedule, event, now);
    }
  }

  private async remind(
    calendar: GoogleCalendar,
    schedule: Schedule,
    event: BookingEventLike,
    now: DateTime,
  ) {
    const tags = readBookingTags(event);
    const startAt = DateTime.fromISO(event.start?.dateTime || "");
    if (!tags || !event.id || !startAt.isValid) {
      return;
    }

    const person = await this.persons.findById(tags.personId);
    if (person) {
      try {
        await this.notifications.send({
          personId: person._id,
          name: person.name,
          phone: person.phone,
          optOutSMS: person.optOutSMS,
          message: appointmentReminder({
            personName: person.name,
            scheduleType: schedule.type,
            startAt,
            timeZone: schedule.timeZone,
            now,
          }),
        });
      } catch (err) {
        // Leave it unstamped so the next sweep retries. Self-limiting: the
        // booking drops out of the window once the appointment passes.
        console.error(`Reminder SMS failed for ${event.id}: ${err}`);
        return;
      }
    }

    // Stamp even when the person has gone — that will not fix itself, and an
    // unstamped booking is retried every hour until the appointment passes.
    await calendar
      .patchEvent(schedule.calendarId, event.id, {
        // Only this key. Patching the whole private map would drop
        // app/scheduleId/personId and orphan the booking from every query.
        extendedProperties: {
          private: { reminderSentAt: now.toISO() as string },
        },
      })
      .catch((err) =>
        console.error(`Could not stamp reminder on ${event.id}: ${err}`),
      );
  }
}

/**
 * Whether a schedule is worth a Google call this sweep.
 *
 * The cutoff is `endDate` + 1 day rather than `endDate`: appointments happen
 * *on* the last bookable day, so their reminders are still due during it. A
 * schedule that has not opened yet is swept too — an appointment at 09:00 on
 * the opening day needs its reminder the day before.
 */
export function shouldSweep(schedule: BookingWindowConfig, now: DateTime) {
  const state = getOpenState(schedule, now);
  return state !== "disabled" && state !== "closed";
}

/** The app's own bookings that have not been reminded about yet. */
export function dueForReminder<T extends BookingEventLike>(events: T[]): T[] {
  return events.filter((event) => {
    const tags = readBookingTags(event);
    return !!tags && !tags.reminderSentAt && event.status !== "cancelled";
  });
}
