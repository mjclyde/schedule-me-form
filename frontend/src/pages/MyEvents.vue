<template>
  <div class="max-w-xl mx-auto px-8">
    <div v-if="!session.person && otpRequestStatus !== 'SUCCESS' && otpRequestStatus !== 'ERROR'">
      <div v-if="!schedule.scheduleId" class="my-8">
        <Alert type="ERROR" title="No schedule selected">
          This link is missing a schedule. Please use the link you were given.
        </Alert>
      </div>
      <template v-else>
        <div class="text-gray-400 italic text-center mt-8 mb-3">
          To manage your appointments, enter your phone number below.
        </div>
        <ContactForm :phone-only="true" v-model:phone="phone" />
        <Button :disabled="!canSubmit" @click="findMyBookings"
          class="w-full mt-6 relative flex justify-center items-center">
          Find My Appointments
          <div v-if="otpRequestStatus === 'IN_PROGRESS'"
            class="absolute animate-spin right-3 w-6 h-6 border-4 border-sky-700 border-t-white rounded-full"></div>
        </Button>
        <div class="text-gray-400 italic text-center mt-8 mb-3">
          You will receive a text message with access to your appointments.
        </div>
      </template>
    </div>

    <div v-if="otpRequestStatus === 'SUCCESS' || otpRequestStatus === 'ERROR'" class="max-w-xl mx-auto my-8">
      <Alert v-if="otpRequestStatus === 'SUCCESS'" type="SUCCESS" title="Check Your Messages">
        If that number has an appointment with us, we have sent it a link.
        Click that link to view your appointments.
      </Alert>
      <Alert v-if="otpRequestStatus === 'ERROR'" class="mt-6" type="ERROR" title="Oops">
        It looks like we had a problem sending a link to the phone number you provided.
        Please try again later.
      </Alert>
    </div>

    <div class="mt-8" v-if="session.person?._id">
      <div class="list-label">Upcoming Appointments</div>
      <div v-if="bookings.isFetching && !bookings.bookings.length" class="py-4 text-gray-400 italic">
        Loading your appointments&hellip;
      </div>
      <div v-else-if="!bookings.upcoming.length" class="py-4 text-gray-400 italic">
        You have no upcoming appointments yet.
        <RouterLink class="underline" :to="{ name: 'booking', query: bookingQuery }">
          Click here to book one.
        </RouterLink>
      </div>
      <BookingCard v-for="b of bookings.upcoming" :booking="b" :key="b.id" @cancel="confirmCancel"
        @click="offerCalendarEvent" />
      <div v-if="bookings.upcoming.length" class="mb-4 mt-6 text-sm font-medium text-gray-400 italic text-center">
        <ArrowUpIcon class="h-5 inline-block" />
        Tap an appointment to add it to your Calendar
      </div>
      <div v-if="sharedTimeZone" class="mb-10 text-center text-xs text-gray-400">
        Times shown in your local time. Appointments are in {{ sharedTimeZone }}.
      </div>

      <div v-if="bookings.past.length" class="list-label">Past Appointments</div>
      <BookingCard v-for="b of bookings.past" :booking="b" :key="b.id" :is-past="true" />

      <Alert v-if="cancelError" class="my-6" type="ERROR" title="Oops">{{ cancelError }}</Alert>
    </div>
  </div>

  <ModalAlert v-model:open="showingCancelAlert" title="Are You Sure?" primary-button-text="Cancel Appointment"
    secondary-button-text="Keep It" :working="requestStatus === 'IN_PROGRESS'" @submit="cancelConfirmed">
    <template v-slot:icon>
      <ExclamationTriangleIcon class="h-7 text-red-600" />
    </template>
    You are about to cancel your appointment for
    <span class="font-bold">{{ selected?.scheduleType }}</span> on
    <span class="font-bold">{{ selected?.dayStr }}</span> at
    <span class="font-bold">{{ selected?.timeStr }}</span>
    ({{ selected?.durationMins }} minutes).
  </ModalAlert>

  <ModalAlert v-model:open="showingCalendarAlert" title="Apple or Google Calendar"
    primary-button-text="Yes, Add To Calendar" secondary-button-text="Cancel"
    :working="requestStatus === 'IN_PROGRESS'" @submit="downloadCalendarEvent" :color="'sky'">
    <template v-slot:icon>
      <CalendarDaysIcon class="h-7 text-sky-600" />
    </template>
    Would you like to add {{ selected?.scheduleType }} on
    <span class="font-bold">{{ selected?.dayStr }}</span> at
    <span class="font-bold">{{ selected?.timeStr }}</span>
    ({{ selected?.durationMins }} minutes) to your Google or Apple Calendar?
  </ModalAlert>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import ContactForm from '../components/ContactForm.vue';
import Button from '../components/Button.vue';
import BookingCard from '../components/BookingCard.vue';
import ModalAlert from '../components/ModalAlert.vue';
import Alert from '../components/Alert.vue';
import { useSession } from '../store/session';
import { useSchedule } from '../store/schedule';
import { FormattedBooking, useBookings } from '../store/bookings';
import { useAPI } from '../store/fetch';
import { ArrowUpIcon, ExclamationTriangleIcon, CalendarDaysIcon } from '@heroicons/vue/20/solid'

type RequestStatus = 'NA' | 'SUCCESS' | 'ERROR' | 'IN_PROGRESS';

const session = useSession();
const schedule = useSchedule();
const bookings = useBookings();

const phone = ref('');
const canSubmit = computed(() => /\(\d{3}\)\s+\d{3}-\d{4}/.test(phone.value));
const requestStatus = ref<RequestStatus>('NA');
const otpRequestStatus = ref<RequestStatus>('NA');
const cancelError = ref('');

const selected = ref<FormattedBooking | null>(null);
const showingCancelAlert = ref(false);
const showingCalendarAlert = ref(false);

const bookingQuery = computed(() =>
  schedule.scheduleId ? { scheduleId: schedule.scheduleId } : {},
);

/**
 * The zone to caption the list with, or '' when there isn't one.
 *
 * /MyBookings is person-scoped across every schedule, so two bookings can sit
 * in different zones. Naming one of them would be wrong for the others.
 */
const sharedTimeZone = computed(() => {
  const zones = new Set(bookings.upcoming.map((b) => b.timeZone));
  return zones.size === 1 ? [...zones][0] : '';
});

if (session.person?._id) {
  bookings.fetchBookings();
}

function offerCalendarEvent(booking: FormattedBooking) {
  selected.value = booking;
  showingCalendarAlert.value = true;
  showingCancelAlert.value = false;
}

function confirmCancel(booking: FormattedBooking) {
  selected.value = booking;
  showingCancelAlert.value = true;
  showingCalendarAlert.value = false;
}

function cancelConfirmed() {
  if (!selected.value || !showingCancelAlert.value) {
    return;
  }
  cancelError.value = '';
  requestStatus.value = 'IN_PROGRESS';

  const { done, error } = bookings.cancel(selected.value);
  watch(() => done.value, (isDone) => {
    if (isDone) {
      requestStatus.value = 'SUCCESS';
      showingCancelAlert.value = false;
    }
  });
  watch(() => error.value, (message) => {
    if (message) {
      cancelError.value = message;
      requestStatus.value = 'ERROR';
      showingCancelAlert.value = false;
    }
  });
}

function downloadCalendarEvent() {
  const booking = selected.value;
  if (!booking) {
    return;
  }
  // The .ics endpoint is OTP-authenticated, so this needs the session header
  // rather than being a plain link.
  const { data } = useAPI(
    `/Bookings/${booking.id}/CalendarEvent?scheduleId=${encodeURIComponent(booking.scheduleId)}`,
    { beforeFetch: session.beforeFetch },
  ).get().blob();

  watch(() => data.value, (file) => {
    if (!file) {
      return;
    }
    const link = document.createElement('a');
    link.href = window.URL.createObjectURL(file as Blob);
    link.setAttribute('download', booking.scheduleType.replace(/\s+/g, '-') + '.ics');
    document.body.appendChild(link);
    link.click();
    link.remove();
    showingCalendarAlert.value = false;
  });
}

function findMyBookings() {
  if (!schedule.scheduleId || otpRequestStatus.value === 'IN_PROGRESS') {
    return;
  }
  otpRequestStatus.value = 'IN_PROGRESS';

  const { data, error } = useAPI(
    `/Schedules/${schedule.scheduleId}/CreateOTP`,
  ).post({ phone: phone.value });

  // The API answers the same whether or not the number is known, so this
  // never reveals who is a customer.
  watch(() => data.value, () => otpRequestStatus.value = 'SUCCESS');
  watch(() => error.value, () => otpRequestStatus.value = 'ERROR');
}
</script>

<style>
.list-label {
  @apply text-gray-400 text-sm font-semibold pt-4;
}
</style>
