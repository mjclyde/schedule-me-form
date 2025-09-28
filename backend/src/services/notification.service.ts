import { ObjectId } from "mongodb";
import { BaseService } from "./base.service";
import { Notification, NotificationModal } from "../models/notification";
import { Twilio } from "twilio";
import { Environment } from "../environment";
import { MessageInstance } from "twilio/lib/rest/api/v2010/account/message";

export class NotificationService extends BaseService<NotificationModal> {
  protected collectionName = "notifications";
  private twilio: Twilio;

  constructor() {
    super();
    this.twilio = new Twilio(
      Environment.TWILIO_SID,
      Environment.TWILIO_SECRET_TOKEN
    );
  }

  async send(info: {
    personId: string;
    name: string;
    phone: string;
    message: string;
    optOutSMS?: boolean;
  }) {
    let res: MessageInstance | undefined = undefined;
    if (!info?.optOutSMS) {
      res = await this.twilio.messages.create({
        messagingServiceSid: Environment.TWILIO_MESSAGING_SERVICE_ID,
        to: info.phone,
        body: info.message,
      });
    }
    return await this.create({
      ...info,
      skippedSendingSMS: !!info?.optOutSMS,
      twilioResponse: res ? {
        errorCode: res.errorCode,
        errorMessage: res.errorMessage,
      } : undefined,
    });
  }

  private create(notification: Omit<NotificationModal, "_id">) {
    const doc = new Notification({
      _id: new ObjectId().toHexString(),
      ...notification,
    });
    this.addCreatedBy(doc);
    return this.collection.insertOne(doc).then(() => doc);
  }
}
