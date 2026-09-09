import { DateTime } from "luxon";

/**
 * SMS copy for bookings.
 *
 * Every message formats times in the *schedule's* zone rather than a hardcoded
 * one, so a schedule in another region reads correctly. (The older slot-based
 * messages in slots.api.ts still hardcode America/Denver; they go away with the
 * slot code itself.)
 */

export interface BookingMessageInfo {
  personName: string;
  scheduleType: string;
  startAt: DateTime;
  timeZone: string;
}

export function formatAppointment(startAt: DateTime, timeZone: string) {
  const local = startAt.setZone(timeZone);
  return {
    date: local.toFormat("L/d/yyyy"),
    time: local.toFormat("h:mm a"),
  };
}

export function bookingConfirmation(
  info: BookingMessageInfo & { manageUrl?: string },
) {
  const { date, time } = formatAppointment(info.startAt, info.timeZone);
  return (
    `Hello ${info.personName}! You are scheduled for ${info.scheduleType} on ` +
    `${date} at ${time}. We look forward to seeing you there.` +
    // Omitted rather than broken when no OTP could be minted: a link is
    // better than none, but none is better than one that goes nowhere.
    (info.manageUrl
      ? ` To view or cancel your appointment, click here: ${info.manageUrl}`
      : "")
  );
}

export function ownerBookingNotice(
  info: BookingMessageInfo & { personName: string },
) {
  const { date, time } = formatAppointment(info.startAt, info.timeZone);
  return (
    `${info.personName} has signed up for ${info.scheduleType} on ${date} at ${time}.`
  );
}

export function bookingCancellation(info: BookingMessageInfo) {
  const { date, time } = formatAppointment(info.startAt, info.timeZone);
  return (
    `Hello ${info.personName}. Your ${info.scheduleType} appointment on ` +
    `${date} at ${time} has been cancelled.`
  );
}

export function ownerCancellationNotice(info: BookingMessageInfo) {
  const { date, time } = formatAppointment(info.startAt, info.timeZone);
  return (
    `${info.personName} has cancelled ${info.scheduleType} on ${date} at ${time}.`
  );
}

export function appointmentReminder(
  info: BookingMessageInfo & { now: DateTime },
) {
  const { date, time } = formatAppointment(info.startAt, info.timeZone);
  // "tomorrow" is judged in the schedule's zone, so a late-evening
  // appointment does not read as the wrong day to whoever is reading it.
  const when = isNextDay(info.startAt, info.now, info.timeZone)
    ? `tomorrow (${date})`
    : `on ${date}`;
  return (
    `Hello ${info.personName}. This is a reminder about your ` +
    `${info.scheduleType} appointment ${when} at ${time}. ` +
    `We look forward to seeing you there!`
  );
}

function isNextDay(startAt: DateTime, now: DateTime, timeZone: string) {
  const day = startAt.setZone(timeZone).startOf("day");
  return day.equals(now.setZone(timeZone).startOf("day").plus({ days: 1 }));
}
