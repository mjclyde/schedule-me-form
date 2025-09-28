
interface CalendarEventInfo {
  id: string;
  title: String;
  start: Date;
  end: Date;
  description?: string;
  location?: string;
  organizer?: string;
}

export function CreateICS(info: CalendarEventInfo) {
  return `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
SUMMARY:${info.title}
DTSTART:${formatTime(info.start)}
DTEND:${formatTime(info.end)}
DTSTAMP:${formatTime(new Date())}
UID:${info.id}
DESCRIPTION:${info.description || ""}
LOCATION:${info.location || ""}
ORGANIZER:${info.organizer || ""}
STATUS:CONFIRMED
PRIORITY:0
END:VEVENT
END:VCALENDAR`;
}

function formatTime(date: Date) {
  return date
    .toISOString()
    .replace(/(-|:|\.)/gi, "")
    .replace(/(\d){3}Z/, "Z");
}
