import { hy } from "hydratable";
import { BaseDoc, BaseModel } from "./baseDoc";

interface EventOwner {
  id: string;
  phone: string;
  name: string;
  syncGoogleCalendar?: {
    id: string;
    name: string;
    timeZone: string;
  };
}

export interface EventModal extends BaseModel {
  type: string;
  name: string;
  description: string;
  owners?: EventOwner[];
}

export interface SyncCalendar {
  id: string;
  name: string;
  personId: string;
  timeZone: string;
}

export class Event extends BaseDoc<EventModal> implements EventModal {
  @hy("string") type: string;
  @hy("string") name: string;
  @hy("string") description: string;
  @hy("array", { arrayElementType: "object" }) owners?: EventOwner[];

  getSyncCalendars() {
    const calendars: SyncCalendar[] = [];
    for (const o of this.owners || []) {
      if (o.syncGoogleCalendar) {
        calendars.push({
          ...o.syncGoogleCalendar,
          personId: o.id,
        });
      }
    }
    return calendars;
  }
}
