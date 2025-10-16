import { PersonService } from "../services/person.service";
import { GoogleCalendar } from "./googleCalendar";
import { OAuthClientManager } from "./oauthClientManager";

export class GoogleCalendarManager {
  private static instance: GoogleCalendarManager;

  static GetInstance(persons: PersonService) {
    if (!this.instance) {
      this.instance = new GoogleCalendarManager(persons);
    }
    return this.instance;
  }

  private authClientManager: OAuthClientManager;
  private calendars: { [persionId: string]: GoogleCalendar } = {};

  private constructor(persons: PersonService) {
    this.authClientManager = OAuthClientManager.GetInstance(persons);
  }

  async getCalendar(personId: string) {
    if (!this.calendars[personId]) {
      const auth = await this.authClientManager.getClient(personId);
      this.calendars[personId] = new GoogleCalendar(auth);
    }
    return this.calendars[personId];
  }
}
