import { hy } from "hydratable";
import { BaseDoc, BaseModel } from "./baseDoc";

export interface NotificationModal extends BaseModel {
  personId: string;
  name: string;
  phone: string;
  message: string;
  twilioResponse: any;
}

export class Notification extends BaseDoc<NotificationModal> implements NotificationModal {
  @hy('string') personId: string;
  @hy('string') name: string;
  @hy('string') phone: string;
  @hy('string') message: string;
  @hy('object') twilioResponse: any;
}
