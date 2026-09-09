import { createWebHistory, createRouter, RouteRecordRaw } from "vue-router";
import axios from "axios";

import BookingPage from "./pages/BookingPage.vue";
import MyEvents from "./pages/MyEvents.vue";

const routes: RouteRecordRaw[] = [
  { path: "/", component: BookingPage, name: "booking" },
  { path: "/my-events", component: MyEvents, name: "my-events" },
  { path: "/otp/:otp", component: MyEvents, name: "otp" },
];

const router = createRouter({
  history: createWebHistory(),
  routes,
});

router.beforeEach(async (to, from, next) => {
  if (to.name === "otp") {
    const otp = to.params.otp?.toString() || "";
    localStorage.setItem("otp", otp);
    // The deep link carries nothing but the code, so ask which schedule the
    // OTP was minted for. My Bookings still works without one — it is scoped
    // to the person — so a lookup failure lands there rather than erroring.
    const scheduleId = await resolveScheduleId(otp);
    return next({
      name: "my-events",
      query: scheduleId ? { scheduleId } : {},
    });
  }
  // Carry the current schedule across navigation so the nav links work
  // without re-stating it.
  if (from.query.scheduleId && !to.query.scheduleId) {
    return next({
      ...to,
      query: { ...to.query, scheduleId: from.query.scheduleId },
    });
  }
  next();
});

async function resolveScheduleId(otp: string) {
  try {
    const res = await axios.get(import.meta.env.VITE_API_HOST + "/Schedule", {
      headers: { Authorization: otp },
    });
    return res.data?._id as string | undefined;
  } catch {
    return undefined;
  }
}

export default router;
