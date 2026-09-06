<template>
  <div class="max-w-xl mx-auto px-8 my-8" v-if="!schedule.scheduleId">
    <Alert type="ERROR" title="No schedule selected">
      This link is missing a schedule. Please use the link you were given.
    </Alert>
  </div>

  <div class="max-w-xl mx-auto px-8 my-8" v-else-if="booking">
    <Alert type="SUCCESS" title="You are booked!">
      You are scheduled for {{ schedule.schedule?.type }} on
      {{ bookedOn }}. We look forward to seeing you there!
      <div v-if="booking.invited" class="mt-3 text-sm">
        A calendar invite is on its way to {{ email }}.
      </div>
    </Alert>
  </div>

  <div class="max-w-xl mx-auto px-8 my-8" v-else-if="state === 'before'">
    <Alert type="INFO" :title="`Sign-ups open ${formatDay(schedule.schedule?.startDate)}`">
      {{ schedule.schedule?.description }}
      Check back on {{ formatDay(schedule.schedule?.startDate) }} to book a time.
    </Alert>
  </div>

  <div class="max-w-xl mx-auto px-8 my-8" v-else-if="state === 'closed'">
    <Alert type="INFO" title="Sign-ups are closed">
      {{ schedule.schedule?.name }} stopped accepting bookings on
      {{ formatDay(schedule.schedule?.endDate) }}.
    </Alert>
  </div>

  <div v-else class="max-w-xl mx-auto px-8 mb-20">
    <Calendar />

    <div v-if="!availability.isFetching && !availability.slots.length"
      class="mt-6 text-center text-gray-400 italic">
      No times are available this month. Try another month.
    </div>

    <Slots />
    <div v-if="availability.timeZone" class="mt-2 text-center text-xs text-gray-400">
      Times shown in your local time. Appointments are in {{ availability.timeZone }}.
    </div>

    <div class="text-center mt-8 mb-4 text-gray-500 font-bold text-sm">Enter Your Info</div>
    <ContactForm v-model:name="name" v-model:phone="phone" v-model:email="email" :show-email="true"
      :email-required="schedule.schedule?.requireEmail" />

    <Button @click="book" :disabled="!canBook" class="w-full mt-6 relative flex justify-center items-center">
      Book
      <span v-if="availability.selectedSlot && availability.selectedCalendarDay" class="ml-2">
        {{ MonthNames[availability.selectedCalendarDay.month].substring(0, 3) }}.
        {{ availability.selectedCalendarDay.date }} at {{ availability.selectedSlot.timeStr }}
      </span>
      <div v-if="requestStatus === 'IN_PROGRESS'"
        class="absolute animate-spin right-3 w-6 h-6 border-4 border-sky-700 border-t-white rounded-full"></div>
    </Button>

    <Alert v-if="requestStatus === 'ERROR'" class="mt-6" type="ERROR" title="Oops">
      {{ errorMessage }}
    </Alert>

    <div class="flex justify-center">
      <CheckBox v-model:is-checked="remindMe" class="mt-4" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import Calendar from '../components/Calendar.vue';
import Slots from '../components/Slots.vue';
import ContactForm from '../components/ContactForm.vue';
import Button from '../components/Button.vue';
import Alert from '../components/Alert.vue';
import CheckBox from '../components/CheckBox.vue';
import { useAvailability, MonthNames } from '../store/availability';
import { useSchedule } from '../store/schedule';
import { useAPI } from '../store/fetch';
import { Booking } from '../../common/booking';

type RequestStatus = 'NA' | 'ERROR' | 'IN_PROGRESS';

const schedule = useSchedule();
const availability = useAvailability();

const name = ref('');
const phone = ref('');
const email = ref('');
const remindMe = ref(true);
const requestStatus = ref<RequestStatus>('NA');
const errorMessage = ref('');
const booking = ref<Booking | null>(null);

const state = computed(() => availability.state);

const canBook = computed(() =>
  !!name.value &&
  /\(\d{3}\)\s+\d{3}-\d{4}/.test(phone.value) &&
  (!schedule.schedule?.requireEmail || !!email.value) &&
  !!availability.selectedSlot,
);

const bookedOn = computed(() => {
  if (!booking.value) {
    return '';
  }
  return new Date(booking.value.startAt).toLocaleString([], {
    dateStyle: 'long',
    timeStyle: 'short',
  });
});

function book() {
  if (requestStatus.value === 'IN_PROGRESS' || !canBook.value) {
    return;
  }
  requestStatus.value = 'IN_PROGRESS';

  const { data, error, statusCode } = useAPI(
    `/Schedules/${schedule.schedule?._id}/Bookings`,
  ).post({
    startAt: availability.selectedSlot?.startAt,
    name: name.value,
    phone: phone.value,
    email: email.value || undefined,
    remindMe: remindMe.value,
  }).json();

  watch(() => data.value, (res) => {
    if (!res) {
      return;
    }
    booking.value = res as Booking;
    requestStatus.value = 'NA';
  });

  watch(() => error.value, (err) => {
    if (!err) {
      return;
    }
    // 409 is the common one: somebody took the slot between the page loading
    // and the click. Clear the selection so they pick again from fresh times.
    errorMessage.value = statusCode.value === 409
      ? 'It looks like the time you selected was just taken. Please choose another time and try again.'
      : 'Something went wrong booking that time. Please try again.';
    requestStatus.value = 'ERROR';
    availability.clearSelection();
  });
}

function formatDay(date?: string) {
  if (!date) {
    return '';
  }
  // A bare "YYYY-MM-DD" parses as UTC midnight, which renders as the previous
  // day west of Greenwich. Build it as a local date instead.
  const [year, month, day] = date.split('-').map(Number);
  return new Date(year, month - 1, day).toLocaleDateString([], {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}

watch(() => availability.selectedSlot, (slot) => {
  if (slot && requestStatus.value === 'ERROR') {
    requestStatus.value = 'NA';
  }
});
</script>
