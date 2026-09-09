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
import { Person } from "../models/person";
import { Slot } from "../models/slot";
import { Event, SyncCalendar } from "../models/event";
import { CreateOTPLink } from "../utils/otpLink";
import { writeFile, unlink } from "fs";
import { CreateICS } from "../utils/createICS";
import ShortUniqueId from "short-unique-id";
import { GoogleCalendarManager } from "../google/googleCalendarManager";
import { DateTime } from "luxon";

export class SlotAPI {
  private slots: SlotService;
  private persons: PersonService;
  private notifications: NotificationService;
  private events: EventService;
  private ids = new ShortUniqueId({ length: 12 });
  private calendarManager: GoogleCalendarManager;

  constructor(injector: Injector) {
    this.slots = injector.find(SlotService);
    this.persons = injector.find(PersonService);
    this.notifications = injector.find(NotificationService);
    this.events = injector.find(EventService);
    this.calendarManager = GoogleCalendarManager.GetInstance(this.persons);
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
      await this.slots.findSlotsByPerson(
        req.person._id,
        req.person.otp.eventId || "",
      ),
    );
  }

  @API("get", "/AvailableSlots")
  async findAvailable(req: Request, res: Response) {
    if (typeof req.query.eventId !== "string") {
      return res.send([]);
    }
    let syncCalendars: SyncCalendar[] = [];
    const event = await this.events.findById(req.query.eventId);
    if (event) {
      syncCalendars = event.getSyncCalendars();
    }
    const slots = await this.slots.findAvailable(req.query.eventId);
    res.send(await this.filterSlots(slots, syncCalendars));
  }

  private async filterSlots(slots: Slot[], syncCalendars: SyncCalendar[]) {
    const { start, end } = this.getStartAndEndOfSlots(slots);
    if (!start || !end) {
      return slots;
    }

    const busy: { [date: string]: { start: DateTime; end: DateTime }[] } = {};
    for (const c of syncCalendars) {
      const cal = await this.calendarManager.getCalendar(c.personId);
      const res = await cal.getBusyTime(c.id, {
        timeMin: start,
        timeMax: end,
        defaultTimeZone: c.timeZone,
      });
      for (const day in res) {
        busy[day] ??= [];
        busy[day] = busy[day].concat(res[day]);
      }
    }

    if (!Object.keys(busy).length) {
      return slots;
    }

    return slots.filter((s) => {
      const start = DateTime.fromISO(s.startAt.toISOString());
      let end = DateTime.fromISO(s.startAt.toISOString());
      end = end.plus({ minutes: s.durationMins });
      const datesToCheck = [start.toISODate() as string];
      if (datesToCheck[0] !== end.toISODate()) {
        datesToCheck.push(end.toISODate() as string);
      }
      for (const dateStr of datesToCheck) {
        for (const busyTime of busy[dateStr] || []) {
          if (
            (busyTime.start <= start && busyTime.end > start) ||
            (busyTime.start < end && busyTime.end >= end)
          ) {
            return false;
          }
        }
      }
      return true;
    });
  }

  private getStartAndEndOfSlots(slots: Slot[]) {
    let start: Date | undefined = undefined;
    let end: Date | undefined = undefined;
    for (const s of slots) {
      if (!start || s.startAt < start) {
        start = s.startAt;
      }
      const slotEndAt = new Date(s.startAt);
      slotEndAt.setMinutes(slotEndAt.getMinutes() + (s.durationMins || 0));
      if (!end || slotEndAt > end) {
        end = slotEndAt;
      }
    }
    return { start, end };
  }

  @API("put", "/Slots/:id/SignUp")
  async signUp(req: Request<{}, {}, SignUpRequest>, res: Response) {
    req.body = { ...req.body, slotId: req.params["id"] };
    const phone = FormatPhoneNumber(req.body.phone);
    let person = await this.persons.findByPhone(phone);
    if (!person) {
      person = await this.persons.create({
        name: req.body.name,
        phone,
        optOutSMS: !req.body.remindMe,
      });
    } else {
      await this.persons.update(person._id, {
        name: req.body.name,
        optOutSMS: !req.body.remindMe,
      });
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
        const otp = await this.getOTP(person, event);
        this.notifications.send({
          personId: person._id,
          name: person.name,
          phone: person.phone,
          optOutSMS: !req.body.remindMe,
          message: this.createNotificationMessage({
            personName: person.name,
            slotStartAt: slot.startAt,
            eventTitle: event.type,
            otp,
          }),
        });
        this.notifyEventOwners({
          event,
          slot,
          personSignedUp: person,
          message: this.createOwnerNotificationMessage({
            personSignedUpName: person.name,
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
      optOutSMS: person.optOutSMS,
      message: this.createDeletedSlotNotificationMessage({
        personName: person.name,
        eventTitle: event?.type || "an event",
        slotStartAt: slot.startAt,
      }),
    });
    if (event) {
      this.notifyEventOwners({
        event,
        slot,
        personSignedUp: person,
        message: this.createDeleteSlotOwnerNotificationMessage({
          personSignedUpName: person.name,
          slotStartAt: slot.startAt,
          eventTitle: event.type,
        }),
      });
    }
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

  @API("get", "/Slots/:id/CalendarEvent")
  async createCalendarEvent(req: Request, res: Response) {
    const slot = await this.slots.findById(req.params.id);
    if (!slot) {
      return res.sendStatus(404);
    }
    const event = await this.events.findById(slot?.eventId);
    if (!event) {
      return res.sendStatus(404);
    }
    const end = new Date(slot.startAt);
    end.setMinutes(end.getMinutes() + (slot.durationMins || 0));
    const id = `${this.ids.rnd() + "-" + event.type.replace(/\s/gi, "-")}`;
    const filename = `./${id}.ics`;
    writeFile(
      filename,
      CreateICS({
        id,
        title: event.type,
        start: slot.startAt,
        end,
      }),
      () => {
        res.download(filename, () =>
          unlink(filename, () => console.log("done")),
        );
      },
    );
  }

  private createNotificationMessage(info: {
    personName: string;
    slotStartAt: Date;
    eventTitle: string;
    otp?: { value: string };
  }) {
    const formattedDate = info.slotStartAt.toLocaleDateString("en-US", {
      timeZone: "America/Denver",
    });
    return (
      `Hello ${info.personName}! You are scheduled for ${info.eventTitle} on ${formattedDate} at ` +
      `${FormatTime(info.slotStartAt)}. We look forward to seeing you there.` +
      (info.otp?.value
        ? ` To view or change your appointment, click here: ${CreateOTPLink(
            info.otp.value,
          )}`
        : "")
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

  private notifyEventOwners(info: {
    event: Event;
    slot: Slot;
    personSignedUp: Person;
    message: string;
  }) {
    if (!info.event.owners?.length) {
      return;
    }
    for (const o of info.event.owners) {
      this.notifications.send({
        personId: o.id,
        phone: o.phone,
        name: o.name,
        message: info.message,
      });
    }
  }

  private createOwnerNotificationMessage(info: {
    personSignedUpName: string;
    slotStartAt: Date;
    eventTitle: string;
  }) {
    const formattedDate = info.slotStartAt.toLocaleDateString("en-US", {
      timeZone: "America/Denver",
    });
    return (
      `${info.personSignedUpName} has signed up for ${info.eventTitle} on ${formattedDate} at ` +
      `${FormatTime(info.slotStartAt)}.`
    );
  }

  private createDeleteSlotOwnerNotificationMessage(info: {
    personSignedUpName: string;
    slotStartAt: Date;
    eventTitle: string;
  }) {
    const formattedDate = info.slotStartAt.toLocaleDateString("en-US", {
      timeZone: "America/Denver",
    });
    return (
      `${info.personSignedUpName} has deleted ${info.eventTitle} on ${formattedDate} at ` +
      `${FormatTime(info.slotStartAt)}.`
    );
  }

  private async getOTP(person: Person, event: Event) {
    if (
      person.otp?.value &&
      person.isValidOtp(person.otp.value) &&
      person.otp.eventId === event._id
    ) {
      return person.otp;
    }
    const doc = await this.persons.createOTP(person.phone, { eventId: event._id });
    return doc?.otp;
  }
}
