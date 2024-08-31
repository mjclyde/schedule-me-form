import { defineStore } from 'pinia';
import { Event } from '../.././common/event';
import { computed, ref } from 'vue';

export const useEvents = defineStore('events', () => {

  const events = ref<Event[]>([]);
  const calendarDays = computed(() => createCalendarDays(events.value))

  function fetchEvents() {
    events.value = [];
  }

  return {
    fetchEvents,
    events,
    calendarDays,
  }
})


function createCalendarDays(events: Event[]) {
  console.log('Creating Calendar Days', events);
}
