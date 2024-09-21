import { ObjectId } from "mongodb";
import { Event, EventModal } from "../models/event";
import { BaseService } from "./base.service";

export class EventService extends BaseService<EventModal> {

  protected collectionName = 'events';

  find() {
    return this.collection.find(this.filterOutDeleted({})).toArray().then(docs => docs.map(d => new Event(d)));
  }

  findById(id: string) {
    return this.collection.findOne(this.filterOutDeleted({_id: id})).then(doc => doc ? new Event(doc) : null);
  }

  create(event: {type: string, name: string, description: string}) {
    const doc = new Event({
      _id: new ObjectId().toHexString(),
      ...event,
    });
    this.addCreatedBy(doc);
    return this.collection.insertOne(doc).then(() => doc);
  }

}
