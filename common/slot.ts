export interface Slot {
  _id: string;
  eventId: string;
  startAt: Date;
  durationMins?: number;
  allDay?: boolean;
  capacity?: {
    min?: number;
    max?: number;
  }
  tags?: string[];
}

export interface SignUpRequest {
  slotId: string;
  name: string;
  phone: string;
}
