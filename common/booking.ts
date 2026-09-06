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
