import { API } from "@ncss/api-decorator";
import { Response } from "express";
import { AuthorizedRequest, UseOTPAuth } from "../middleware/otpAuthorization";

export class PersonsAPI {

  @API('get', '/Me', UseOTPAuth())
  async getMyInfo(req: AuthorizedRequest, res: Response) {
    res.send({...req.person, otp: undefined});
  }

}
