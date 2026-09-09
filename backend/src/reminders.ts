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

/** How far ahead a sweep looks. Paired with an hourly cron, not a daily one. */
const REMINDER_LEAD_HOURS = 24;

/**
 * The 24-hour reminder sweep, run off the calendar rather than Mongo.
 *
 * Each sweep asks Google for this schedule's own bookings starting in the next
 * day, skips the ones already stamped, texts the rest, and stamps them. The
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
      const localNow = now.setZone(schedule.timeZone);
      if (!shouldSweep(schedule, localNow)) {
        continue;
      }
      // One unreachable calendar must not stop the other schedules' reminders.
      await this.sweep(schedule, localNow).catch((err) =>
        console.error(`Reminder sweep failed for ${schedule._id}: ${err}`),
      );
    }
  }

  private async sweep(schedule: Schedule, now: DateTime) {
    const calendar = await this.calendarManager.getCalendar(
      schedule.ownerPersonId,
    );
    const events = await calendar.listAppEvents({
      calendarId: schedule.calendarId,
      timeMin: now.toJSDate(),
      timeMax: now.plus({ hours: REMINDER_LEAD_HOURS }).toJSDate(),
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
