import { hy } from "hydratable";
import { BaseDoc, BaseModel } from "./baseDoc";

export interface PersonModel extends BaseModel {
  name: string;
  phone: string;
  optOutSMS?: boolean;
  otp?: {
    value: string;
    expiresAt: Date;
    /**
     * What the OTP grants access to. Optional because slot-era documents were
     * scoped to an `eventId` instead; those still deserialize, they just have
     * no schedule, and every endpoint reading this treats that as "not found".
     */
    scheduleId?: string;
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
  @hy("object") otp?: {
    value: string;
    expiresAt: Date;
    scheduleId?: string;
  };
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
