import {
  Collection,
  Filter,
  IndexSpecification,
  UpdateFilter,
  UpdateOptions as MongoUpdateOptions,
  UpdateResult
} from 'mongodb';
import { DB } from '../db';
import { Environment } from '../environment';
import { Injectable } from '@ncss/api-decorator';
import { UserRef } from '../models/userRef';
import { BaseModel } from '../models/baseDoc';

export interface IndexDefinition {
  name: string;
  key: IndexSpecification;
}

export interface UpdateOptions extends MongoUpdateOptions {
  user?: UserRef;
}

export abstract class BaseService<T extends BaseModel> implements Injectable {
  protected abstract collectionName: string;
  protected collection!: Collection<T>;
  protected indices: IndexDefinition[] = [];

  async init() {
    this.collection = await DB.collection<T>(this.collectionName);
    for (const { key, name } of this.indices) {
      if (Environment.ENV === 'PROD') {
        if (!(await this.collection.indexExists(name))) {
          console.log(`WARNING: Cannot create new index in PROD environment - ${this.collectionName} collection, ${name}`);
        }
      } else {
        await this.collection.createIndex(key, { name });
      }
    }
  }

  protected async baseUpdateOne(
    filter: Filter<T>,
    update: UpdateFilter<T>,
    options?: UpdateOptions,
  ): Promise<UpdateResult> {
    const res = await this.collection.updateOne(filter, update, options);
    if (res.modifiedCount && options?.user) {
      const postUpdateFilter: Filter<T> = filter['_id'] ? { _id: filter['_id'] } as Filter<T> : filter;
      await this.collection.updateOne(postUpdateFilter, { $set: this.addUpdatedBy({}, options.user) });
    }
    return res;
  }

  protected async baseUpdateMany(
    filter: Filter<T>,
    update: UpdateFilter<T>,
    options?: UpdateOptions,
  ): Promise<UpdateResult> {
    const res = await this.collection.updateMany(filter, update, options);
    if (res.modifiedCount && options?.user) {
      const postUpdateFilter: Filter<T> = filter['_id'] ? { _id: filter['_id'] } as Filter<T> : filter;
      await this.collection.updateMany(postUpdateFilter, { $set: this.addUpdatedBy({}, options.user) });
    }
    return res;
  }

  deleteById(docId: string | number, user?: UserRef) {
    return this.collection.updateOne(
      this.filterOutDeleted({ _id: docId }),
      { $set: this.addDeletedBy({}, user) },
    );
  }

  deleteMany(filter: Filter<T>, user?: UserRef) {
    return this.collection.updateMany(
      this.filterOutDeleted(filter),
      { $set: this.addDeletedBy({}, user) },
    );
  }

  protected filterOutDeleted(filter: any): Filter<T> {
    if (!filter.deletedAt) {
      filter.deletedAt = { $exists: false };
    }
    return filter;
  }

  protected addCreatedBy(doc: Partial<T>, createdBy?: UserRef) {
    if (!doc.createdAt) {
      doc.createdAt = new Date();
    }
    if (createdBy && !doc.createdBy) {
      doc.createdBy = createdBy;
    }
    return doc;
  }

  protected addUpdatedBy(doc: Partial<T>, updatedBy?: UserRef) {
    doc.updatedAt = new Date();
    if (updatedBy) {
      doc.updatedBy = updatedBy;
    }
    return doc;
  }

  protected addDeletedBy(doc: Partial<T>, deletedBy?: UserRef) {
    doc.deletedAt = new Date();
    if (deletedBy) {
      doc.deletedBy = deletedBy;
    }
    return doc;
  }

  protected addToNestedSet(key: string, value: any, $set: any, $unset: any) {
    if (value === null) {
      $unset[key] = '';
    } else if (Array.isArray(value) || value instanceof Date) {
      $set[key] = value;
    } else if (typeof value === 'object') {
      for (const k of Object.keys(value)) {
        this.addToNestedSet(`${key}.${k}`, value[k], $set, $unset);
      }
    } else if (value !== undefined) {
      $set[key] = value;
    }
  }
}
