import { DateTime } from "luxon";
import { readBookingTags } from "./bookingTags";
import { MyBooking } from "../../common/booking";

/**
 * Turning calendar events back into bookings.
 *
 * The calendar is the database, so everything the app knows about a booking is
 * read back off the event: the times from the event itself, the identity from
 * the `extendedProperties.private` tags, and the naming from the schedule the
 * tags point at.
 *
 * Both functions here refuse anything that is not demonstrably one of our
 * bookings. A calendar holds the owner's whole life, and these feed a list the
 * public can read and a delete the public can call.
 */

/** The parts of a calendar event these functions actually need. */
export interface BookingEventLike {
  id?: string | null;
  status?: string | null;
  start?: { dateTime?: string | null; date?: string | null } | null;
  end?: { dateTime?: string | null; date?: string | null } | null;
  extendedProperties?: { private?: { [key: string]: string } | null } | null;
}

export interface BookingSchedule {
  _id: string;
  name: string;
  type: string;
  timeZone: string;
}

/**
 * Maps one calendar event onto the booking its owner sees.
 *
 * @returns null when the event is not a live booking of ours — not tagged,
 *   cancelled, untimed, or missing the id that cancelling it would need.
 */
export function toMyBooking(
  event: BookingEventLike,
  schedule: BookingSchedule,
): MyBooking | null {
  const tags = readBookingTags(event);
  if (!tags || !event.id || event.status === "cancelled") {
    return null;
  }

  const start = parseDateTime(event.start?.dateTime);
  const end = parseDateTime(event.end?.dateTime);
  if (!start || !end) {
    return null;
  }

  return {
    id: event.id,
    scheduleId: tags.scheduleId,
    scheduleName: schedule.name,
    scheduleType: schedule.type,
    startAt: start.toISO() as string,
    endAt: end.toISO() as string,
    timeZone: schedule.timeZone,
    durationMins: Math.round(end.diff(start, "minutes").minutes),
  };
}

/**
 * Whether `personId` is the person this booking was made for.
 *
 * The only authorization check on cancelling. An untagged event always fails
 * it, so an OTP holder can never delete something the app did not create.
 */
export function ownsBooking(event: BookingEventLike, personId: string) {
  return readBookingTags(event)?.personId === personId;
}

/** Timed events only — an all-day event is never a booking. */
function parseDateTime(value?: string | null) {
  if (!value) {
    return null;
  }
  const parsed = DateTime.fromISO(value);
  return parsed.isValid ? parsed : null;
}
