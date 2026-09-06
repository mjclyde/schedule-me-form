/**
 * Seeds or updates a schedule from a JSON file.
 *
 * There is no admin UI yet, and schedule creation must not be a public
 * endpoint: a schedule names the owner's calendar and carries their notify
 * phone numbers. A CLI script keeps it on the server side.
 *
 *   npm run schedule -- ./my-schedule.json
 *
 * The file is a ScheduleModel without the base fields, e.g.
 *   {
 *     "_id": "2026spring",
 *     "name": "Spring Tune-Ups 2026",
 *     "type": "Tune-Up",
 *     "description": "15-minute tune-up appointments.",
 *     "ownerPersonId": "<person _id>",
 *     "calendarId": "you@example.com",
 *     "timeZone": "America/Denver",
 *     "durationMins": 15,
 *     "startDate": "2026-03-01",
 *     "endDate": "2026-05-31"
 *   }
 */
import { readFileSync } from "fs";
import { resolve } from "path";
import { DateTime } from "luxon";
import { DB } from "../db";
import { ScheduleService, CreateSchedule } from "../services/schedule.service";
import { Schedule } from "../models/schedule";

const REQUIRED: (keyof CreateSchedule)[] = [
  "_id",
  "name",
  "type",
  "ownerPersonId",
  "calendarId",
  "timeZone",
  "durationMins",
];

async function main() {
  const path = process.argv[2];
  if (!path) {
    throw new Error("Usage: npm run schedule -- <path-to-schedule.json>");
  }

  const config: CreateSchedule = JSON.parse(
    readFileSync(resolve(path), "utf8"),
  );
  const missing = REQUIRED.filter((key) => config[key] === undefined);
  if (missing.length) {
    throw new Error(`Schedule is missing required fields: ${missing.join(", ")}`);
  }

  // Fail here rather than at request time on a bad zone or date string.
  const probe = new Schedule(config as any);
  probe.getBookableRange(DateTime.now().setZone(config.timeZone));
  if (!DateTime.now().setZone(config.timeZone).isValid) {
    throw new Error(`Unknown time zone: ${config.timeZone}`);
  }

  const service = new ScheduleService();
  await service.init();
  const saved = await service.upsert(config);

  const now = DateTime.now().setZone(config.timeZone);
  console.log(`Saved schedule "${saved?._id}"`);
  console.log(JSON.stringify(saved?.toPublic(now), null, 2));
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => DB.close());
