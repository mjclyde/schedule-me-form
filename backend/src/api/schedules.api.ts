import { API, Injector } from "@ncss/api-decorator";
import { Request, Response } from "express";
import { DateTime } from "luxon";
import { ScheduleService } from "../services/schedule.service";
import { PersonService } from "../services/person.service";
import { AvailabilityService } from "../services/availability.service";
import { TimeRange } from "../google/availability";
import { Schedule } from "../models/schedule";
import { AvailabilityResponse, AvailableSlot } from "../../common/schedule";
import { BadRequestError } from "../errors";

/**
 * Hard ceiling on a single availability request, independent of the schedule's
 * own window. The endpoint is public and proxies to Google.
 */
const MAX_RANGE_DAYS = 62;

export class SchedulesAPI {
  private schedules: ScheduleService;
  private availability: AvailabilityService;

  constructor(injector: Injector) {
    this.schedules = injector.find(ScheduleService);
    this.availability = AvailabilityService.GetInstance(
      injector.find(PersonService),
    );
  }

  @API("get", "/Schedules/:id")
  async findById(req: Request, res: Response) {
    const schedule = await this.schedules.findById(req.params.id);
    if (!schedule || schedule.active === false) {
      return res.sendStatus(404);
    }
    res.send(schedule.toPublic(DateTime.now().setZone(schedule.timeZone)));
  }

  @API("get", "/Schedules/:id/Availability")
  async findAvailability(req: Request, res: Response) {
    const schedule = await this.schedules.findById(req.params.id);
    if (!schedule || schedule.active === false) {
      return res.sendStatus(404);
    }

    const now = DateTime.now().setZone(schedule.timeZone);
    const state = schedule.getOpenState(now);
    const empty: AvailabilityResponse = {
      timeZone: schedule.timeZone,
      state,
      slots: [],
    };

    const bookable = schedule.getBookableRange(now);
    if (!bookable) {
      return res.send(empty);
    }

    const requested = this.parseRequestedRange(req, schedule, bookable.end);
    // Clamp to the schedule's own window, so a month outside it costs no
    // Google call at all rather than returning an empty list the slow way.
    const range: TimeRange = {
      start: max(requested.start, bookable.start),
      end: bookable.end ? min(requested.end, bookable.end) : requested.end,
    };
    if (range.start >= range.end) {
      return res.send(empty);
    }

    const slots = await this.availability.computeSlots(schedule, range, now);

    const body: AvailabilityResponse = {
      timeZone: schedule.timeZone,
      state,
      slots: slots.map(toAvailableSlot),
    };
    res.send(body);
  }

  private parseRequestedRange(
    req: Request,
    schedule: Schedule,
    bookableEnd: DateTime | null,
  ): TimeRange {
    const zone = schedule.timeZone;
    const from = parseParam(req.query.from, zone, "from");
    const to = parseParam(req.query.to, zone, "to");

    // With no bounds at all a caller could ask for years; default to the
    // ceiling rather than whatever the calendar happens to hold.
    const start = from ?? DateTime.now().setZone(zone).startOf("day");
    const end =
      to ??
      min(
        start.plus({ days: MAX_RANGE_DAYS }),
        bookableEnd ?? start.plus({ days: MAX_RANGE_DAYS }),
      );

    if (end <= start) {
      throw new BadRequestError("`to` must be after `from`");
    }
    if (end.diff(start, "days").days > MAX_RANGE_DAYS) {
      throw new BadRequestError(
        `Requested range is longer than ${MAX_RANGE_DAYS} days`,
      );
    }
    return { start, end };
  }
}

/**
 * Accepts a calendar date ("2026-03-01") or a full ISO instant. A bare date is
 * resolved in the schedule's zone, so "March" means March where the
 * appointments happen, not where the visitor is.
 */
function parseParam(value: unknown, zone: string, name: string) {
  if (value === undefined) {
    return null;
  }
  if (typeof value !== "string") {
    throw new BadRequestError(`\`${name}\` must be a single date string`);
  }
  const parsed = DateTime.fromISO(value, { zone });
  if (!parsed.isValid) {
    throw new BadRequestError(`\`${name}\` is not a valid date: ${value}`);
  }
  return parsed;
}

function toAvailableSlot(slot: TimeRange): AvailableSlot {
  return {
    startAt: slot.start.toISO() as string,
    endAt: slot.end.toISO() as string,
  };
}

function max(a: DateTime, b: DateTime) {
  return a > b ? a : b;
}

function min(a: DateTime, b: DateTime) {
  return a < b ? a : b;
}
