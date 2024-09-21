import { defineStore } from "pinia";
import { computed, Ref, ref } from "vue";
import { useAPI } from "./fetch";
import { Event } from '../../common/event';

export const useEvent = defineStore('event', () => {

  const search = ref(window.location.search);
  const eventId = computed(() => {
    console.log('Search', search.value);
    const match = /eventId=([a-zA-z0-9\-]+)/.exec(search.value || '');
    return match?.[1] ? match[1] : ''
  });
  const url = computed(() => '/Events/' + eventId.value);

  const { data } = useAPI(url).get().json();

  return { event: data as Ref<Event> };
})
