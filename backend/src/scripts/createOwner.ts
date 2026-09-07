/**
 * Creates (or finds) a person and mints an OTP for them, printing the id and
 * token needed to link a Google calendar.
 *
 * This exists because the OTP flow cannot bootstrap itself: PersonService
 * .createOTP() updates an existing document rather than upserting, and persons
 * are otherwise only created by booking an appointment. Linking a calendar
 * needs an OTP, an OTP needs a person, and a booking needs a linked calendar —
 * so the first person on a fresh database has to be made server-side.
 *
 *   npm run owner -- "+15555550100" "Your Name" [scheduleId]
 */
import { DateTime } from "luxon";
import { DB } from "../db";
import { PersonService } from "../services/person.service";
import { FormatPhoneNumber } from "../utils/formatPhoneNumber";

async function main() {
  const [rawPhone, name, scheduleId] = process.argv.slice(2);
  if (!rawPhone || !name) {
    throw new Error(
      'Usage: npm run owner -- "+15555550100" "Your Name" [scheduleId]',
    );
  }

  const phone = FormatPhoneNumber(rawPhone.trim());
  if (!/^\+\d{10,15}$/.test(phone)) {
    throw new Error(`"${rawPhone}" is not a valid phone number`);
  }

  const persons = new PersonService();
  await persons.init();

  let person = await persons.findByPhone(phone);
  if (person) {
    console.log(`Found existing person for ${phone}`);
  } else {
    // optOutSMS: this is an owner bootstrap, not a sign-up — don't text them.
    person = await persons.create({ name, phone, optOutSMS: true });
    console.log(`Created person for ${phone}`);
  }

  const updated = await persons.createOTP(phone, scheduleId || "");
  const otp = updated?.otp?.value;
  if (!otp) {
    throw new Error("Failed to mint an OTP");
  }

  const expires = updated?.otp?.expiresAt
    ? DateTime.fromJSDate(new Date(updated.otp.expiresAt)).toISO()
    : "unknown";

  console.log("");
  console.log(`  ownerPersonId : ${person._id}`);
  console.log(`  otp           : ${otp}   (expires ${expires})`);
  console.log("");
  console.log("Next, link a Google calendar:");
  console.log(`  curl -H "Authorization: ${otp}" $API/Google/AuthUrl`);
  console.log("  # open the returned url in a browser and approve");
  console.log(`  curl -H "Authorization: ${otp}" $API/Google/Calendars`);
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => DB.close());
