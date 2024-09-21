
import { ObjectId } from "mongodb";
import { BaseService } from "./base.service";
import { Slot, SlotModal } from "../models/slot";

export interface CreateSlot {
  eventId: string;
  startAt: Date;
  durationMins?: number;
  allDay?: boolean;
  capacity?: {
    min?: number;
    max?: number;
  }
  tags?: string[];
}

export class SlotService extends BaseService<SlotModal> {

  protected collectionName = 'slots';

  find(eventId: string) {
    return this.collection.find(this.filterOutDeleted({ eventId }))
      .toArray().then(docs => docs.map(d => new Slot(d)));
  }

  findById(slotId: string) {
    return this.collection.findOne(this.filterOutDeleted({ _id: slotId })).then(slot => slot ? new Slot(slot) : null);
  }

  findAvailable(eventId: string) {
    return this.collection.aggregate([
      {
        $match: {
          eventId,
          deletedAt: { $exists: false },
          startAt: {$gte: new Date() },
        },
      },
      {
        $addFields: {
          available: {
            $cond: { if: { $lt: [{ $size: '$persons' }, '$capacity.max'] }, then: true, else: false }
          }
        },
      },
      { $match: { available: true } },
      {
        $sort: { startAt: 1 },
      },
    ]).toArray().then(docs => docs.map(d => new Slot(d as SlotModal)));
  }

  findRemindersDue(eventId: string, minutesBeforeSlot: number) {
    const lessThanDate = new Date();
    lessThanDate.setMinutes(lessThanDate.getMinutes() + minutesBeforeSlot);
    console.log(lessThanDate);
    return this.collection.aggregate([
      {
        $match: this.filterOutDeleted({
          eventId,
          startAt: { $gte: new Date(), $lte: lessThanDate },
        }),
      },
      { $unwind: '$persons' },
      {
        $match: {
          'persons.id': { $exists: true },
          'persons.reminderSentAt': { $exists: false },
        },
      },
      {
        $lookup: {
          from: 'persons',
          localField: 'persons.id',
          foreignField: '_id',
          as: 'person',
        },
      },
      { $addFields: { person: { $first: '$person' } } },
      {
        $lookup: {
          from: 'events',
          localField: 'eventId',
          foreignField: '_id',
          as: 'event',
        },
      },
      { $addFields: { event: { $first: '$event' } } },
      {
        $project: {
          startAt: 1,
          durationMins: 1,
          signedUpAt: '$persons.signedUpAt',
          person: {
            id: '$person._id',
            name: '$person.name',
            phone: '$person.phone',
          },
          event: {
            name: '$event.name',
            type: '$event.type',
          },
        },
      }
    ]).toArray() as Promise<{
      _id: string;
      startAt: Date;
      durationMins: number;
      signedUpAt: Date;
      person: {
        id: string;
        name: string;
        phone: string;
      };
      event: {
        name: string;
        type: string;
      },
    }[]>
  }

  reminderHasBeenSent(slotId: string, personId: string) {
    return this.collection.updateOne(this.filterOutDeleted({ _id: slotId, 'persons.id': personId }), {
      $set: { 'persons.$.reminderSentAt': new Date() },
    });
  }

  async signUp(info: { slotId: string, personId: string }) {
    const slot = await this.findById(info.slotId);
    if (!slot || (slot.capacity?.max && slot.persons.length >= slot.capacity.max)) {
      return { success: false };
    }
    const res = await this.collection.updateOne(
      { _id: info.slotId, persons: slot.persons },
      { $push: { persons: { id: info.personId, signedUpAt: new Date() } } },
    );
    return { success: res.modifiedCount === 1 };
  }

  create(slot: CreateSlot) {
    const doc = new Slot({
      _id: new ObjectId().toHexString(),
      persons: [],
      ...slot,
    });
    this.addCreatedBy(doc);
    return this.collection.insertOne(doc).then(() => doc);
  }

}
