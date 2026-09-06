import { BaseService } from "./base.service";
import { Schedule, ScheduleModel } from "../models/schedule";
import { OmitBaseFields } from "../models/baseDoc";

export type CreateSchedule = OmitBaseFields<ScheduleModel>;

export class ScheduleService extends BaseService<ScheduleModel> {
  protected collectionName = "schedules";

  find() {
    return this.collection
      .find(this.filterOutDeleted({}))
      .toArray()
      .then((docs) => docs.map((d) => new Schedule(d)));
  }

  findById(id: string) {
    return this.collection
      .findOne(this.filterOutDeleted({ _id: id }))
      .then((doc) => (doc ? new Schedule(doc) : null));
  }

  /** Upsert by slug, so the seed script is safe to re-run. */
  async upsert(schedule: CreateSchedule) {
    const doc = new Schedule(schedule as ScheduleModel);
    const existing = await this.findById(doc._id);
    if (existing) {
      const { _id, ...fields } = doc as ScheduleModel;
      await this.collection.updateOne(
        { _id },
        { $set: this.addUpdatedBy(fields as Partial<ScheduleModel>) },
      );
    } else {
      this.addCreatedBy(doc);
      await this.collection.insertOne(doc);
    }
    return this.findById(doc._id);
  }
}
