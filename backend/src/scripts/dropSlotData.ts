/**
 * Retires the slot-era Mongo data left behind by the calendar pivot.
 *
 *   npm run drop-slot-data              # report only, changes nothing
 *   npm run drop-slot-data -- --confirm # actually drop
 *
 * Three things go:
 *   - the `slots` collection — bookings are calendar events now,
 *   - the `events` collection — replaced by `schedules`,
 *   - `otp.eventId` on `persons` — the OTP scopes to a `scheduleId`, and the
 *     field is gone from the model, so it is dead weight on live documents.
 *
 * Persons, schedules and notifications are untouched: the OTP itself is the
 * login, so unsetting a scope must not invalidate anyone's manage link.
 *
 * This is irreversible and there is no migration — §2 of the pivot plan took
 * the decision to drop the old `2025tdfa` / `2025tdnl4` data outright. Hence
 * the dry run by default: it prints what it would remove against whatever
 * `DB_URI` / `DB_NAME` the environment names, so you can confirm you are
 * pointed at the database you think you are.
 */
import { DB } from "../db";
import { Environment } from "../environment";

const DOOMED_COLLECTIONS = ["slots", "events"];

async function main() {
  const confirmed = process.argv.slice(2).includes("--confirm");
  console.log(`Database: ${Environment.DB_NAME}`);
  console.log(confirmed ? "Mode: DROP\n" : "Mode: dry run (pass --confirm to drop)\n");

  for (const name of DOOMED_COLLECTIONS) {
    const collection = await DB.collection(name);
    const count = await collection.countDocuments();
    if (!confirmed) {
      console.log(`  ${name}: ${count} document(s) would be dropped`);
      continue;
    }
    // drop() reports success for a collection that was never created, which
    // is the desired end state anyway — a database seeded after the pivot has
    // neither. So the count, not the return value, is what is worth printing.
    await collection.drop();
    console.log(
      `  ${name}: ${count ? `dropped (${count} document(s))` : "nothing to drop"}`,
    );
  }

  const persons = await DB.collection("persons");
  const scoped = { "otp.eventId": { $exists: true } };
  const count = await persons.countDocuments(scoped);
  if (!confirmed) {
    console.log(`  persons: ${count} document(s) would lose otp.eventId`);
  } else {
    const { modifiedCount } = await persons.updateMany(scoped, {
      $unset: { "otp.eventId": "" },
    });
    console.log(`  persons: cleared otp.eventId on ${modifiedCount} document(s)`);
  }

  console.log(
    confirmed ? "\nDone." : "\nNothing was changed. Re-run with --confirm.",
  );
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => DB.close());
