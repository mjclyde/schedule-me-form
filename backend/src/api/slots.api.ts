import { API, Injector } from "@ncss/api-decorator";
import { Request, Response } from "express";
import { CreateSlot, SlotService } from "../services/slot.service";
import { SignUpRequest } from "../../common/slot";
import { PersonService } from "../services/person.service";
import { NotificationService } from "../services/notification.service";
import { EventService } from "../services/event.service";
import { FormatTime } from "../utils/formatTime";
import { FormatPhoneNumber } from "../utils/formatPhoneNumber";
import { AuthorizedRequest, UseOTPAuth } from "../middleware/otpAuthorization";

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

  @API("get", "/Slots")
  async find(req: Request, res: Response) {
    if (typeof req.query.eventId !== "string") {
      return res.send([]);
    }
    res.send(await this.slots.find(req.query.eventId));
  }

  @API("get", "/MySlots", UseOTPAuth())
  async findMySlots(req: AuthorizedRequest, res: Response) {
    res.send(
      await this.slots.findSlotsByPerson(req.person._id, req.person.otp.eventId)
    );
  }

  @API("get", "/AvailableSlots")
  async findAvailable(req: Request, res: Response) {
    if (typeof req.query.eventId !== "string") {
      return res.send([]);
    }
    res.send(await this.slots.findAvailable(req.query.eventId));
  }

  @API("put", "/Slots/:id/SignUp")
  async signUp(req: Request<{}, {}, SignUpRequest>, res: Response) {
    req.body = { ...req.body, slotId: req.params["id"] };
    const phone = FormatPhoneNumber(req.body.phone);
    let person = await this.persons.findByPhone(phone);
    if (!person) {
      person = await this.persons.create({ name: req.body.name, phone });
    } else {
      await this.persons.updateName(person._id, req.body.name);
      person.name = req.body.name;
    }
    if (!person) {
      return res.send(500);
    }
    const signUpResult = await this.slots.signUp({
      slotId: req.body.slotId,
      personId: person._id,
    });
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
        });
      }
    }
    res.send(signUpResult);
  }

  @API("delete", "/Slots/:slotId/Persons/:personId", UseOTPAuth())
  async removePersonFromSlot(req: AuthorizedRequest, res: Response) {
    const person = await this.persons.findById(req.params.personId);
    const slot = await this.slots.findById(req.params.slotId);
    if (!person || !slot) {
      return res.sendStatus(404);
    }
    const event = await this.events.findById(slot.eventId);
    await this.slots.removePerson({
      slotId: req.params.slotId,
      personId: req.params.personId,
    });
    await this.notifications.send({
      personId: person._id,
      name: person.name,
      phone: person.phone,
      message: this.createDeletedSlotNotificationMessage({
        personName: person.name,
        eventTitle: event?.type || 'an event',
        slotStartAt: slot.startAt,
      }),
    });
    res.sendStatus(204);
  }

  @API("post", "/Slots")
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

  private createNotificationMessage(info: {
    personName: string;
    slotStartAt: Date;
    eventTitle: string;
  }) {
    const formattedDate = info.slotStartAt.toLocaleDateString("en-US", {
      timeZone: "America/Denver",
    });
    return (
      `Hello ${info.personName}! You are scheduled for ${info.eventTitle} on ${formattedDate} at ` +
      `${FormatTime(info.slotStartAt)}. We look forward to seeing you there.`
    );
  }

  private createDeletedSlotNotificationMessage(info: {
    personName: string;
    slotStartAt: Date;
    eventTitle: string;
  }) {
    const formattedDate = info.slotStartAt.toLocaleDateString("en-US", {
      timeZone: "America/Denver",
    });
    return (
      `Hello ${info.personName}. Your appointment for ${info.eventTitle} on ${formattedDate} at ` +
      `${FormatTime(info.slotStartAt)} has been deleted.`
    );
  }
}
