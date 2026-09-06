import { defineStore } from "pinia";
import { computed, Ref } from "vue";
import { useAPI } from "./fetch";
import { PublicSchedule } from "../../common/schedule";
import { useRouteQuery } from "@vueuse/router";

/**
 * The schedule being booked, from `?scheduleId=`.
 *
 * `"/"` is the no-op URL: the shared fetch wrapper cancels it, so the request
 * is skipped entirely until an id is present.
 */
export const useSchedule = defineStore("schedule", () => {
  const scheduleId = useRouteQuery<string>("scheduleId");

  const url = computed(() =>
    scheduleId.value ? `/Schedules/${scheduleId.value}` : "/",
  );
  const { data, error } = useAPI(url, { refetch: true }).get().json();

  return {
    scheduleId,
    schedule: data as Ref<PublicSchedule | null>,
    error,
  };
});
