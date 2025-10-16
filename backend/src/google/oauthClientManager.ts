import { google } from "googleapis";
import { OAuth2Client } from "google-auth-library";
import { Environment } from "../environment";
import { GoogleTokens, PersonService } from "../services/person.service";

export class OAuthClientManager {
  private static instance: OAuthClientManager;

  static GetInstance(persons: PersonService) {
    if (!this.instance) {
      this.instance = new OAuthClientManager(persons);
    }
    return this.instance;
  }

  private persons: PersonService;
  private oauths: { [personId: string]: OAuth2Client } = {};

  private constructor(persons: PersonService) {
    this.persons = persons;
  }

  async getClient(personId: string) {
    if (this.oauths[personId]) {
      return this.oauths[personId];
    }
    const client = (this.oauths[personId] = new google.auth.OAuth2(
      Environment.GOOGLE_CLIENT_ID,
      Environment.GOOGLE_CLIENT_SECRET,
      Environment.GOOGLE_REDIRECT_URL,
    ));
    const person = await this.persons.findById(personId);
    if (person && person.googleTokens) {
      this.setCredentials(client, person.googleTokens);
    }
    return client;
  }

  async saveGoogleTokens(personId: string, tokens: GoogleTokens) {
    const client = await this.getClient(personId);
    this.setCredentials(client, tokens);
    await this.persons.update(personId, { googleTokens: tokens });
  }

  private setCredentials(client: OAuth2Client, tokens: GoogleTokens) {
    client.setCredentials({
      access_token: tokens.accessToken,
      refresh_token: tokens.refreshToken,
      expiry_date: tokens.expiryDate.getTime(),
      scope: "https://www.googleapis.com/auth/calendar",
    });
  }
}
