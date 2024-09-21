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

}
