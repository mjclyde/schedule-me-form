import { google, calendar_v3 } from "googleapis";
import { OAuth2Client } from "google-auth-library";
import { DateTime } from "luxon";

interface ListEventsParams {
  calendarId: string;
  timeMax?: Date;
  timeMin?: Date;
  maxResults?: number;
  pageToken?: string;
}

export class GoogleCalendar {
  private auth: OAuth2Client;
  private cal: calendar_v3.Calendar;

  constructor(auth: OAuth2Client) {
    this.auth = auth;
    this.cal = google.calendar({ version: "v3", auth: this.auth });
  }

  async listCalendars() {
    const { data } = await this.cal.calendarList.list();
    return data;
  }

  async listEvents(params: ListEventsParams) {
    const events: calendar_v3.Schema$Event[] = [];
    let nextPageToken: string | null | undefined = undefined;
    do {
      const { data } = await this.cal.events.list({
        ...params,
        timeMax: params.timeMax?.toISOString(),
        timeMin: params.timeMin?.toISOString(),
        singleEvents: true,
      });
      for (const i of data.items || []) {
        events.push(i);
      }
      nextPageToken = data.nextPageToken;
    } while (nextPageToken);

    return events;
  }

  async getBusyTime(
    calendarId: string,
    params: { timeMin: Date; timeMax: Date; defaultTimeZone: string },
  ) {
    const busy: { [date: string]: { start: DateTime; end: DateTime }[] } = {};
    const googleEvents = await this.listEvents({
      calendarId,
      timeMin: params.timeMin,
      timeMax: params.timeMax,
    });
    for (const e of googleEvents) {
      if (e.transparency === "transparent") {
        continue;
      }
      let date: DateTime | undefined = undefined;
      let endDate: DateTime | undefined = undefined;

      if (e.start?.date) {
        date = DateTime.fromISO(e.start.date, { zone: params.defaultTimeZone });
      } else if (e.start?.dateTime) {
        date = DateTime.fromISO(e.start.dateTime, {
          zone: e.start.timeZone || params.defaultTimeZone,
        });
      }

      if (e.end?.date) {
        endDate = DateTime.fromISO(e.end.date, {
          zone: params.defaultTimeZone,
        });
      } else if (e.end?.dateTime) {
        endDate = DateTime.fromISO(e.end.dateTime, {
          zone: e.end.timeZone || params.defaultTimeZone,
        });
      }

      if (date && endDate) {
        const start = DateTime.fromMillis(date.toMillis());
        while (date < endDate) {
          const dateStr = date.toFormat("yyyy-LL-dd");
          busy[dateStr] ??= [];
          busy[dateStr].push({ start, end: endDate });
          date = date.plus({ day: 1 });
        }
      }
    }
    return busy;
  }
}
