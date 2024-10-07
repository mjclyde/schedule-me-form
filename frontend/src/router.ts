import { createWebHistory, createRouter, RouteRecordRaw } from "vue-router";
import axios from "axios";

import EventPicker from "./pages/EventPicker.vue";
import MyEvents from "./pages/MyEvents.vue";

const routes: RouteRecordRaw[] = [
  { path: "/", component: EventPicker, name: "event-picker" },
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
  if (from.query.eventId && !to.query.eventId) {
    next({ ...to, query: { ...to.query, eventId: from.query.eventId } });
  } else {
    next();
  }
});

export default router;
