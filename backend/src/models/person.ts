import { hy } from "hydratable";
import { BaseDoc, BaseModel } from "./baseDoc";

export interface PersonModel extends BaseModel {
  name: string;
  phone: string;
  optOutSMS?: boolean;
  otp?: {
    value: string;
    expiresAt: Date;
    eventId: string;
  };
  googleTokens?: {
    accessToken: string;
    refreshToken: string;
    expiryDate: Date;
  };
}

export type PersonWithValidOTP = Omit<PersonModel, "otp"> &
  Required<Pick<PersonModel, "otp">>;

export class Person extends BaseDoc<PersonModel> implements PersonModel {
  @hy("string") name: string;
  @hy("string") phone: string;
  @hy("bool") optOutSMS?: boolean;
  @hy("object") otp?: { value: string; expiresAt: Date; eventId: string };
  @hy("object") googleTokens?: {
    accessToken: string;
    refreshToken: string;
    expiryDate: Date;
  };

  constructor(data: PersonModel) {
    super(data);
    if (this.otp?.expiresAt) {
      this.otp.expiresAt = new Date(this.otp.expiresAt);
    }
  }

  isValidOtp(value: string) {
    return this.otp?.value === value && this.otp.expiresAt >= new Date();
  }
}
