/**
 * Runs one reminder sweep by hand.
 *
 *   npm run reminders
 *
 * The cron only starts when `ENV=PROD`, so this is how the sweep gets
 * exercised locally without waiting on `0 12-18 * * *`.
 *
 * This sends REAL text messages to anyone with an appointment between now and
 * the end of tomorrow who has not already been reminded, and stamps
 * `reminderSentAt` on their calendar event so the next sweep skips them.
 *
 * Twilio credentials are required to run it at all: NotificationService builds
 * a Twilio client in its constructor, which throws on a missing SID, so
 * registration fails before any sweep starts. (The server has the same
 * requirement, for the same reason.)
 */
import { Injector, InjectableConstructor } from "@ncss/api-decorator";
import { DateTime } from "luxon";
import { DB } from "../db";
import { NotificationService } from "../services/notification.service";
import { PersonService } from "../services/person.service";
import { ScheduleService } from "../services/schedule.service";
import { Reminders, reminderWindowEnd } from "../reminders";

const SERVICES: InjectableConstructor[] = [
  ScheduleService,
  PersonService,
  NotificationService,
];

async function main() {
  const injector = new Injector();
  for (const service of SERVICES) {
    await injector.register(service);
  }

  const now = DateTime.now();
  console.log(`Sweeping for reminders due before ${reminderWindowEnd(now)}`);
  await new Reminders(injector).run(now);
  console.log("Sweep complete.");
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => DB.close());
