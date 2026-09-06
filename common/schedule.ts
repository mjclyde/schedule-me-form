/**
 * `disabled` is a manual kill switch; the other three are derived from the
 * schedule's date window. They are distinct from "open, but nothing free this
 * month", which is an empty `slots` array on an `open` schedule.
 */
export type ScheduleState = "disabled" | "before" | "open" | "closed";

/**
 * The subset of a schedule that is safe to serve publicly.
 *
 * Deliberately omits `calendarId`, `ownerPersonId` and `notify`, which carry
 * the owner's calendar address and phone numbers.
 */
export interface PublicSchedule {
  _id: string;
  name: string;
  type: string;
  description: string;
  timeZone: string;
  durationMins: number;
  state: ScheduleState;
  /** Whether the booking form must collect an email address. */
  requireEmail?: boolean;
  /** Inclusive calendar dates ("YYYY-MM-DD") in `timeZone`, when configured. */
  startDate?: string;
  endDate?: string;
  /** The resolved window, ISO instants. `bookableTo` is absent when unbounded. */
  bookableFrom?: string;
  bookableTo?: string;
}

/** Ephemeral — derived per request, never stored, so it carries no id. */
export interface AvailableSlot {
  startAt: string;
  endAt: string;
}

export interface AvailabilityResponse {
  /** The schedule's zone, so the caller can label times alongside the browser's. */
  timeZone: string;
  state: ScheduleState;
  slots: AvailableSlot[];
}
