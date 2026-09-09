import {
  APIConstructor,
  GenerateAPIs,
  InjectableConstructor,
  Injector,
} from "@ncss/api-decorator";
import express, { Application, Response } from "express";
import cors from "cors";
import { Server } from "http";
import { Environment } from "./environment";
import {
  BadRequestError,
  DocumentNotFoundError,
  DuplicateIdError,
} from "./errors";
import { EventService } from "./services/event.service";
import { EventAPI } from "./api/events.api";
import { SlotService } from "./services/slot.service";
import { SlotAPI } from "./api/slots.api";
import { PersonService } from "./services/person.service";
import { NotificationService } from "./services/notification.service";
import { Reminders } from "./reminders";
import { CronJob } from "cron";
import { PersonsAPI } from "./api/persons.api";
import { SetOTPAuthInjector } from "./middleware/otpAuthorization";
import { ScheduleService } from "./services/schedule.service";
import { SchedulesAPI } from "./api/schedules.api";
import { BookingsAPI } from "./api/bookings.api";

const SERVICES: InjectableConstructor[] = [
  EventService,
  SlotService,
  PersonService,
  NotificationService,
  ScheduleService,
];

const APIS: APIConstructor[] = [
  EventAPI,
  SlotAPI,
  PersonsAPI,
  SchedulesAPI,
  BookingsAPI,
];

export class App {
  private app: Application;
  private injector: Injector;
  private server?: Server;
  private port: number;
  private remindersCronJob: CronJob;

  /**
   * Constructs the App instance.
   * @param port - Port number to listen on (defaults to Environment.PORT)
   */
  constructor(port = Environment.PORT) {
    this.port = port;
    this.app = express();
    this.injector = new Injector();
    this.remindersCronJob = CronJob.from({
      cronTime: "0 12-18 * * *",
      // Every active schedule, rather than two hardcoded event ids (bug #5).
      // The sweep skips schedules whose window has closed, so a finished
      // campaign costs nothing.
      onTick: () =>
        new Reminders(this.injector)
          .run()
          .catch((err) => console.error(`Reminder sweep failed: ${err}`)),
      start: false,
      timeZone: "America/Denver",
    });
  }

  async init() {
    SetOTPAuthInjector(this.injector);
    this.app.use(cors());
    this.app.use(express.json({ limit: "2mb" }));
    this.app.get("/", (_, res) => res.sendStatus(200));

    await this.setupInjector(SERVICES);
    GenerateAPIs(this.app, APIS, this.injector, this.handleError.bind(this));
  }

  /**
   * Starts the HTTP server and the reminders cron job (in PROD).
   * @returns Promise that resolves when the server is listening.
   */
  start(): Promise<void> {
    if (Environment.ENV === "PROD") {
      this.remindersCronJob.start();
    } else {
      console.log(`Not going to send reminders (env: ${Environment.ENV})`);
    }
    return new Promise<void>((resolve) => {
      this.server = this.app.listen(this.port, () => {
        if (this.server) {
          this.server.keepAliveTimeout = 65000;
          this.server.headersTimeout = 80000;
        }
        console.log("Server listening on port: " + this.port);
        resolve();
      });
    });
  }

  /**
   * Stops the HTTP server and the reminders cron job (in PROD).
   * @returns Promise that resolves with an error (if any) from server close.
   */
  stop(): Promise<{ err?: Error }> {
    if (Environment.ENV === "PROD") {
      this.remindersCronJob.stop();
    } else {
      console.log(`Not going to send reminders (env: ${Environment.ENV})`);
    }
    return new Promise((resolve, reject) => {
      if (this.server) {
        this.server.close((err) => {
          if (err) {
            reject(err);
          } else {
            resolve({});
          }
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

  /**
   * Registers service classes with the dependency injector.
   * @param serviceClasses - Array of injectable service constructors
   */
  private async setupInjector(serviceClasses: InjectableConstructor[]) {
    for (const service of serviceClasses) {
      await this.injector.register(service);
    }
  }

  /**
   * Handles API errors and sends appropriate HTTP responses.
   * @param err - Error object
   * @param res - Express response object
   */
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
