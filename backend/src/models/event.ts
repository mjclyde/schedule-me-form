import { hy } from "hydratable";
import { BaseDoc, BaseModel } from "./baseDoc";

export interface EventModal extends BaseModel {
  type: string;
  name: string;
  description: string;
}

export class Event extends BaseDoc<EventModal> implements EventModal {

  @hy('string') type: string;
  @hy('string') name: string;
  @hy('string') description: string;

}
