/**
 * Runs one reminder sweep by hand.
 *
 *   npm run reminders
 *
 * The cron only starts when `ENV=PROD`, so this is how the sweep gets
 * exercised locally without waiting on `0 12-18 * * *`.
 *
 * This sends REAL text messages to anyone with an appointment in the next 24
 * hours who has not already been reminded, and stamps `reminderSentAt` on
 * their calendar event so the next sweep skips them. With no Twilio
 * credentials configured the send fails, which the sweep logs and skips,
 * leaving the booking unstamped for a later retry.
 */
import { Injector, InjectableConstructor } from "@ncss/api-decorator";
import { DateTime } from "luxon";
import { DB } from "../db";
import { NotificationService } from "../services/notification.service";
import { PersonService } from "../services/person.service";
import { ScheduleService } from "../services/schedule.service";
import { Reminders } from "../reminders";

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
  console.log(`Sweeping for reminders due before ${now.plus({ hours: 24 })}`);
  await new Reminders(injector).run(now);
  console.log("Sweep complete.");
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => DB.close());
