import { API, Injector } from "@ncss/api-decorator";
import { EventService } from "../services/event.service";
import { Request, Response } from "express";

export class EventAPI {

  private events: EventService;

  constructor(injector: Injector) {
    this.events = injector.find(EventService);
  }

  @API('get', '/Events')
  async find(req: Request, res: Response) {
    const docs = await this.events.find();
    res.send(docs);
  }

  @API('post', '/Events')
  async create(req: Request, res: Response) {
    const doc = await this.events.create();
    res.send(doc);
  }

}
