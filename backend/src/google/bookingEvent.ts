import { calendar_v3 } from "googleapis";
import { DateTime } from "luxon";
import { toPrivateProps } from "./bookingTags";
import { TimeRange } from "./availability";

export interface BookingEventParams {
  scheduleId: string;
  scheduleType: string;
  /** Template for the event title; `{type}` and `{name}` are substituted. */
  appointmentTitle?: string;
  timeZone: string;
  slot: TimeRange;
  person: { id: string; name: string; phone: string };
  email?: string;
  bookedAt?: Date;
}

export const DEFAULT_APPOINTMENT_TITLE = "{type} — {name}";

/**
 * Builds the calendar event that *is* the booking.
 *
 * Two things here are load-bearing rather than cosmetic:
 *   - `transparency: "opaque"` is what makes the slot busy, and so what stops
 *     it being offered again. There is no separate "taken" flag anywhere.
 *   - the `extendedProperties.private` tags are the only way the app can find
 *     this booking again (see bookingTags.ts).
 */
export function buildBookingEvent(
  params: BookingEventParams,
): calendar_v3.Schema$Event {
  const title = (params.appointmentTitle || DEFAULT_APPOINTMENT_TITLE)
    .replace(/\{type\}/g, params.scheduleType)
    .replace(/\{name\}/g, params.person.name);

  const event: calendar_v3.Schema$Event = {
    summary: title,
    description: buildDescription(params),
    start: {
      dateTime: params.slot.start.toISO() as string,
      timeZone: params.timeZone,
    },
    end: {
      dateTime: params.slot.end.toISO() as string,
      timeZone: params.timeZone,
    },
    transparency: "opaque",
    extendedProperties: {
      private: toPrivateProps({
        scheduleId: params.scheduleId,
        personId: params.person.id,
        bookedAt: params.bookedAt ?? new Date(),
      }),
    },
  };

  if (params.email) {
    event.attendees = [{ email: params.email, displayName: params.person.name }];
  }
  return event;
}

function buildDescription(params: BookingEventParams) {
  return [params.person.name, params.person.phone, params.email]
    .filter(Boolean)
    .join("\n");
}

export interface ConflictCandidate {
  id?: string | null;
  created?: string | null;
}

/**
 * Resolves a double-booking race after the fact.
 *
 * Google has no conditional insert, so two people can both be told a slot is
 * free and both insert. Rather than a lock, every racer applies the same rule —
 * earliest `created` wins — and the losers delete their own event. Ties break
 * on id so the outcome is identical whichever racer is asking.
 *
 * @param candidates - the app's own events overlapping the slot
 * @param ourId - the event we just inserted
 */
export function isBookingWinner(
  candidates: ConflictCandidate[],
  ourId: string,
): boolean {
  const ranked = candidates
    .filter((c) => c.id)
    .sort((a, b) => {
      const byCreated = createdMillis(a) - createdMillis(b);
      return byCreated !== 0 ? byCreated : (a.id as string).localeCompare(b.id as string);
    });

  // Nothing came back (an eventually-consistent read, say): keep ours rather
  // than deleting a booking we just confirmed.
  return ranked.length === 0 || ranked[0].id === ourId;
}

/** Events whose own times overlap `slot`, half-open. */
export function overlappingBookings<
  T extends { start?: { dateTime?: string | null } | null; end?: { dateTime?: string | null } | null },
>(events: T[], slot: TimeRange): T[] {
  return events.filter((event) => {
    const start = event.start?.dateTime
      ? DateTime.fromISO(event.start.dateTime)
      : null;
    const end = event.end?.dateTime ? DateTime.fromISO(event.end.dateTime) : null;
    if (!start?.isValid || !end?.isValid) {
      return false;
    }
    return start < slot.end && slot.start < end;
  });
}

/** Missing `created` sorts last, so a well-formed event always outranks it. */
function createdMillis(candidate: ConflictCandidate) {
  if (!candidate.created) {
    return Number.MAX_SAFE_INTEGER;
  }
  const millis = DateTime.fromISO(candidate.created).toMillis();
  return isNaN(millis) ? Number.MAX_SAFE_INTEGER : millis;
}
