import { ObjectId } from "mongodb";
import { BaseService } from "./base.service";
import { Person, PersonModal } from "../models/person";
import ShortUniqueId from 'short-unique-id';

export class PersonService extends BaseService<PersonModal> {

  protected collectionName = 'persons';
  private otps = new ShortUniqueId({length: 6});

  findById(id: string) {
    return this.collection.findOne({_id: id}).then(doc => doc ? new Person(doc) : null)
  }

  findByPhone(phone: string) {
    return this.collection.findOne(this.filterOutDeleted({ phone })).then(doc => doc ? new Person(doc) : null)
  }

  findByOTP(id: string) {
    return this.collection.findOne(this.filterOutDeleted({ 'otp.value': id })).then(doc => doc ? new Person(doc) : null);
  }

  updateName(id: string, name: string) {
    return this.collection.updateOne({ _id: id }, { $set: { name } });
  }

  create(person: { name: string, phone: string }) {
    const doc: Person = new Person({
      _id: new ObjectId().toHexString(),
      ...person,
    });
    this.addCreatedBy(doc);
    return this.collection.insertOne(doc).then(() => doc);
  }

  async createOTP(phone: string, eventId: string) {
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
    return this.collection.findOneAndUpdate(
      { phone },
      { $set: { otp: { value: otp, expiresAt, eventId } } },
      { returnDocument: 'after' },
    )
  }

}
