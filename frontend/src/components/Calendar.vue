<template>
  <div
    class="mt-10 text-center lg:col-start-8 lg:col-end-13 lg:row-start-1 lg:mt-9 xl:col-start-9"
  >
    <div class="flex items-center text-gray-900">
      <button
        @click="previousMonth()"
        type="button"
        class="-m-1.5 flex flex-none items-center justify-center p-1.5 text-gray-400 hover:text-gray-500"
      >
        <span class="sr-only">Previous month</span>
        <ChevronLeftIcon class="h-7 w-7" aria-hidden="true" />
      </button>
      <div class="flex-auto text-sm font-bold text-gray-500">{{ MonthNames[store.selectedMonth] }}</div>
      <button
        @click="nextMonth()"
        type="button"
        class="-m-1.5 flex flex-none items-center justify-center p-1.5 text-gray-400 hover:text-gray-500"
      >
        <span class="sr-only">Next month</span>
        <ChevronRightIcon class="h-7 w-7" aria-hidden="true" />
      </button>
    </div>
    <div class="mt-6 grid grid-cols-7 text-xs leading-6 text-gray-500">
      <div>S</div>
      <div>M</div>
      <div>T</div>
      <div>W</div>
      <div>T</div>
      <div>F</div>
      <div>S</div>
    </div>
    <div
      class="isolate mt-2 grid grid-cols-7 gap-px rounded-lg bg-gray-200 text-sm shadow ring-1 ring-gray-200"
    >
      <button
        v-for="(day, dayIdx) in store.calendarDays"
        :key="day.dateStr"
        @click="selectDate(day)"
        type="button"
        :class="[
          'py-4 text-gray-300 hover:z-10 cursor-default',
          !day.slots.length ? 'bg-gray-50' : '',
          !day.isCurrentMonth ? 'bg-gray-100' : '',
          dayIdx === 0 ? 'rounded-tl-lg' : '',
          dayIdx === 6 ? 'rounded-tr-lg' : '',
          dayIdx === store.calendarDays.length - 7 ? 'rounded-bl-lg' : '',
          dayIdx === store.calendarDays.length - 1 ? 'rounded-br-lg' : '',
          day.isToday ? 'font-black' : '',
          day.slots.length && day.dateStr !== store.selectedCalendarDay?.dateStr ? 'bg-white text-gray-900 hover:bg-sky-100 hover:text-sky-900 hover:z-10 cursor-pointer' : '',
          day.dateStr === store.selectedCalendarDay?.dateStr ? 'bg-sky-500 text-white font-black hover:bg-sky-400 hover:text-white' : '',
        ]"
      >
        {{ day.date }}
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ChevronLeftIcon, ChevronRightIcon } from "@heroicons/vue/20/solid";
import { CalendarDay, useSlots, MonthNames } from "../store/slots";

const store = useSlots();

function nextMonth() {
  const date = new Date(store.selectedYear, store.selectedMonth, 1);
  date.setMonth(date.getMonth() + 1);
  store.selectedYear = date.getFullYear();
  store.selectedMonth = date.getMonth();
}

function previousMonth() {
  const date = new Date(store.selectedYear, store.selectedMonth, 1);
  date.setMonth(date.getMonth() - 1);
  store.selectedYear = date.getFullYear();
  store.selectedMonth = date.getMonth();
}

function selectDate(day: CalendarDay) {
  if (!day.slots?.length) {
    return;
  }
  store.selectedCalendarDay = day
}

</script>
