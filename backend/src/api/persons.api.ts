import { API, Injector } from "@ncss/api-decorator";
import { Response, Request } from "express";
import { AuthorizedRequest, UseOTPAuth } from "../middleware/otpAuthorization";
import { PersonService } from "../services/person.service";
import { OAuthClientManager } from "../google/oauthClientManager";
import { GoogleCalendarManager } from "../google/googleCalendarManager";

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

  @API("get", "/GoogleAuth")
  async googleAuth(req: AuthorizedRequest, res: Response) {
    if (typeof req.query.id !== "string") {
      return res.status(400).send("Missing id in query");
    }
    const url = (
      await this.authManager.getClient(req.query.id)
    ).generateAuthUrl({
      access_type: "offline",
      prompt: "consent",
      scope: ["https://www.googleapis.com/auth/calendar"],
      state: req.params.personId,
    });
    res.redirect(url);
  }

  @API("get", "/GoogleAuth/Redirect")
  async googleAuthRedirect(req: Request, res: Response) {
    const personId = req.query.state;
    if (typeof req.query.code !== "string" || typeof personId !== "string") {
      return;
    }
    const authClient = await this.authManager.getClient(personId);
    const { tokens } = await authClient.getToken(req.query.code);
    if (!tokens.access_token || !tokens.refresh_token || !tokens.expiry_date) {
      console.error(
        "Did not recieve expected tokens from google: " +
          JSON.stringify(tokens),
      );
      return;
    }
    await this.authManager.saveGoogleTokens(personId, {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiryDate: new Date(tokens.expiry_date),
    });
    res.send("Google Account Linked");
  }
}
