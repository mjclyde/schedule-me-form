import { Hydratable, hy } from 'hydratable';
import { UserRef } from './userRef';

export type BaseDocConstructor<T extends {} = {}> = new (...args: any[]) => T;

export const BaseModelFactory = <T extends {} = {}>(source: any, constructor: BaseDocConstructor<T>): T => new constructor(source);

export type BaseFieldNames = 'createdAt' | 'createdBy' | 'updatedAt' | 'updatedBy' | 'deletedAt' | 'deletedBy';
export type OmitBaseFields<T extends BaseModel> = Omit<T, BaseFieldNames>;

export interface BaseModel {
  _id: string;
  createdAt?: Date;
  createdBy?: UserRef;
  updatedAt?: Date;
  updatedBy?: UserRef;
  deletedAt?: Date;
  deletedBy?: UserRef;
}

export abstract class BaseDoc<T extends BaseModel = BaseModel> extends Hydratable<T> implements BaseModel {

  @hy('string') _id: string;
  @hy('date') createdAt?: Date;
  @hy('object') createdBy?: UserRef;
  @hy('date') updatedAt?: Date;
  @hy('object') updatedBy?: UserRef;
  @hy('date') deletedAt?: Date;
  @hy('object') deletedBy?: UserRef;

}
