import { defineStore } from "pinia";
import { computed, ref, watch } from "vue";
import { useAPI } from "./fetch";
import { useSchedule } from "./schedule";
import { AvailabilityResponse, AvailableSlot } from "../../common/schedule";

export interface Slot extends AvailableSlot {
  /** Parsed once, in the visitor's own zone — the calendar grid is local. */
  start: Date;
  timeStr: string;
}

export interface CalendarDay {
  dateStr: string;
  year: number;
  month: number;
  date: number;
  isCurrentMonth: boolean;
  isToday: boolean;
  slots: Slot[];
}

export const MonthNames = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export const useAvailability = defineStore("availability", () => {
  const scheduleStore = useSchedule();

  const selectedMonth = ref(new Date().getMonth());
  const selectedYear = ref(new Date().getFullYear());
  const selectedCalendarDay = ref<CalendarDay | null>(null);
  const selectedSlot = ref<Slot | null>(null);

  /** The calendar grid's own bounds, which is exactly what we need slots for. */
  const visibleRange = computed(() =>
    getCalendarBoundaryDates({
      year: selectedYear.value,
      month: selectedMonth.value,
    }),
  );

  const url = computed(() => {
    const id = scheduleStore.schedule?._id;
    if (!id) {
      return "/";
    }
    const { firstDayOfCalendar, lastDayOfCalendar } = visibleRange.value;
    const from = toDateParam(firstDayOfCalendar);
    // The grid's last day is inclusive; the API range end is not.
    const to = toDateParam(addDays(lastDayOfCalendar, 1));
    return `/Schedules/${id}/Availability?from=${from}&to=${to}`;
  });

  // Re-fetches whenever the month or the schedule changes.
  const { data, isFetching } = useAPI(url, { refetch: true }).get().json();
  const response = computed(() => data.value as AvailabilityResponse | null);

  const slots = computed<Slot[]>(() =>
    (response.value?.slots || []).map((s) => {
      const start = new Date(s.startAt);
      return { ...s, start, timeStr: formatTime(start) };
    }),
  );

  const groupedSlots = computed(() => {
    const group: { [dateStr: string]: Slot[] } = {};
    for (const s of slots.value) {
      const key = formatDateStr(s.start);
      (group[key] ||= []).push(s);
    }
    return group;
  });

  const calendarDays = computed(() =>
    createCalendarDays(groupedSlots.value, visibleRange.value),
  );

  /**
   * Month navigation bounds, from the schedule's own window. Without these a
   * several-month campaign is a lot of clicking through empty months.
   */
  const firstBookableMonth = computed(() =>
    toMonthIndex(pickLater(scheduleStore.schedule?.bookableFrom, new Date())),
  );
  const lastBookableMonth = computed(() => {
    const to = scheduleStore.schedule?.bookableTo;
    return to ? toMonthIndex(new Date(to)) : null;
  });
  const currentMonthIndex = computed(
    () => selectedYear.value * 12 + selectedMonth.value,
  );
  const canGoBack = computed(
    () => currentMonthIndex.value > firstBookableMonth.value,
  );
  const canGoForward = computed(
    () =>
      lastBookableMonth.value === null ||
      currentMonthIndex.value < lastBookableMonth.value,
  );

  // Open on the month the schedule actually starts in, not necessarily today's.
  watch(
    () => scheduleStore.schedule?.bookableFrom,
    (from) => {
      if (!from) {
        return;
      }
      const opensAt = pickLater(from, new Date());
      selectedYear.value = opensAt.getFullYear();
      selectedMonth.value = opensAt.getMonth();
    },
    { immediate: true },
  );

  // Keep the selected day pointing at the refreshed instance after a fetch,
  // and drop a selection whose slots have gone.
  watch(
    () => calendarDays.value,
    (days) => {
      const selected = selectedCalendarDay.value;
      if (!selected) {
        return;
      }
      const match = days.find((d) => d.dateStr === selected.dateStr);
      selectedCalendarDay.value = match?.slots.length ? match : null;
    },
  );

  watch(
    () => selectedCalendarDay.value,
    (day) => (selectedSlot.value = day?.slots?.[0] ?? null),
  );

  function nextMonth() {
    if (!canGoForward.value) {
      return;
    }
    shiftMonth(1);
  }

  function previousMonth() {
    if (!canGoBack.value) {
      return;
    }
    shiftMonth(-1);
  }

  function shiftMonth(by: number) {
    const date = new Date(selectedYear.value, selectedMonth.value + by, 1);
    selectedYear.value = date.getFullYear();
    selectedMonth.value = date.getMonth();
    clearSelection();
  }

  function clearSelection() {
    selectedCalendarDay.value = null;
    selectedSlot.value = null;
  }

  return {
    slots,
    calendarDays,
    isFetching,
    timeZone: computed(() => response.value?.timeZone || ""),
    state: computed(() => response.value?.state ?? scheduleStore.schedule?.state),
    selectedMonth,
    selectedYear,
    selectedCalendarDay,
    selectedSlot,
    canGoBack,
    canGoForward,
    nextMonth,
    previousMonth,
    clearSelection,
  };
});

function createCalendarDays(
  slots: { [dateStr: string]: Slot[] },
  bounds: ReturnType<typeof getCalendarBoundaryDates>,
) {
  const days: CalendarDay[] = [];
  const day = new Date(bounds.firstDayOfCalendar);
  const todayStr = formatDateStr(new Date());

  while (day <= bounds.lastDayOfCalendar) {
    const dateStr = formatDateStr(day);
    days.push({
      dateStr,
      year: day.getFullYear(),
      month: day.getMonth(),
      date: day.getDate(),
      isCurrentMonth:
        day >= bounds.firstDayOfMonth && day <= bounds.lastDayOfMonth,
      isToday: dateStr === todayStr,
      slots: slots[dateStr] || [],
    });
    day.setDate(day.getDate() + 1);
  }
  return days;
}

function getCalendarBoundaryDates(forMonth: { year: number; month: number }) {
  const firstDayOfMonth = new Date(forMonth.year, forMonth.month, 1);
  const firstDayOfCalendar = addDays(firstDayOfMonth, -firstDayOfMonth.getDay());
  const lastDayOfMonth = new Date(forMonth.year, forMonth.month + 1, 0);
  const lastDayOfCalendar = addDays(lastDayOfMonth, 6 - lastDayOfMonth.getDay());
  return {
    firstDayOfCalendar,
    firstDayOfMonth,
    lastDayOfCalendar,
    lastDayOfMonth,
  };
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function pickLater(iso: string | undefined, fallback: Date) {
  const date = iso ? new Date(iso) : fallback;
  return date > fallback ? date : fallback;
}

function toMonthIndex(date: Date) {
  return date.getFullYear() * 12 + date.getMonth();
}

/** Local calendar date, not an instant — `toISOString()` would shift the day. */
function toDateParam(date: Date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function formatDateStr(day: Date) {
  return `${day.getFullYear()}-${day.getMonth() + 1}-${day.getDate()}`;
}

function formatTime(date: Date) {
  return date
    .toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
    .replace(/\:\d{2}\s/, " ");
}

function pad(value: number) {
  return String(value).padStart(2, "0");
}
