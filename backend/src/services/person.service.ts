import { ObjectId } from "mongodb";
import { BaseService } from "./base.service";
import { Person, PersonModal } from "../models/person";

export class PersonService extends BaseService<PersonModal> {

  protected collectionName = 'persons';

  findByPhone(phone: string) {
    return this.collection.findOne(this.filterOutDeleted({ phone })).then(doc => doc ? new Person(doc) : null)
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

}
