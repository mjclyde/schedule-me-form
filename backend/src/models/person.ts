import { hy } from "hydratable";
import { BaseDoc, BaseModel } from "./baseDoc";

export interface PersonModal extends BaseModel {
  name: string;
  phone: string;
  otp?: {
    value: string;
    expiresAt: Date;
    eventId: string;
  }
}

export class Person extends BaseDoc<PersonModal> implements PersonModal {
  @hy('string') name: string;
  @hy('string') phone: string;
  @hy('object') otp?: { value: string, expiresAt: Date, eventId: string};

  constructor(data: PersonModal) {
    super(data);
    if (this.otp?.expiresAt) {
      this.otp.expiresAt = new Date(this.otp.expiresAt);
    }
  }

  isValidOtp(value: string) {
    return this.otp?.value === value && this.otp.expiresAt >= new Date();
  }

}
