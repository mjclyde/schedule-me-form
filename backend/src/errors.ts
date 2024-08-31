import { MongoError } from 'mongodb';


export enum ErrorCodes {
  DuplicateId = 11000,
}

export class DocumentNotFoundError extends Error {
  constructor(id: string, type?: string) {
    super((type ? type + ' ' : '') + `Document not found: ${id}`);
  }
}

export class DuplicateIdError extends Error {
  constructor(id?: string | number, collection?: string) {
    super(`Duplicate id: ${id} in collection: ${collection}`);
  }
}

export class BadRequestError extends Error {
  constructor(msg: string) {
    super(msg);
  }
}

export function MapError(e: unknown, info: {docId?: string | number, collectionName?: string}) {
  if (e instanceof MongoError && e.code === ErrorCodes.DuplicateId) {
    return new DuplicateIdError(info.docId, info.collectionName);
  }
  return e;
}
