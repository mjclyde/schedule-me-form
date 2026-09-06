import { google } from "googleapis";
import { OAuth2Client } from "google-auth-library";
import { Environment } from "../environment";
import { GoogleTokens, PersonService } from "../services/person.service";

export const CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar";

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

    // The library refreshes the access token on our behalf, but only in memory.
    // Persisting it means a restart does not start from an expired token, and
    // it captures the rare case where Google rotates the refresh token too.
    client.on("tokens", (tokens) => {
      const refreshToken =
        tokens.refresh_token || (client.credentials.refresh_token ?? undefined);
      if (!tokens.access_token || !refreshToken || !tokens.expiry_date) {
        return;
      }
      this.persons
        .update(personId, {
          googleTokens: {
            accessToken: tokens.access_token,
            refreshToken,
            expiryDate: new Date(tokens.expiry_date),
          },
        })
        .catch((err) =>
          console.error(`Failed to persist refreshed Google tokens: ${err}`),
        );
    });

    const person = await this.persons.findById(personId);
    if (person && person.googleTokens) {
      this.setCredentials(client, person.googleTokens);
    }
    return client;
  }

  /**
   * Drops the cached client so the next call re-reads from the database.
   * Needed when a grant is revoked or re-linked — otherwise the process keeps
   * using credentials it has already been told are dead.
   */
  evict(personId: string) {
    delete this.oauths[personId];
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
      scope: CALENDAR_SCOPE,
    });
  }
}
