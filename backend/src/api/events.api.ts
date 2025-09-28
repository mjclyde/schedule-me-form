import { API, Injector } from "@ncss/api-decorator";
import { EventService } from "../services/event.service";
import { Request, Response } from "express";
import { FormatPhoneNumber } from "../utils/formatPhoneNumber";
import { PersonService } from "../services/person.service";
import { NotificationService } from "../services/notification.service";
import { AuthorizedRequest, UseOTPAuth } from "../middleware/otpAuthorization";
import { CreateOTPLink } from '../utils/otpLink';

export class EventAPI {

  private events: EventService;
  private persons: PersonService;
  private notifications: NotificationService;

  constructor(injector: Injector) {
    this.events = injector.find(EventService);
    this.persons = injector.find(PersonService);
    this.notifications = injector.find(NotificationService);
  }

  @API('get', '/Event', UseOTPAuth())
  async findByOtp(req: AuthorizedRequest, res: Response) {
    res.send(await this.events.findById(req.person.otp.eventId));
  }

  @API('get', '/Events')
  async find(req: Request, res: Response) {
    res.send(await this.events.find());
  }

  @API('get', '/Events/:id')
  async findById(req: Request, res: Response) {
    res.send(await this.events.findById(req.params.id as string));
  }

  @API('post', '/Events')
  async create(req: Request, res: Response) {
    const doc = await this.events.create({
      name: req.body.name,
      type: req.body.type,
      description: req.body.description,
    });
    res.send(doc);
  }

  @API('post', '/Events/:id/CreateOTP')
  async createOTP(req: Request, res: Response) {
    if (!req.body.phone) {
      return res.sendStatus(400);
    }
    const phone = FormatPhoneNumber(req.body.phone);
    const doc = await this.persons.createOTP(phone, req.params.id);
    if (!doc?._id || !doc.otp?.value) {
      return res.sendStatus(500);
    }
    this.notifications.send({
      personId: doc._id,
      name: doc.name,
      phone,
      message: `Hi ${doc.name}, use this link to view your scheduled events: ${CreateOTPLink(doc.otp.value)}`,
    })
    res.sendStatus(204);
  }

}
