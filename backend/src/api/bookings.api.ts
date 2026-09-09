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
import { readBookingTags, toQueryFilters } from "../google/bookingTags";
import { ownsBooking, toMyBooking } from "../google/bookingView";
import { TimeRange } from "../google/availability";
import { Schedule } from "../models/schedule";
import { Person } from "../models/person";
import { AuthorizedRequest, UseOTPAuth } from "../middleware/otpAuthorization";
import { Booking, BookingRequest, MyBooking } from "../../common/booking";
import { FormatPhoneNumber } from "../utils/formatPhoneNumber";
import {
  bookingCancellation,
  bookingConfirmation,
  ownerBookingNotice,
  ownerCancellationNotice,
} from "../utils/bookingMessages";
import { BadRequestError } from "../errors";

/** A loose check: the authority on deliverability is Google's own invite. */
const EMAIL_PATTERN = /^[^@\s]+@[^@\s.]+\.[^@\s]+$/;

/**
 * How far back "My Bookings" looks. Long enough to still show someone the
 * appointment they had last month, short enough to stay one cheap query.
 */
const MY_BOOKINGS_LOOKBACK_DAYS = 90;

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

  /**
   * Every booking the caller holds, across every schedule.
   *
   * Scoped to the person rather than to the OTP's schedule: an OTP minted
   * while booking one schedule would otherwise hide the caller's booking on
   * another. Google applies the `personId` filter server-side, so this never
   * pulls anyone else's appointments back for us to filter out.
   */
  @API("get", "/MyBookings", UseOTPAuth())
  async findMyBookings(req: AuthorizedRequest, res: Response) {
    const schedules = await this.schedules.find();
    const byId = new Map(schedules.map((s) => [s._id, s]));
    const timeMin = DateTime.now()
      .minus({ days: MY_BOOKINGS_LOOKBACK_DAYS })
      .toJSDate();

    const bookings: MyBooking[] = [];
    for (const group of groupByCalendar(schedules)) {
      const events = await this.listPersonEvents(group, req.person._id, timeMin);
      for (const event of events) {
        // The tags name the schedule, not the calendar: two schedules can
        // share one calendar, and only the event knows which it belongs to.
        const scheduleId = readBookingTags(event)?.scheduleId;
        const schedule = scheduleId ? byId.get(scheduleId) : undefined;
        const booking = schedule ? toMyBooking(event, schedule) : null;
        if (booking) {
          bookings.push(booking);
        }
      }
    }

    // Compare instants, not the ISO strings: two bookings can carry different
    // UTC offsets and still need to sort by when they actually happen.
    bookings.sort(
      (a, b) =>
        DateTime.fromISO(a.startAt).toMillis() -
        DateTime.fromISO(b.startAt).toMillis(),
    );
    res.send(bookings);
  }

  @API("delete", "/Bookings/:id", UseOTPAuth())
  async cancel(req: AuthorizedRequest, res: Response) {
    // A Google event id does not name the calendar holding it, so the caller
    // has to say which schedule the booking belongs to.
    const scheduleId = req.query.scheduleId;
    if (typeof scheduleId !== "string" || !scheduleId) {
      return res.status(400).send("`scheduleId` is required");
    }
    const schedule = await this.schedules.findById(scheduleId);
    if (!schedule) {
      return res.sendStatus(404);
    }

    const calendar = await this.calendarManager.getCalendar(
      schedule.ownerPersonId,
    );
    const event = await calendar
      .getEvent(schedule.calendarId, req.params.id)
      .catch(() => null);

    // One 404 for "no such event", "not a booking of ours" and "not yours".
    // Distinguishing them would let an OTP holder probe the owner's calendar.
    if (!event || !ownsBooking(event, req.person._id)) {
      return res.sendStatus(404);
    }
    const booking = toMyBooking(event, schedule);

    await calendar.deleteEvent(schedule.calendarId, req.params.id, {
      sendUpdates: "all",
    });
    // Deleting the opaque event is what frees the slot; dropping the cache is
    // what makes availability say so before the TTL expires.
    this.availability.invalidate(schedule);

    if (booking) {
      await this.notifyCancelled(schedule, req.person, booking);
    }
    res.sendStatus(204);
  }

  /**
   * One calendar's bookings for one person.
   *
   * A calendar whose owner has revoked the app's Google access must not blank
   * out the bookings on every other calendar, so a failure here is logged and
   * skipped rather than thrown.
   */
  private async listPersonEvents(
    group: CalendarGroup,
    personId: string,
    timeMin: Date,
  ) {
    try {
      const calendar = await this.calendarManager.getCalendar(
        group.ownerPersonId,
      );
      return await calendar.listAppEvents({
        calendarId: group.calendarId,
        timeMin,
        filters: { personId },
      });
    } catch (err) {
      console.error(`Could not read calendar ${group.calendarId}: ${err}`);
      return [];
    }
  }

  private async notifyCancelled(
    schedule: Schedule,
    person: Person,
    booking: MyBooking,
  ) {
    const info = {
      personName: person.name,
      scheduleType: schedule.type,
      startAt: DateTime.fromISO(booking.startAt),
      timeZone: schedule.timeZone,
    };

    // The event is already gone; a failed SMS must not turn that into a 500.
    await this.notifications
      .send({
        personId: person._id,
        name: person.name,
        phone: person.phone,
        optOutSMS: person.optOutSMS,
        message: bookingCancellation(info),
      })
      .catch((err) => console.error(`Failed to send cancellation SMS: ${err}`));

    for (const owner of schedule.notify || []) {
      await this.notifications
        .send({
          personId: owner.id,
          name: owner.name,
          phone: owner.phone,
          message: ownerCancellationNotice(info),
        })
        .catch((err) => console.error(`Failed to notify ${owner.id}: ${err}`));
    }
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

interface CalendarGroup {
  ownerPersonId: string;
  calendarId: string;
}

/**
 * Collapses schedules onto the distinct calendars behind them.
 *
 * Several schedules commonly point at one calendar, and each is one Google
 * round trip — querying per schedule would both cost more and return the same
 * booking once per schedule sharing its calendar.
 */
export function groupByCalendar(
  schedules: CalendarGroup[],
): CalendarGroup[] {
  const groups = new Map<string, CalendarGroup>();
  for (const { ownerPersonId, calendarId } of schedules) {
    const key = `${ownerPersonId}|${calendarId}`;
    if (!groups.has(key)) {
      groups.set(key, { ownerPersonId, calendarId });
    }
  }
  return [...groups.values()];
}
