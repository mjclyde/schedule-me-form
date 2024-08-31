import { APIConstructor, GenerateAPIs, InjectableConstructor, Injector } from '@ncss/api-decorator';
import express, { Application, Response } from 'express';
import { Server } from 'http';
import { Environment } from './environment';
import { BadRequestError, DocumentNotFoundError, DuplicateIdError } from './errors';
import { EventService } from './services/event.service';
import { EventAPI } from './api/events.api';

const SERVICES: InjectableConstructor[] = [
  EventService,
];

const APIS: APIConstructor[] = [
  EventAPI,
];

export class App {
  private app: Application;
  private injector: Injector;
  private server?: Server;
  private port: number;

  constructor(port = Environment.PORT) {
    this.port = port;
    this.app = express();
    this.injector = new Injector();
  }

  async init() {
    this.app.use(express.json({ limit: '2mb' }));
    this.app.get('/', (req, res) => res.sendStatus(200));

    await this.setupInjector(SERVICES);
    GenerateAPIs(this.app, APIS, this.injector, this.handleError.bind(this))
  }

  start(): Promise<void> {
    return new Promise<void>(resolve => {
      this.server = this.app.listen(this.port, () => {
        if (this.server) {
          this.server.keepAliveTimeout = 65000;
          this.server.headersTimeout = 80000;
        }
        console.log('Server listening on port: ' + this.port);
        resolve();
      });
    });
  }

  stop(): Promise<{ err?: Error }> {
    return new Promise((resolve, reject) => {
      if (this.server) {
        this.server.close(err => {
          resolve({ err });
        });
      } else {
        resolve({});
      }
    });
  }

  getExpressApp() {
    return this.app;
  }

  getInjector() {
    return this.injector;
  }

  private async setupInjector(serviceClasses: InjectableConstructor[]) {
    for (const service of serviceClasses) {
      await this.injector.register(service);
    }
  }

  private handleError(err: any, res: Response) {
    if (err instanceof DuplicateIdError || err instanceof BadRequestError) {
      res.status(400).send(err.message);
    } else if (err instanceof DocumentNotFoundError) {
      res.status(404).send(err.message);
    } else {
      res.status(500).send(err);
    }
  }

}
