import { google, calendar_v3 } from "googleapis";
import { OAuth2Client } from "google-auth-library";
import { DateTime } from "luxon";
import { toQueryFilters } from "./bookingTags";

interface ListEventsParams {
  calendarId: string;
  timeMax?: Date;
  timeMin?: Date;
  maxResults?: number;
  pageToken?: string;
  /** Repeated `key=value` filters, AND-ed together by Google. */
  privateExtendedProperty?: string[];
}

interface WriteOptions {
  /** Whether Google emails the attendees. Defaults to Google's own default. */
  sendUpdates?: "all" | "externalOnly" | "none";
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
    let pageToken: string | undefined = params.pageToken;
    do {
      const { data } = await this.cal.events.list({
        ...params,
        timeMax: params.timeMax?.toISOString(),
        timeMin: params.timeMin?.toISOString(),
        singleEvents: true,
        // Feed the token from the previous response back in. Without this the
        // loop below re-requests page one forever on any calendar with more
        // events in range than Google's page size.
        pageToken,
      });
      for (const i of data.items || []) {
        events.push(i);
      }
      pageToken = data.nextPageToken || undefined;
    } while (pageToken);

    return events;
  }

  /** Lists only events this app created, optionally narrowed by schedule/person. */
  async listAppEvents(
    params: Omit<ListEventsParams, "privateExtendedProperty"> & {
      filters?: Parameters<typeof toQueryFilters>[0];
    },
  ) {
    const { filters, ...rest } = params;
    return this.listEvents({
      ...rest,
      privateExtendedProperty: toQueryFilters(filters),
    });
  }

  async getEvent(calendarId: string, eventId: string) {
    const { data } = await this.cal.events.get({ calendarId, eventId });
    return data;
  }

  async insertEvent(
    calendarId: string,
    event: calendar_v3.Schema$Event,
    options: WriteOptions = {},
  ) {
    const { data } = await this.cal.events.insert({
      calendarId,
      requestBody: event,
      sendUpdates: options.sendUpdates,
    });
    return data;
  }

  /** Partial update — only the fields present in `event` are changed. */
  async patchEvent(
    calendarId: string,
    eventId: string,
    event: calendar_v3.Schema$Event,
    options: WriteOptions = {},
  ) {
    const { data } = await this.cal.events.patch({
      calendarId,
      eventId,
      requestBody: event,
      sendUpdates: options.sendUpdates,
    });
    return data;
  }

  async deleteEvent(
    calendarId: string,
    eventId: string,
    options: WriteOptions = {},
  ) {
    await this.cal.events.delete({
      calendarId,
      eventId,
      sendUpdates: options.sendUpdates,
    });
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
