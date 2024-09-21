import { hy } from "hydratable";
import { BaseDoc, BaseModel } from "./baseDoc";

export interface SlotModal extends BaseModel {
  eventId: string;
  startAt: Date;
  persons: {
    id: string;
    signedUpAt: Date;
    reminderSentAt?: Date;
  }[];
  durationMins?: number;
  allDay?: boolean;
  capacity?: {
    min?: number;
    max?: number;
  }
  tags?: string[];
}

export class Slot extends BaseDoc<SlotModal> implements SlotModal {
  @hy('string') eventId: string;
  @hy('date') startAt: Date;
  @hy('array', {arrayElementType: 'object'}) persons: { id: string; signedUpAt: Date; reminderSentAt?: Date }[];
  @hy('number') durationMins?: number;
  @hy('bool') allDay?: boolean;
  @hy('object') capacity?: {
    min?: number;
    max?: number;
  };
  @hy('array', {arrayElementType: 'string'}) tags?: string[];

  constructor(data: SlotModal) {
    super(data);
    for (const p of this.persons) {
      if (p.signedUpAt) {
        p.signedUpAt = new Date(p.signedUpAt);
      }
      if (p.reminderSentAt) {
        p.reminderSentAt = new Date(p.reminderSentAt);
      }
    }
  }

}
