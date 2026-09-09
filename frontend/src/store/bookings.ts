import { defineStore } from "pinia";
import { computed, ref, watch } from "vue";
import { useAPI } from "./fetch";
import { useSession } from "./session";
import { MyBooking } from "../../common/booking";
import { MonthNames } from "./availability";
import { formatTimeOfDay } from "../utils/formatTime";

/**
 * A booking with the strings the list needs, parsed once.
 *
 * Times render in the visitor's own zone — the card shows the schedule's zone
 * alongside, because the two are often not the same.
 */
export interface FormattedBooking extends MyBooking {
  start: Date;
  end: Date;
  dayStr: string;
  timeStr: string;
  isPast: boolean;
}

export const useBookings = defineStore("bookings", () => {
  const session = useSession();

  const {
    data,
    isFetching,
    execute: fetchBookings,
  } = useAPI("/MyBookings", {
    immediate: false,
    beforeFetch: session.beforeFetch,
  })
    .get()
    .json();

  const bookings = computed<FormattedBooking[]>(() =>
    ((data.value as MyBooking[] | null) || []).map(format),
  );

  const upcoming = computed(() => bookings.value.filter((b) => !b.isPast));
  const past = computed(() => bookings.value.filter((b) => b.isPast));

  watch(
    () => session.person,
    (person) => (person ? fetchBookings() : null),
  );

  /**
   * Cancels a booking, then refetches.
   *
   * The booking *is* the calendar event, so there is nothing to update
   * locally — the list is whatever Google says it is after the delete.
   */
  function cancel(booking: FormattedBooking) {
    const done = ref(false);
    const errorMsg = ref("");

    const { data: res, error } = useAPI(
      `/Bookings/${booking.id}?scheduleId=${encodeURIComponent(booking.scheduleId)}`,
      { beforeFetch: session.beforeFetch },
    ).delete();

    watch(
      () => res.value,
      () => fetchBookings().then(() => (done.value = true)),
    );
    watch(
      () => error.value,
      () =>
        (errorMsg.value =
          "We could not cancel that appointment. Please try again."),
    );

    return { done, error: errorMsg };
  }

  return {
    bookings,
    upcoming,
    past,
    isFetching,
    fetchBookings,
    cancel,
  };
});

function format(booking: MyBooking): FormattedBooking {
  const start = new Date(booking.startAt);
  const end = new Date(booking.endAt);
  return {
    ...booking,
    start,
    end,
    dayStr: `${MonthNames[start.getMonth()].substring(0, 3)}. ${start.getDate()}`,
    timeStr: formatTimeOfDay(start),
    // Past once it has finished, not once it has started: someone mid-
    // appointment should not see it drop into the history list.
    isPast: end < new Date(),
  };
}
