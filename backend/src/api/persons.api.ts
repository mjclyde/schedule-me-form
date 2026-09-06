import { API, Injector } from "@ncss/api-decorator";
import { Response, Request } from "express";
import { AuthorizedRequest, UseOTPAuth } from "../middleware/otpAuthorization";
import { PersonService } from "../services/person.service";
import {
  CALENDAR_SCOPE,
  OAuthClientManager,
} from "../google/oauthClientManager";
import { GoogleCalendarManager } from "../google/googleCalendarManager";
import { signState, verifyState } from "../google/oauthState";
import { Environment } from "../environment";

export class PersonsAPI {
  authManager: OAuthClientManager;
  calendarManager: GoogleCalendarManager;

  constructor(injector: Injector) {
    const persons = injector.find<PersonService>(PersonService);
    this.authManager = OAuthClientManager.GetInstance(persons);
    this.calendarManager = GoogleCalendarManager.GetInstance(persons);
  }

  @API("get", "/Me", UseOTPAuth())
  async getMyInfo(req: AuthorizedRequest, res: Response) {
    res.send({ ...req.person, otp: undefined, googleTokens: undefined });
  }

  @API("get", "/Google/Calendars", UseOTPAuth())
  async listMyGoogleCalendars(req: AuthorizedRequest, res: Response) {
    const calendar = await this.calendarManager.getCalendar(req.person._id);
    res.send((await calendar.listCalendars()) || []);
  }

  /**
   * Returns the Google consent URL for the *authenticated* person.
   *
   * Deliberately returns JSON rather than redirecting: a redirect is a browser
   * navigation and cannot carry the OTP header, which is what forced the old
   * endpoint to take the person id from the query string and trust it. The
   * caller navigates to the returned url itself.
   */
  @API("get", "/Google/AuthUrl", UseOTPAuth())
  async googleAuthUrl(req: AuthorizedRequest, res: Response) {
    if (!Environment.OAUTH_STATE_SECRET) {
      console.error("Cannot start Google OAuth without OAUTH_STATE_SECRET");
      return res.sendStatus(500);
    }
    const personId = req.person._id;
    const url = (await this.authManager.getClient(personId)).generateAuthUrl({
      access_type: "offline",
      prompt: "consent",
      scope: [CALENDAR_SCOPE],
      state: signState(personId, Environment.OAUTH_STATE_SECRET),
    });
    res.send({ url });
  }

  @API("get", "/GoogleAuth/Redirect")
  async googleAuthRedirect(req: Request, res: Response) {
    if (typeof req.query.code !== "string" || typeof req.query.state !== "string") {
      return res.status(400).send("Missing code or state");
    }
    // Google calls this endpoint, so it cannot be authenticated. The signature
    // on `state` is what proves the flow was started by that person.
    const personId = verifyState(req.query.state, Environment.OAUTH_STATE_SECRET);
    if (!personId) {
      return res.status(400).send("Invalid or expired authorization request");
    }

    const authClient = await this.authManager.getClient(personId);
    const { tokens } = await authClient.getToken(req.query.code);
    if (!tokens.access_token || !tokens.refresh_token || !tokens.expiry_date) {
      // Logged without the token payload: even a partial one is a credential.
      console.error(
        `Did not receive the expected tokens from Google (got: ${Object.keys(
          tokens,
        ).join(", ") || "nothing"})`,
      );
      return res.status(502).send("Google did not return the expected tokens");
    }
    await this.authManager.saveGoogleTokens(personId, {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiryDate: new Date(tokens.expiry_date),
    });
    res.send("Google Account Linked");
  }
}
