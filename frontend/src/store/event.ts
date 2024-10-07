import { defineStore } from "pinia";
import { computed, Ref } from "vue";
import { useAPI } from "./fetch";
import { Event } from "../../common/event";
import { useRouteQuery } from "@vueuse/router";

export const useEvent = defineStore("event", () => {
  const eventId = useRouteQuery("eventId");

  const url = computed(() => (eventId.value ? `/Events/${eventId.value}` : ""));
  const { data } = useAPI(url, { refetch: true }).get().json();

  return { event: data as Ref<Event> };
});
