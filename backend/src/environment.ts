require("dotenv").config();
type EnvironmentType = "PROD" | "TEST" | "DEV";

export class Environment {
  static get ENV(): EnvironmentType {
    return Environment.clean(process.env.ENV, "DEV") as EnvironmentType;
  }

  static get DB_NAME(): string {
    return Environment.clean(process.env.DB_NAME, "cloud");
  }
  static get DB_URI(): string {
    return Environment.clean(process.env.DB_URI);
  }

  static get PORT(): number {
    return +this.clean(process.env.PORT || "3000");
  }

  public static get TWILIO_SID() {
    return process.env.TWILIO_SID;
  }
  public static get TWILIO_SECRET_TOKEN() {
    return process.env.TWILIO_SECRET_TOKEN;
  }
  public static get TWILIO_FROM_NUMBER() {
    return process.env.TWILIO_FROM_NUMBER;
  }
  public static get TWILIO_MESSAGING_SERVICE_ID() {
    return process.env.TWILIO_MESSAGING_SERVICE_ID;
  }

  public static get GOOGLE_CLIENT_ID() {
    return process.env.GOOGLE_CLIENT_ID;
  }
  public static get GOOGLE_CLIENT_SECRET() {
    return process.env.GOOGLE_CLIENT_SECRET;
  }
  public static get GOOGLE_API_KEY() {
    return process.env.GOOGLE_API_KEY;
  }
  public static get GOOGLE_REDIRECT_URL() {
    return process.env.GOOGLE_REDIRECT_URL;
  }

  private static clean(variable?: string, defaultValue = "") {
    return (variable || defaultValue).replace(/"/gi, "");
  }
}
