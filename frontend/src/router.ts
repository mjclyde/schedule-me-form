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
    const res = await axios.get(import.meta.env.VITE_API_HOST + "/Event", {
      headers: { Authorization: otp },
    });
    next({ name: "my-events", query: { eventId: res.data._id } });
  }
  // Carry the current schedule/event across navigation so the nav links work
  // without re-stating it. `eventId` still belongs to the old slot-based
  // My Events page, which moves to bookings in the next phase.
  const carried: Record<string, any> = { ...to.query };
  let changed = false;
  for (const key of ["scheduleId", "eventId"]) {
    if (from.query[key] && !to.query[key]) {
      carried[key] = from.query[key];
      changed = true;
    }
  }
  if (changed) {
    next({ ...to, query: carried });
  } else {
    next();
  }
});

export default router;
