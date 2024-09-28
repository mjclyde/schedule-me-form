import { APIConstructor, GenerateAPIs, InjectableConstructor, Injector } from '@ncss/api-decorator';
import express, { Application, Response } from 'express';
import cors from 'cors';
import { Server } from 'http';
import { Environment } from './environment';
import { BadRequestError, DocumentNotFoundError, DuplicateIdError } from './errors';
import { EventService } from './services/event.service';
import { EventAPI } from './api/events.api';
import { SlotService } from './services/slot.service';
import { SlotAPI } from './api/slots.api';
import { PersonService } from './services/person.service';
import { NotificationService } from './services/notification.service';
import { ProcessReminders } from './reminders';
import { CronJob } from 'cron';

const SERVICES: InjectableConstructor[] = [
  EventService,
  SlotService,
  PersonService,
  NotificationService,
];

const APIS: APIConstructor[] = [
  EventAPI,
  SlotAPI
];

export class App {
  private app: Application;
  private injector: Injector;
  private server?: Server;
  private port: number;
  private remindersCronJob: CronJob;

  constructor(port = Environment.PORT) {
    this.port = port;
    this.app = express();
    this.injector = new Injector();
    this.remindersCronJob = CronJob.from({
      cronTime: '0 12-18 * * *',
      onTick: () => ProcessReminders(this.injector, '2024tdfa'),
      start: false,
      timeZone: 'America/Denver',
    })
  }

  async init() {
    this.app.use(cors());
    this.app.use(express.json({ limit: '2mb' }));
    this.app.get('/', (req, res) => res.sendStatus(200));

    await this.setupInjector(SERVICES);
    GenerateAPIs(this.app, APIS, this.injector, this.handleError.bind(this))
  }

  start(): Promise<void> {
    if (Environment.ENV === 'PROD') {
      this.remindersCronJob.start();
    } else {
      console.log(`Not going to send reminders (env: ${Environment.ENV})`)
    }
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
    if (Environment.ENV === 'PROD') {
      this.remindersCronJob.stop();
    } else {
      console.log(`Not going to send reminders (env: ${Environment.ENV})`)
    }
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
