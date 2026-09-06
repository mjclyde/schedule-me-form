/**
 * Helpers for the `extendedProperties.private` payload that marks a calendar
 * event as a booking this app created.
 *
 * These tags are what let the calendar act as the database: `events.list`
 * accepts repeated `privateExtendedProperty=key=value` filters (AND-ed), so
 * "this person's bookings" and "reminders still due" are calendar queries
 * rather than Mongo queries. See docs/calendar-pivot-plan.md §4.
 *
 * Values are strings on the wire (Google's limits: 1024 chars per value,
 * 32KB per event), so dates round-trip as ISO strings.
 */

/** Marks an event as ours. Present on every booking this app writes. */
export const APP_TAG = "schedule-me";

export interface BookingTags {
  scheduleId: string;
  personId: string;
  bookedAt?: Date;
  /** Stamped by the reminder cron once the 24-hour SMS has gone out. */
  reminderSentAt?: Date;
}

type PrivateProps = { [key: string]: string };

/** Builds the `extendedProperties.private` object for a booking event. */
export function toPrivateProps(tags: BookingTags): PrivateProps {
  const props: PrivateProps = {
    app: APP_TAG,
    scheduleId: tags.scheduleId,
    personId: tags.personId,
  };
  if (tags.bookedAt) {
    props.bookedAt = tags.bookedAt.toISOString();
  }
  if (tags.reminderSentAt) {
    props.reminderSentAt = tags.reminderSentAt.toISOString();
  }
  return props;
}

/**
 * Reads our tags back off an event.
 *
 * @returns the tags, or null if the event is not one of ours — a calendar holds
 *   plenty of events we did not create, and they must never be treated as
 *   bookings.
 */
export function readBookingTags(event: {
  extendedProperties?: { private?: PrivateProps | null } | null;
}): BookingTags | null {
  const props = event.extendedProperties?.private;
  if (!props || props.app !== APP_TAG || !props.scheduleId || !props.personId) {
    return null;
  }
  return {
    scheduleId: props.scheduleId,
    personId: props.personId,
    bookedAt: parseDate(props.bookedAt),
    reminderSentAt: parseDate(props.reminderSentAt),
  };
}

/**
 * Builds `privateExtendedProperty` filters for `events.list`.
 *
 * Always includes the app tag, so a query can never accidentally match events
 * the app did not create.
 */
export function toQueryFilters(
  filters: Partial<Pick<BookingTags, "scheduleId" | "personId">> = {},
): string[] {
  const query = [`app=${APP_TAG}`];
  if (filters.scheduleId) {
    query.push(`scheduleId=${filters.scheduleId}`);
  }
  if (filters.personId) {
    query.push(`personId=${filters.personId}`);
  }
  return query;
}

function parseDate(value?: string) {
  if (!value) {
    return undefined;
  }
  const date = new Date(value);
  return isNaN(date.getTime()) ? undefined : date;
}
