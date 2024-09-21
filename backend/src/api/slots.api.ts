import { API, Injector } from "@ncss/api-decorator";
import { Request, Response } from "express";
import { CreateSlot, SlotService } from "../services/slot.service";
import { SignUpRequest } from '../../common/slot';
import { PersonService } from "../services/person.service";
import { NotificationService } from "../services/notification.service";
import { EventService } from "../services/event.service";

export class SlotAPI {

  private slots: SlotService;
  private persons: PersonService;
  private notifications: NotificationService;
  private events: EventService;

  constructor(injector: Injector) {
    this.slots = injector.find(SlotService);
    this.persons = injector.find(PersonService);
    this.notifications = injector.find(NotificationService);
    this.events = injector.find(EventService);
  }

  @API('get', '/Slots')
  async find(req: Request, res: Response) {
    if (typeof req.query.eventId !== 'string') {
      return res.send([]);
    }
    res.send(await this.slots.find(req.query.eventId));
  }

  @API('get', '/AvailableSlots')
  async findAvailable(req: Request, res: Response) {
    if (typeof req.query.eventId !== 'string') {
      return res.send([]);
    }
    res.send(await this.slots.findAvailable(req.query.eventId));
  }

  @API('put', '/Slots/:id/SignUp')
  async signUp(req: Request<{}, {}, SignUpRequest>, res: Response) {
    req.body = { ...req.body, slotId: req.params['id'] };
    const phone = this.formatPhoneNumber(req.body.phone);
    let person = await this.persons.findByPhone(phone);
    if (!person) {
      person = await this.persons.create({ name: req.body.name, phone });
    } else {
      await this.persons.updateName(person._id, req.body.name);
    }
    if (!person) {
      return res.send(500);
    }
    const signUpResult = await this.slots.signUp({ slotId: req.body.slotId, personId: person._id });
    const slot = await this.slots.findById(req.body.slotId);
    if (signUpResult.success && slot?.startAt) {
      const event = await this.events.findById(slot.eventId);
      if (event) {
        this.notifications.send({
          personId: person._id,
          name: person.name,
          phone: person.phone,
          message: this.createNotificationMessage({
            personName: person.name,
            slotStartAt: slot.startAt,
            eventTitle: event.type,
          }),
        })
      }
    }
    res.send(signUpResult);
  }

  @API('post', '/Slots')
  async create(req: Request<{}, {}, CreateSlot>, res: Response) {
    const createDoc: CreateSlot = {
      eventId: req.body.eventId,
      startAt: new Date(req.body.startAt),
    };
    if (req.body.durationMins) {
      createDoc.durationMins = req.body.durationMins;
    }
    if (req.body.allDay) {
      createDoc.allDay = req.body.allDay;
    }
    if (req.body.capacity) {
      createDoc.capacity = req.body.capacity;
    }
    if (req.body.tags?.length) {
      createDoc.tags = req.body.tags;
    }
    const doc = await this.slots.create(createDoc);
    res.send(doc);
  }

  private createNotificationMessage(info: { personName: string, slotStartAt: Date, eventTitle: string }) {
    const formattedDate = info.slotStartAt.toLocaleDateString('en-US', { timeZone: 'America/Denver' });
    return `Hello ${info.personName}! You are scheduled for ${info.eventTitle} on ${formattedDate} at ` +
      `${this.formatTime(info.slotStartAt)}. We look forward to seeing you there.`;
  }

  private formatPhoneNumber(phone: string) {
    phone = phone.replace(/\(/, '').replace(/\)/, '').replace(/\s/, '').replace(/-/, '');
    if (phone.length === 10) {
      phone = '+1' + phone;
    }
    return phone;
  }
  private formatTime(date?: Date) {
    if (!date) { return '' }
    return date.toLocaleTimeString('en-US', { timeZone: 'America/Denver' }).replace(/\:\d{2}\s/, ' ');
  }
}
