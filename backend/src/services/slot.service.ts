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
  };
  tags?: string[];
}

export class SlotService extends BaseService<SlotModal> {
  protected collectionName = "slots";

  find(eventId: string) {
    return this.collection
      .find(this.filterOutDeleted({ eventId }))
      .toArray()
      .then((docs) => docs.map((d) => new Slot(d)));
  }

  findById(slotId: string) {
    return this.collection
      .findOne(this.filterOutDeleted({ _id: slotId }))
      .then((slot) => (slot ? new Slot(slot) : null));
  }

  findSlotsByPerson(personId: string, eventId: string) {
    return this.collection
      .find(this.filterOutDeleted({ "persons.id": personId, eventId }), {
        sort: { startAt: 1 },
      })
      .toArray()
      .then((docs) =>
        docs.map((d) => {
          d.persons = d.persons.filter((p) => p.id === personId);
          return d;
        })
      );
  }

  findAvailable(eventId: string) {
    return this.collection
      .aggregate([
        {
          $match: {
            eventId,
            deletedAt: { $exists: false },
            startAt: { $gte: new Date() },
          },
        },
        {
          $addFields: {
            available: {
              $cond: {
                if: { $lt: [{ $size: "$persons" }, "$capacity.max"] },
                then: true,
                else: false,
              },
            },
          },
        },
        { $match: { available: true } },
        {
          $sort: { startAt: 1 },
        },
      ])
      .toArray()
      .then((docs) => docs.map((d) => new Slot(d as SlotModal)));
  }

  async signUp(info: { slotId: string; personId: string }) {
    const slot = await this.findById(info.slotId);
    if (
      !slot ||
      (slot.capacity?.max && slot.persons.length >= slot.capacity.max)
    ) {
      return { success: false };
    }
    const res = await this.collection.updateOne(
      { _id: info.slotId, persons: slot.persons },
      { $push: { persons: { id: info.personId, signedUpAt: new Date() } } }
    );
    return { success: res.modifiedCount === 1 };
  }

  async removePerson(info: { slotId: string; personId: string }) {
    return this.collection.updateOne(
      this.filterOutDeleted({ _id: info.slotId }),
      { $pull: { persons: { id: info.personId } } }
    );
  }

  create(slot: CreateSlot) {
    const doc = new Slot({
      persons: [],
      ...slot,
      _id: new ObjectId().toHexString(),
    });
    this.addCreatedBy(doc);
    return this.collection.insertOne(doc).then(() => doc);
  }
}
