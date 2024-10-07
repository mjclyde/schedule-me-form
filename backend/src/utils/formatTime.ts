export function FormatTime(date?: Date) {
  if (!date) { return '' }
  return date.toLocaleTimeString('en-US', { timeZone: 'America/Denver' }).replace(/\:\d{2}\s/, ' ');
}
