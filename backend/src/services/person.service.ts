import { ObjectId } from "mongodb";
import { BaseService } from "./base.service";
import { Person, PersonModel } from "../models/person";
import ShortUniqueId from "short-unique-id";

export interface GoogleTokens {
  accessToken: string;
  refreshToken: string;
  expiryDate: Date;
}

/**
 * What the OTP grants access to.
 *
 * Optional: the owner bootstrap mints an unscoped OTP, because linking a
 * Google calendar happens before there is a schedule to point at.
 */
export interface OTPScope {
  scheduleId?: string;
}

export interface UpdateFields {
  name?: string;
  optOutSMS?: boolean;
  googleTokens?: GoogleTokens;
}

export class PersonService extends BaseService<PersonModel> {
  protected collectionName = "persons";
  private otps = new ShortUniqueId({ length: 6 });

  findById(id: string) {
    return this.collection
      .findOne({ _id: id })
      .then((doc) => (doc ? new Person(doc) : null));
  }

  findByPhone(phone: string) {
    return this.collection
      .findOne(this.filterOutDeleted({ phone }))
      .then((doc) => (doc ? new Person(doc) : null));
  }

  findByOTP(id: string) {
    return this.collection
      .findOne(this.filterOutDeleted({ "otp.value": id }))
      .then((doc) => (doc ? new Person(doc) : null));
  }

  async update(id: string, fields: UpdateFields) {
    const $set: {
      name?: string;
      optOutSMS?: boolean;
      googleTokens?: GoogleTokens;
    } = {};
    if (fields.name !== undefined) {
      $set.name = fields.name;
    }
    if (fields.optOutSMS !== undefined) {
      $set.optOutSMS = fields.optOutSMS;
    }
    if (fields.googleTokens !== undefined) {
      $set.googleTokens = fields.googleTokens;
    }
    if (Object.keys($set).length) {
      await this.collection.updateOne({ _id: id }, { $set });
    }
  }

  create(person: { name: string; phone: string; optOutSMS?: boolean }) {
    const doc: Person = new Person({
      _id: new ObjectId().toHexString(),
      ...person,
    });
    this.addCreatedBy(doc);
    return this.collection.insertOne(doc).then(() => doc);
  }

  /**
   * Mints an OTP for an existing person.
   *
   * @returns the updated person, or null when no person holds that phone —
   *   persons are only ever created by booking, so an unknown number is a
   *   normal outcome here, not an error.
   */
  async createOTP(phone: string, scope: OTPScope) {
    let otp: string | undefined = undefined;
    do {
      otp = this.otps.rnd();
      const doc = await this.findByOTP(otp);
      if (doc) {
        otp = undefined;
      }
    } while (!otp);
    const expiresAt = new Date();
    expiresAt.setMonth(expiresAt.getMonth() + 1);
    const doc = await this.collection.findOneAndUpdate(
      { phone },
      { $set: { otp: { value: otp, expiresAt, ...scope } } },
      { returnDocument: "after" },
    );
    return doc ? new Person(doc) : null;
  }
}
