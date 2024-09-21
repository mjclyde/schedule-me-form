import { Injector } from "@ncss/api-decorator";
import { NotificationService } from "./services/notification.service";
import { SlotService } from "./services/slot.service";

const timeZone = 'America/Denver';

export async function ProcessReminders(injector: Injector, eventId: string) {

  const notifications: NotificationService = injector.find(NotificationService);
  const slots: SlotService = injector.find(SlotService);

  const diff = getMinutesUntilEndOfDay(timeZone);

  const docs = await slots.findRemindersDue(eventId, (24 * 60) + diff);
  console.log(docs);
  for (const d of docs) {
    const formattedDate = d.startAt.toLocaleDateString('en-US', { timeZone: 'America/Denver' });
    const message = `Hello ${d.person.name}. This is a reminder about your ${d.event.type} appointment ` +
      (isTomorrow(d.startAt) ? `tomorrow (${formattedDate}) ` : `on ${formattedDate} `) +
      `at ${formatTime(d.startAt)}. We look forward to seeing you there!`;

    await notifications.send({
      personId: d.person.id,
      name: d.person.name,
      phone: d.person.phone,
      message,
    })
    await slots.reminderHasBeenSent(d._id, d.person.id);
  }

}

function isTomorrow(date: Date) {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  return formatDate(tomorrow) === formatDate(date);
}

function formatDate(date: Date) {
  return date.toLocaleDateString('en-US', { timeZone });
}

function formatTime(date?: Date) {
  if (!date) { return '' }
  return date.toLocaleTimeString('en-US', { timeZone }).replace(/\:\d{2}\s/, ' ');
}

function getMinutesUntilEndOfDay(timeZone: string) {
  const now = new Date();
  const endOfDay = new Date();
  endOfDay.setHours(23, 59, 59, 999);
  const minutes = Math.round((endOfDay.getTime() - now.getTime()) / 1000 / 60);
  return minutes + getTimeZoneOffset(timeZone);
}

function getTimeZoneOffset(timeZone: string) {
  const now = new Date();
  const d = new Date(now.toLocaleString('en-US', { timeZone }));
  d.setMilliseconds(now.getMilliseconds());
  return (now.getTime() - d.getTime()) / 1000 / 60
}
