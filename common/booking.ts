export interface BookingRequest {
  /** ISO instant of the chosen slot, taken verbatim from an AvailableSlot. */
  startAt: string;
  name: string;
  phone: string;
  /** Optional. When given, the person is invited as a calendar attendee. */
  email?: string;
  remindMe?: boolean;
}

export interface Booking {
  /** The Google Calendar event id — the booking has no other identity. */
  id: string;
  scheduleId: string;
  startAt: string;
  endAt: string;
  /** Whether a calendar invite was sent to the attendee. */
  invited: boolean;
}

/**
 * A booking as the person who made it sees it.
 *
 * Assembled from the calendar event plus the schedule it belongs to — the
 * event carries the times and the tags, the schedule carries the naming and
 * the zone. `durationMins` is derived from the event rather than read off the
 * schedule, so a booking made before the duration changed still reads true.
 */
export interface MyBooking {
  id: string;
  scheduleId: string;
  scheduleName: string;
  /** Short label used in copy, e.g. "Tune-Up". */
  scheduleType: string;
  startAt: string;
  endAt: string;
  /** The schedule's zone, so the page can label a time that is not the visitor's. */
  timeZone: string;
  durationMins: number;
}
