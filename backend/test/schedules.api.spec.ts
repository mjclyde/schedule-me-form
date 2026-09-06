import { assert } from "chai";
import { DateTime } from "luxon";
import { SchedulesAPI } from "../src/api/schedules.api";
import { Schedule, ScheduleModel } from "../src/models/schedule";
import { CalendarEventLike } from "../src/google/availability";
import { AvailabilityResponse } from "../../common/schedule";

const TZ = "America/Denver";

/**
 * Drives the API class directly with a stubbed schedule store and calendar, so
 * the clamping and state logic can be exercised without Mongo or Google.
 */
function buildApi(schedule: Schedule | null, events: CalendarEventLike[] = []) {
  const listEvents = { calls: [] as { timeMin?: Date; timeMax?: Date }[] };
  const injector = {
    find: () => ({}),
  } as any;

  const api = new SchedulesAPI(injector);
  (api as any).schedules = { findById: async () => schedule };
  (api as any).calendarManager = {
    getCalendar: async () => ({
      listEvents: async (params: { timeMin?: Date; timeMax?: Date }) => {
        listEvents.calls.push(params);
        return events;
      },
    }),
  };
  return { api, listEvents };
}

function fakeRes() {
  const res = {
    body: undefined as any,
    status: 200,
    send(body: any) {
      this.body = body;
      return this;
    },
    sendStatus(code: number) {
      this.status = code;
      return this;
    },
  };
  return res;
}

function req(id: string, query: Record<string, unknown> = {}) {
  return { params: { id }, query } as any;
}

/** Returns the rejection of `promise`, or undefined if it resolved. */
async function captureError(promise: Promise<unknown>) {
  try {
    await promise;
    return undefined;
  } catch (err) {
    return err as Error;
  }
}

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
    minNoticeMins: 0,
    ...overrides,
  } as ScheduleModel);
}

/** A window far enough out that the default minimum notice never bites. */
function freeWindow(startISO: string, endISO: string): CalendarEventLike {
  return {
    transparency: "transparent",
    start: { dateTime: startISO, timeZone: TZ },
    end: { dateTime: endISO, timeZone: TZ },
  };
}

function times(body: AvailabilityResponse) {
  return body.slots.map((s) =>
    DateTime.fromISO(s.startAt).setZone(TZ).toFormat("yyyy-LL-dd HH:mm"),
  );
}

describe("SchedulesAPI", () => {
  describe("GET /Schedules/:id", () => {
    it("omits the owner's calendar and phone numbers", async () => {
      // The endpoint is public; leaking calendarId or a notify phone would be
      // a real disclosure.
      const schedule = makeSchedule({
        notify: [{ id: "p1", name: "Owner", phone: "+15555550100" }],
      });
      const { api } = buildApi(schedule);
      const res = fakeRes();

      await api.findById(req("2026spring"), res as any);

      assert.notProperty(res.body, "calendarId");
      assert.notProperty(res.body, "ownerPersonId");
      assert.notProperty(res.body, "notify");
      assert.equal(res.body.name, "Spring Tune-Ups 2026");
      assert.equal(res.body.timeZone, TZ);
    });

    it("404s an unknown or disabled schedule", async () => {
      const missing = buildApi(null);
      const missingRes = fakeRes();
      await missing.api.findById(req("nope"), missingRes as any);
      assert.equal(missingRes.status, 404);

      const disabled = buildApi(makeSchedule({ active: false }));
      const disabledRes = fakeRes();
      await disabled.api.findById(req("2026spring"), disabledRes as any);
      assert.equal(disabledRes.status, 404);
    });
  });

  describe("GET /Schedules/:id/Availability", () => {
    it("derives slots from the calendar's free windows", async () => {
      const schedule = makeSchedule();
      const { api } = buildApi(schedule, [
        freeWindow("2099-03-02T09:00:00-07:00", "2099-03-02T10:00:00-07:00"),
      ]);
      const res = fakeRes();

      await api.findAvailability(
        req("2026spring", { from: "2099-03-01", to: "2099-03-03" }),
        res as any,
      );

      assert.equal(res.body.state, "open");
      assert.equal(res.body.timeZone, TZ);
      assert.deepEqual(times(res.body), [
        "2099-03-02 09:00",
        "2099-03-02 09:15",
        "2099-03-02 09:30",
        "2099-03-02 09:45",
      ]);
    });

    it("trims a window that runs past the requested range", async () => {
      const schedule = makeSchedule({ durationMins: 60 });
      const { api } = buildApi(schedule, [
        freeWindow("2099-03-02T09:00:00-07:00", "2099-03-03T09:00:00-07:00"),
      ]);
      const res = fakeRes();

      await api.findAvailability(
        req("2026spring", { from: "2099-03-02", to: "2099-03-03" }),
        res as any,
      );

      // Nothing on the 3rd, because the request ends at its first moment.
      assert.deepEqual(
        times(res.body).filter((t) => t.startsWith("2099-03-03")),
        [],
      );
      assert.equal(times(res.body)[0], "2099-03-02 09:00");
    });

    it("makes no calendar call for a month outside the schedule's window", async () => {
      // The saving that the range clamp exists for.
      const schedule = makeSchedule({
        startDate: "2099-03-01",
        endDate: "2099-05-31",
      });
      const { api, listEvents } = buildApi(schedule, []);
      const res = fakeRes();

      await api.findAvailability(
        req("2026spring", { from: "2099-07-01", to: "2099-07-31" }),
        res as any,
      );

      assert.deepEqual(res.body.slots, []);
      assert.lengthOf(listEvents.calls, 0);
    });

    it("reports the state without slots before the window opens", async () => {
      const schedule = makeSchedule({
        startDate: "2099-03-01",
        endDate: "2099-05-31",
      });
      const { api } = buildApi(schedule, []);
      const res = fakeRes();

      await api.findAvailability(
        req("2026spring", { from: "2098-01-01", to: "2098-01-31" }),
        res as any,
      );

      assert.equal(res.body.state, "before");
      assert.deepEqual(res.body.slots, []);
    });

    it("reports closed and books nothing once the window has passed", async () => {
      const schedule = makeSchedule({
        startDate: "2020-03-01",
        endDate: "2020-05-31",
      });
      const { api, listEvents } = buildApi(schedule, []);
      const res = fakeRes();

      await api.findAvailability(
        req("2026spring", { from: "2020-04-01", to: "2020-04-30" }),
        res as any,
      );

      assert.equal(res.body.state, "closed");
      assert.deepEqual(res.body.slots, []);
      assert.lengthOf(listEvents.calls, 0);
    });

    it("widens the calendar query past the requested range", async () => {
      // A busy event starting before the range can still overlap into it.
      const schedule = makeSchedule();
      const { api, listEvents } = buildApi(schedule, []);
      const res = fakeRes();

      await api.findAvailability(
        req("2026spring", { from: "2099-03-10", to: "2099-03-11" }),
        res as any,
      );

      assert.lengthOf(listEvents.calls, 1);
      const { timeMin, timeMax } = listEvents.calls[0];
      assert.isBelow(timeMin!.getTime(), new Date("2099-03-10T00:00:00-07:00").getTime());
      assert.isAbove(timeMax!.getTime(), new Date("2099-03-11T00:00:00-07:00").getTime());
    });

    it("rejects a range longer than the ceiling", async () => {
      const { api } = buildApi(makeSchedule());
      const res = fakeRes();

      const error = await captureError(
        api.findAvailability(
          req("2026spring", { from: "2099-01-01", to: "2099-12-31" }),
          res as any,
        ),
      );

      assert.match(error?.message ?? "", /longer than 62 days/);
    });

    it("rejects an unparseable or repeated date parameter", async () => {
      const { api } = buildApi(makeSchedule());

      const badDate = await captureError(
        api.findAvailability(
          req("2026spring", { from: "yesterday" }),
          fakeRes() as any,
        ),
      );
      assert.match(badDate?.message ?? "", /not a valid date/);

      const repeated = await captureError(
        api.findAvailability(
          req("2026spring", { from: ["2099-03-01", "2099-03-02"] }),
          fakeRes() as any,
        ),
      );
      assert.match(repeated?.message ?? "", /single date string/);
    });

    it("serves a repeated request from the cache", async () => {
      const schedule = makeSchedule();
      const { api, listEvents } = buildApi(schedule, [
        freeWindow("2099-03-02T09:00:00-07:00", "2099-03-02T10:00:00-07:00"),
      ]);

      const query = { from: "2099-03-01", to: "2099-03-03" };
      await api.findAvailability(req("2026spring", query), fakeRes() as any);
      await api.findAvailability(req("2026spring", query), fakeRes() as any);

      assert.lengthOf(listEvents.calls, 1);
    });
  });
});
