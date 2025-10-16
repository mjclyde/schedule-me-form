import { Injector } from "@ncss/api-decorator";
import { PersonService } from "../services/person.service";
import { NextFunction, Request, Response } from "express";
import { Person } from "../models/person";

type PersonWithOTP = Person & Required<Pick<Person, "otp">>;
export type AuthorizedRequest = Request & { person: PersonWithOTP };

let _injector: Injector;
export function SetOTPAuthInjector(injector: Injector) {
  _injector = injector;
}

export function UseOTPAuth() {
  return async (req: Request, res: Response, next: NextFunction) => {
    if (!_injector) {
      throw new Error(
        'Cannot use OTPAuth without calling "SetOTPAuthInjector"',
      );
    }
    const persons: PersonService = _injector.find(PersonService);
    const otp = req.headers.authorization;
    if (!otp) {
      return res.sendStatus(400);
    }
    const doc = await persons.findByOTP(otp);
    if (!doc?.isValidOtp(otp)) {
      return res.sendStatus(404);
    }
    (req as AuthorizedRequest).person = doc as PersonWithOTP;
    next();
  };
}
