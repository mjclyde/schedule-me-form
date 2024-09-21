import { defineStore } from 'pinia';
import { Slot } from '../../common/slot';
import { computed, ref, watch } from 'vue';
import { useAPI } from './fetch';
import { useEvent } from './event';

export interface CalendarDay {
  dateStr: string; // YYYY-MM-DD
  year: number,
  month: number,
  date: number,
  isCurrentMonth: boolean;
  isToday: boolean;
  slots: FormattedSlot[];
}

export interface FormattedSlot extends Slot {
  timeStr: string;
}

export const useSlots = defineStore('slots', () => {

  const allSlots = ref<FormattedSlot[]>([]);
  const groupedSlots = computed(() => {
    const group: { [dateStr: string]: FormattedSlot[] } = {};
    for (const s of allSlots.value) {
      const dateStr = formatDateStr(s.startAt);
      group[dateStr] = group[dateStr] || [];
      group[dateStr].push(s);
    }
    return group;
  });

  const selectedMonth = ref(new Date().getMonth());
  const selectedYear = ref(new Date().getFullYear());
  const selectedCalendarDay = ref<CalendarDay | null>(null);
  const selectedSlot = ref<FormattedSlot | null>(null);
  const calendarDays = computed(() => createCalendarDays(groupedSlots.value, {
    month: selectedMonth.value,
    year: selectedYear.value,
  }));

  const eventStore = useEvent();

  watch(() => eventStore.event?._id, () => fetchSlots())

  watch(() => selectedCalendarDay.value, day => {
    if (!day?.slots?.length) {
      selectedSlot.value = null;
    } else {
      selectedSlot.value = day.slots[0];
    }
  })

  function fetchSlots() {
    if (!eventStore.event) { return }
    const { data } = useAPI('/AvailableSlots?eventId=' + eventStore.event._id).get().json();
    watch(() => data.value, (slots) => {
      allSlots.value = slots.map((s: Slot) => {
        const startAt = new Date(s.startAt);
        return {
          ...s,
          startAt,
          timeStr: formatTime(startAt),
        }
      })
      if (!doesMonthContainAnySlots(allSlots.value, { year: selectedYear.value, month: selectedMonth.value })) {
        const minDate = getMinDate(allSlots.value);
        if (minDate) {
          selectedYear.value = minDate?.getFullYear();
          selectedMonth.value = minDate?.getMonth();
        }
      }
    })
  }

  function clearSelection() {
    selectedCalendarDay.value = null;
    selectedSlot.value = null;
  }

  return {
    fetchSlots,
    allSlots,
    calendarDays,
    selectedMonth,
    selectedYear,
    selectedCalendarDay,
    selectedSlot,
    clearSelection,
  }
})

export const MonthNames = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"
];

function createCalendarDays(slots: { [dateStr: string]: FormattedSlot[] }, forMonth: { month: number, year: number }) {
  const { firstDayOfCalendar, firstDayOfMonth, lastDayOfCalendar, lastDayOfMonth } = getCalendarBoundaryDates(forMonth);
  const days: CalendarDay[] = [];
  const day = new Date(firstDayOfCalendar);
  const todayStr = formatDateStr(new Date());
  while (day <= lastDayOfCalendar) {
    const dateStr = formatDateStr(day);
    days.push({
      dateStr,
      year: day.getFullYear(),
      month: day.getMonth(),
      date: day.getDate(),
      isCurrentMonth: day >= firstDayOfMonth && day <= lastDayOfMonth,
      isToday: dateStr === todayStr,
      slots: slots[dateStr] || [],
    });
    day.setDate(day.getDate() + 1);
  }
  return days;
}

function doesMonthContainAnySlots(slots: FormattedSlot[], forMonth: { year: number, month: number }) {
  const { firstDayOfCalendar, lastDayOfCalendar } = getCalendarBoundaryDates(forMonth);
  for (const s of slots) {
    if (s.startAt >= firstDayOfCalendar && s.startAt <= lastDayOfCalendar) {
      return true;
    }
  }
  return false;
}

function getMinDate(slots: FormattedSlot[]) {
  let minDate: Date | undefined = undefined;
  for (const s of slots) {
    if (!minDate || s.startAt < minDate) {
      minDate = s.startAt;
    }
  }
  return minDate;
}

function getCalendarBoundaryDates(forMonth: { year: number, month: number }) {
  const firstDayOfMonth = new Date(forMonth.year, forMonth.month, 1);
  const firstDayOfCalendar = new Date(firstDayOfMonth);
  firstDayOfCalendar.setDate(firstDayOfCalendar.getDate() - firstDayOfMonth.getDay());
  const lastDayOfMonth = new Date(forMonth.year, forMonth.month + 1, 0);
  const lastDayOfCalendar = new Date(lastDayOfMonth);
  lastDayOfCalendar.setDate(lastDayOfCalendar.getDate() + (6 - lastDayOfMonth.getDay()));
  return { firstDayOfCalendar, firstDayOfMonth, lastDayOfCalendar, lastDayOfMonth };
}

function formatDateStr(day: Date) {
  return `${day.getFullYear()}-${day.getMonth() + 1}-${day.getDate()}`;
}

function formatTime(date?: Date) {
  if (!date) { return '' }
  return date.toLocaleTimeString().replace(/\:\d{2}\s/, ' ');
}
