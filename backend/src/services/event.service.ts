import { ObjectId } from "mongodb";
import { Event, EventModal } from "../models/event";
import { BaseService } from "./base.service";

export class EventService extends BaseService<EventModal> {

  protected collectionName = 'events';

  find() {
    return this.collection.find({}).toArray().then(docs => docs.map(d => new Event(d)));
  }

  create() {
    const doc: EventModal = new Event({
      _id: new ObjectId().toHexString(),
      timestamp: new Date(),
    });
    this.addCreatedBy(doc);
    return this.collection.insertOne(doc).then(() => doc);
  }

}
