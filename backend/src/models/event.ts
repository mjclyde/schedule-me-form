import { hy } from "hydratable";
import { BaseDoc, BaseModel } from "./baseDoc";

export interface EventModal extends BaseModel {
  timestamp: Date;
}

export class Event extends BaseDoc<EventModal> implements EventModal {

  @hy('date') timestamp: Date;

}
