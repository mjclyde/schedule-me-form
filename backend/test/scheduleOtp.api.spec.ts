import { assert } from "chai";
import { SchedulesAPI } from "../src/api/schedules.api";
import { Schedule, ScheduleModel } from "../src/models/schedule";
import { Person, PersonModel } from "../src/models/person";

const TZ = "America/Denver";

function makeSchedule(overrides: Partial<ScheduleModel> = {}) {
  return new Schedule({
    _id: "2026spring",
    name: "Spring Tune-Ups 2026",
    type: "Tune-Up",
    description: "15-minute appointments.",
    ownerPersonId: "owner1",
    calendarId: "owner@example.com",
    timeZone: TZ,
    durationMins: 15,
    ...overrides,
  } as ScheduleModel);
}

function makePerson(overrides: Partial<PersonModel> = {}) {
  return new Person({
    _id: "person1",
    name: "Jane Doe",
    phone: "+15555550123",
    otp: {
      value: "abc123",
      expiresAt: new Date(Date.now() + 60_000),
      scheduleId: "2026spring",
    },
    ...overrides,
  } as PersonModel);
}

interface HarnessOptions {
  schedule?: Schedule | null;
  /** Phones that already belong to a person. Anything else is unknown. */
  known?: string[];
  /** An existing person returned by findByPhone, if the phone is known. */
  existing?: Person;
  /** Simulates Twilio being down. */
  smsFails?: boolean;
}

function buildApi(options: HarnessOptions = {}) {
  const schedule = options.schedule === undefined ? makeSchedule() : options.schedule;
  const known = options.known ?? ["+15555550123"];
  const calls = {
    sms: [] as { phone: string; message: string }[],
    otpsCreated: [] as { phone: string; scheduleId?: string }[],
  };

  const api = new SchedulesAPI({ find: () => ({}) } as any);
  (api as any).schedules = { findById: async () => schedule };
  (api as any).persons = {
    findByPhone: async (phone: string) =>
      known.includes(phone) ? (options.existing ?? makePerson({ phone } as any)) : null,
    createOTP: async (phone: string, scope: { scheduleId?: string }) => {
      calls.otpsCreated.push({ phone, scheduleId: scope.scheduleId });
      return known.includes(phone) ? makePerson({ phone, otp: { value: "fresh1", expiresAt: new Date(Date.now() + 60_000), scheduleId: scope.scheduleId } } as any) : null;
    },
  };
  (api as any).notifications = {
    send: async (n: any) => {
      if (options.smsFails) {
        throw new Error("twilio is down");
      }
      calls.sms.push({ phone: n.phone, message: n.message });
    },
  };

  return { api, calls };
}

function fakeRes() {
  return {
    body: undefined as any,
    code: 200,
    send(body: any) {
      this.body = body;
      return this;
    },
    status(code: number) {
      this.code = code;
      return this;
    },
    sendStatus(code: number) {
      this.code = code;
      return this;
    },
  };
}

describe("POST /Schedules/:id/CreateOTP", () => {
  it("texts a manage link to a phone that has booked before", async () => {
    const { api, calls } = buildApi();
    const res = fakeRes();

    await api.createOTP(
      { params: { id: "2026spring" }, body: { phone: "(555) 555-0123" } } as any,
      res as any,
    );

    assert.equal(res.code, 204);
    assert.lengthOf(calls.sms, 1);
    assert.include(calls.sms[0].message, "abc123");
  });

  it("scopes a newly minted OTP to the schedule, not to an event", async () => {
    const { api, calls } = buildApi({
      existing: makePerson({
        otp: { value: "expired", expiresAt: new Date(Date.now() - 60_000) },
      } as any),
    });

    await api.createOTP(
      { params: { id: "2026spring" }, body: { phone: "(555) 555-0123" } } as any,
      fakeRes() as any,
    );

    assert.deepEqual(calls.otpsCreated, [
      { phone: "+15555550123", scheduleId: "2026spring" },
    ]);
  });

  it("reports success without texting a phone that has never booked", async () => {
    // Bug #10: this used to 500. Answering the same way either way keeps the
    // form from becoming an oracle for which numbers are customers.
    const { api, calls } = buildApi({ known: [] });
    const res = fakeRes();

    await api.createOTP(
      { params: { id: "2026spring" }, body: { phone: "(555) 555-9999" } } as any,
      res as any,
    );

    assert.equal(res.code, 204);
    assert.isEmpty(calls.sms);
  });

  it("reuses a live OTP rather than rotating it", async () => {
    // createOTP $sets a whole new otp sub-document, so minting one here would
    // kill the link in every text the person has already received — including
    // a schedule owner's Google-linking OTP.
    const { api, calls } = buildApi({
      existing: makePerson({
        otp: {
          value: "older1",
          expiresAt: new Date(Date.now() + 60_000),
          scheduleId: "some-other-schedule",
        },
      } as any),
    });

    await api.createOTP(
      { params: { id: "2026spring" }, body: { phone: "(555) 555-0123" } } as any,
      fakeRes() as any,
    );

    assert.isEmpty(calls.otpsCreated, "must not rotate a live OTP");
    assert.include(calls.sms[0].message, "older1");
  });

  it("mints a new OTP when the existing one has expired", async () => {
    const { api, calls } = buildApi({
      existing: makePerson({
        otp: {
          value: "expired",
          expiresAt: new Date(Date.now() - 60_000),
          scheduleId: "2026spring",
        },
      } as any),
    });

    await api.createOTP(
      { params: { id: "2026spring" }, body: { phone: "(555) 555-0123" } } as any,
      fakeRes() as any,
    );

    assert.lengthOf(calls.otpsCreated, 1);
    assert.include(calls.sms[0].message, "fresh1");
  });

  it("still reports success when the text cannot be sent", async () => {
    // A 500 here would both break the uniform answer that keeps this from
    // being a customer oracle, and report failure for an OTP that is live.
    const { api } = buildApi({ smsFails: true });
    const res = fakeRes();

    await api.createOTP(
      { params: { id: "2026spring" }, body: { phone: "(555) 555-0123" } } as any,
      res as any,
    );

    assert.equal(res.code, 204);
  });

  it("rejects a request with no phone number", async () => {
    const { api } = buildApi();
    const res = fakeRes();

    await api.createOTP(
      { params: { id: "2026spring" }, body: {} } as any,
      res as any,
    );

    assert.equal(res.code, 400);
  });

  it("404s an unknown schedule", async () => {
    const { api, calls } = buildApi({ schedule: null });
    const res = fakeRes();

    await api.createOTP(
      { params: { id: "nope" }, body: { phone: "(555) 555-0123" } } as any,
      res as any,
    );

    assert.equal(res.code, 404);
    assert.isEmpty(calls.sms);
  });
});

describe("GET /Schedule", () => {
  it("returns the schedule the caller's OTP was minted for", async () => {
    // The OTP deep link lands with no scheduleId in the URL; this is how the
    // page recovers which schedule it is looking at.
    const { api } = buildApi();
    const res = fakeRes();

    await api.findByOtp({ person: makePerson() } as any, res as any);

    assert.equal(res.body._id, "2026spring");
    assert.equal(res.body.name, "Spring Tune-Ups 2026");
  });

  it("does not leak the owner's calendar address", async () => {
    const { api } = buildApi();
    const res = fakeRes();

    await api.findByOtp({ person: makePerson() } as any, res as any);

    assert.notProperty(res.body, "calendarId");
    assert.notProperty(res.body, "ownerPersonId");
  });

  it("404s when the OTP predates schedules", async () => {
    // An OTP minted by the old slot flow carries an eventId, not a scheduleId.
    const { api } = buildApi();
    const res = fakeRes();

    await api.findByOtp(
      {
        person: makePerson({
          otp: {
            value: "abc123",
            expiresAt: new Date(Date.now() + 60_000),
            eventId: "2025tdfa",
          },
        } as any),
      } as any,
      res as any,
    );

    assert.equal(res.code, 404);
  });
});
