import { Collection, Db, MongoClient, Document } from 'mongodb';

import { Environment } from './environment';

export class DB {

  private static _client: Client | null = null;
  private static _awaitingConnection: { resolve: (collection: Collection<any>) => void, collectionName: string }[] = [];

  static async collection<T extends Document>(name: string): Promise<Collection<T>> {
    if (this._client?.connected) {
      return this._client.collection<T>(name);
    }

    return new Promise((resolve, reject) => {
      this._awaitingConnection.push({ resolve, collectionName: name });
      if (!this._client) {
        this._client = new Client(
          Environment.DB_URI,
          Environment.DB_NAME,
        );
        this._client.connect().then(() => {
          this._awaitingConnection.forEach((waiter) => {
            if (this._client) {
              waiter.resolve(this._client.collection<T>(waiter.collectionName));
            }
          });
          this._awaitingConnection = [];
        }).catch((err) => reject(err));
      }
    });
  }

  static async close() {
    await this._client?.close();
    this._awaitingConnection = [];
  }

  static async drop() {
    await this._client?.drop();
  }
}

class Client {
  private _client: MongoClient;
  private _db: Db | null = null;

  connected = false;

  constructor(
    private uri: string,
    private dbName: string,
  ) {
    this._client = new MongoClient(this.uri);
  }

  async close() {
    await this._client.close();
    this._db = null;
  }

  async drop() {
    if (this._db && Environment.ENV === 'TEST' && this.dbName.startsWith('test-')) {
      await this._db.dropDatabase();
    }
  }

  async connect() {
    console.log(`Connecting to mongo uri: ${this.uri}`);
    try {
      this._client = await this._client.connect();
      this._db = this._client.db(this.dbName);
    } catch (e) {
      console.log('FAILED TO CONNECT TO ', this.uri);
      console.error(e);
    }
    console.log(`Connected to ${this.uri.replace(/:(.*)@/, '***')}`);
    this.connected = true;
  }

  collection<T extends Document>(name: string): Collection<T> {
    if (!this._db) {
      throw new Error('Cannot get collection before being connected!');
    }
    return this._db.collection<T>(name);
  }


}
