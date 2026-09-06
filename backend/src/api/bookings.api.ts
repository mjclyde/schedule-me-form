import { API, Injector } from "@ncss/api-decorator";
import { Request, Response } from "express";
import { DateTime } from "luxon";
import { ScheduleService } from "../services/schedule.service";
import { PersonService } from "../services/person.service";
import { NotificationService } from "../services/notification.service";
import { AvailabilityService } from "../services/availability.service";
import { GoogleCalendarManager } from "../google/googleCalendarManager";
import {
  buildBookingEvent,
  isBookingWinner,
  overlappingBookings,
} from "../google/bookingEvent";
import { toQueryFilters } from "../google/bookingTags";
import { TimeRange } from "../google/availability";
import { Schedule } from "../models/schedule";
import { Person } from "../models/person";
import { Booking, BookingRequest } from "../../common/booking";
import { FormatPhoneNumber } from "../utils/formatPhoneNumber";
import {
  bookingConfirmation,
  ownerBookingNotice,
} from "../utils/bookingMessages";
import { BadRequestError } from "../errors";

/** A loose check: the authority on deliverability is Google's own invite. */
const EMAIL_PATTERN = /^[^@\s]+@[^@\s.]+\.[^@\s]+$/;

export interface ParsedBooking {
  startAt: DateTime;
  name: string;
  phone: string;
  email?: string;
  remindMe: boolean;
}

export class BookingsAPI {
  private schedules: ScheduleService;
  private persons: PersonService;
  private notifications: NotificationService;
  private availability: AvailabilityService;
  private calendarManager: GoogleCalendarManager;

  constructor(injector: Injector) {
    this.schedules = injector.find(ScheduleService);
    this.persons = injector.find(PersonService);
    this.notifications = injector.find(NotificationService);
    this.availability = AvailabilityService.GetInstance(this.persons);
    this.calendarManager = GoogleCalendarManager.GetInstance(this.persons);
  }

  @API("post", "/Schedules/:id/Bookings")
  async create(req: Request<{ id: string }, {}, BookingRequest>, res: Response) {
    const schedule = await this.schedules.findById(req.params.id);
    if (!schedule || schedule.active === false) {
      return res.sendStatus(404);
    }

    const now = DateTime.now().setZone(schedule.timeZone);
    const booking = parseBookingRequest(req.body, schedule);

    // The client only ever offers slots we produced, but it is the client:
    // re-derive the window and the slot from the calendar before writing.
    const bookable = schedule.getBookableRange(now);
    if (
      !bookable ||
      booking.startAt < bookable.start ||
      (bookable.end && booking.startAt >= bookable.end)
    ) {
      return res.status(422).send("That time is outside this schedule's window");
    }
    if (!(await this.availability.isSlotOffered(schedule, booking.startAt, now))) {
      return res.status(409).send("That time is no longer available");
    }

    const person = await this.upsertPerson(booking);
    const slot: TimeRange = {
      start: booking.startAt,
      end: booking.startAt.plus({ minutes: schedule.durationMins }),
    };

    const created = await this.insertBooking(schedule, slot, person, booking);
    if (!created?.id) {
      return res.status(502).send("Could not create the calendar event");
    }

    // The new event makes the slot busy; drop cached ranges so availability
    // stops offering it immediately rather than after the TTL.
    this.availability.invalidate(schedule);

    if (!(await this.wonTheRace(schedule, slot, created.id))) {
      return res.status(409).send("That time was just taken");
    }

    await this.notify(schedule, person, slot);

    const body: Booking = {
      id: created.id,
      scheduleId: schedule._id,
      startAt: slot.start.toISO() as string,
      endAt: slot.end.toISO() as string,
      invited: !!booking.email,
    };
    res.send(body);
  }

  private async insertBooking(
    schedule: Schedule,
    slot: TimeRange,
    person: Person,
    booking: ParsedBooking,
  ) {
    const calendar = await this.calendarManager.getCalendar(
      schedule.ownerPersonId,
    );
    return calendar.insertEvent(
      schedule.calendarId,
      buildBookingEvent({
        scheduleId: schedule._id,
        scheduleType: schedule.type,
        appointmentTitle: schedule.appointmentTitle,
        timeZone: schedule.timeZone,
        slot,
        person: { id: person._id, name: person.name, phone: person.phone },
        email: booking.email,
      }),
      // Only mail an invite when there is someone to mail it to.
      { sendUpdates: booking.email ? "all" : "none" },
    );
  }

  /**
   * Deletes our own event and reports a loss if another booking beat us to the
   * slot. See isBookingWinner() for why this is a rule rather than a lock.
   */
  private async wonTheRace(
    schedule: Schedule,
    slot: TimeRange,
    ourEventId: string,
  ) {
    const calendar = await this.calendarManager.getCalendar(
      schedule.ownerPersonId,
    );
    const events = await calendar.listEvents({
      calendarId: schedule.calendarId,
      timeMin: slot.start.toJSDate(),
      timeMax: slot.end.toJSDate(),
      privateExtendedProperty: toQueryFilters({ scheduleId: schedule._id }),
    });

    if (isBookingWinner(overlappingBookings(events, slot), ourEventId)) {
      return true;
    }
    await calendar.deleteEvent(schedule.calendarId, ourEventId, {
      sendUpdates: "all",
    });
    this.availability.invalidate(schedule);
    return false;
  }

  private async upsertPerson(booking: ParsedBooking) {
    const existing = await this.persons.findByPhone(booking.phone);
    if (!existing) {
      return this.persons.create({
        name: booking.name,
        phone: booking.phone,
        optOutSMS: !booking.remindMe,
      });
    }
    await this.persons.update(existing._id, {
      name: booking.name,
      optOutSMS: !booking.remindMe,
    });
    existing.name = booking.name;
    return existing;
  }

  private async notify(schedule: Schedule, person: Person, slot: TimeRange) {
    const info = {
      personName: person.name,
      scheduleType: schedule.type,
      startAt: slot.start,
      timeZone: schedule.timeZone,
    };

    // A failed SMS must not fail a booking that is already on the calendar.
    await this.notifications
      .send({
        personId: person._id,
        name: person.name,
        phone: person.phone,
        optOutSMS: person.optOutSMS,
        message: bookingConfirmation(info),
      })
      .catch((err) => console.error(`Failed to send confirmation SMS: ${err}`));

    for (const owner of schedule.notify || []) {
      await this.notifications
        .send({
          personId: owner.id,
          name: owner.name,
          phone: owner.phone,
          message: ownerBookingNotice(info),
        })
        .catch((err) => console.error(`Failed to notify ${owner.id}: ${err}`));
    }
  }
}

/** Validates and normalizes the request body. Throws BadRequestError on bad input. */
export function parseBookingRequest(
  body: BookingRequest | undefined,
  schedule: { requireEmail?: boolean; timeZone: string },
): ParsedBooking {
  const name = (body?.name || "").trim();
  if (!name) {
    throw new BadRequestError("`name` is required");
  }

  const phone = FormatPhoneNumber((body?.phone || "").trim());
  if (!/^\+\d{10,15}$/.test(phone)) {
    throw new BadRequestError("`phone` is not a valid phone number");
  }

  const email = (body?.email || "").trim() || undefined;
  if (email && !EMAIL_PATTERN.test(email)) {
    throw new BadRequestError("`email` is not a valid email address");
  }
  if (!email && schedule.requireEmail) {
    throw new BadRequestError("`email` is required for this schedule");
  }

  if (!body?.startAt) {
    throw new BadRequestError("`startAt` is required");
  }
  const startAt = DateTime.fromISO(body.startAt, { zone: schedule.timeZone });
  if (!startAt.isValid) {
    throw new BadRequestError(`\`startAt\` is not a valid date: ${body.startAt}`);
  }

  return { startAt, name, phone, email, remindMe: body.remindMe !== false };
}
