<template>
  <div class="max-w-xl mx-auto px-8">
    <div v-if="!session.person && otpRequestStatus !== 'SUCCESS' && otpRequestStatus !== 'ERROR'">
      <div class="text-gray-400 italic text-center mt-8 mb-3">
        To manage your events, enter your phone number below.
      </div>
      <ContactForm :phone-only="true" v-model:phone="phone" />
      <Button :disabled="!canSubmit" @click="findMyEvents"
        class="w-full mt-6 relative flex justify-center items-center">
        Find My Events
        <div v-if="otpRequestStatus === 'IN_PROGRESS'"
          class="absolute animate-spin right-3 w-6 h-6 border-4 border-sky-700 border-t-white rounded-full"></div>
      </Button>
      <div class="text-gray-400 italic text-center mt-8 mb-3">
        You will receive a text message with access to your events.
      </div>
    </div>
    <div v-if="otpRequestStatus === 'SUCCESS' || otpRequestStatus === 'ERROR'" class="max-w-xl mx-auto my-8">
      <Alert v-if="otpRequestStatus === 'SUCCESS'" type="SUCCESS" title="Check Your Messages">
        We have sent a link to the phone number you provided. Click that link to view your events.
      </Alert>
      <Alert v-if="otpRequestStatus === 'ERROR'" class="mt-6 " type="ERROR" title="Oops">
        It looks like we had a problem sending a link to the phone number your provided. Please try again later.
      </Alert>
    </div>
    <div class="mt-8" v-if="session.person?._id">
      <div class="list-label">
        Upcoming Events
      </div>
      <div v-if="!futureSlots.length" class="py-4 text-gray-400 italic">
        You have no upcoming events yet.
        <RouterLink class="underline" to="/">Click here to Sign Up.</RouterLink>
      </div>
      <MySlot v-for="s of futureSlots" :slot="s" :key="s._id" @delete="deleteSlot" @click="slotClicked" />
      <div v-if="futureSlots.length" class="mb-10 mt-6 text-sm font-medium text-gray-400 italic text-center">
        <ArrowUpIcon class="h-5 inline-block" />
        Tap an event to add it to your Calendar
      </div>
      <div v-if="pastSlots.length" class="list-label">Past Events</div>
      <MySlot v-for="s of pastSlots" :slot="s" :key="s._id" :is-past="true" />
    </div>
  </div>
  <ModalAlert v-model:open="showingDeleteAlert" title="Are You Sure?" primary-button-text="Delete Event"
    secondary-button-text="Cancel" :working="requestStatus === 'IN_PROGRESS'" @submit="deleteConfirmed">
    <template v-slot:icon>
      <ExclamationTriangleIcon class="h-7 text-red-600" />
    </template>
    You are about to delete your appointment for {{ events.event.type }} ({{ events.event.name }}) on
    <span class="font-bold">
      {{ selectedSlotMonth }} {{ selectedSlot?.date }}, {{ selectedSlot?.year }}
    </span>
    at
    <span class="font-bold">{{ selectedSlot?.timeStr }}</span>
    ({{ selectedSlot?.durationMins }} minutes).
  </ModalAlert>
  <ModalAlert v-model:open="showCalendarEventAlert" title="Apple or Google Calendar"
    primary-button-text="Yes, Add To Calendar" secondary-button-text="Cancel" :working="requestStatus === 'IN_PROGRESS'"
    @submit="createCalenderEvent" :color="'sky'">
    <template v-slot:icon>
      <CalendarDaysIcon class="h-7 text-sky-600" />
    </template>
    Would you like to add {{ events.event.type }} on
    <span class="font-bold">
      {{ selectedSlotMonth }} {{ selectedSlot?.date }}, {{ selectedSlot?.year }}
    </span>
    at
    <span class="font-bold">{{ selectedSlot?.timeStr }}</span>
    ({{ selectedSlot?.durationMins }} minutes) to your Google or Apple Calendar?
  </ModalAlert>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import ContactForm from '../components/ContactForm.vue';
import Button from '../components/Button.vue';
import MySlot from '../components/MySlot.vue';
import { useSession } from '../store/session';
import { FormattedSlot, MonthNames, useSlots } from '../store/slots';
import { Slot } from '../../common/slot';
import ModalAlert from '../components/ModalAlert.vue';
import { useEvent } from '../store/event';
import { useAPI } from '../store/fetch';
import Alert from '../components/Alert.vue';
import { ArrowUpIcon, ExclamationTriangleIcon, CalendarDaysIcon } from '@heroicons/vue/20/solid'

type RequestStatus = 'NA' | 'SUCCESS' | 'ERROR' | 'IN_PROGRESS';

const session = useSession();
const events = useEvent();
const slots = useSlots();
const phone = ref('');
const canSubmit = computed(() => /\(\d{3}\)\s+\d{3}-\d{4}/gi.test(phone.value));
const requestStatus = ref<RequestStatus>('NA');
const otpRequestStatus = ref<RequestStatus>('NA');

const pastSlots = computed(() => slots.mySlots.filter(s => isInThePast(s)));
const futureSlots = computed(() => slots.mySlots.filter(s => !isInThePast(s)));
const selectedSlot = ref<null | FormattedSlot>(null);
const showingDeleteAlert = ref(false);
const showCalendarEventAlert = ref(false);
const selectedSlotMonth = computed(() => selectedSlot.value ? MonthNames[selectedSlot.value.month] : '')

if (session.person?._id) {
  slots.fetchMySlots();
}

function slotClicked(slot: FormattedSlot) {
  selectedSlot.value = slot;
  showCalendarEventAlert.value = true;
  showingDeleteAlert.value = false;
}

function deleteSlot(slot: FormattedSlot) {
  selectedSlot.value = slot;
  showingDeleteAlert.value = true;
  showCalendarEventAlert.value = false;
}

function deleteConfirmed() {
  if (!selectedSlot.value || !showingDeleteAlert.value) {
    return;
  }
  requestStatus.value = 'IN_PROGRESS';
  const { done } = slots.deletePersonFromSlot(selectedSlot.value._id, session.person._id);
  watch(() => done.value, (isDone) => {
    if (isDone) {
      requestStatus.value = 'SUCCESS';
      showingDeleteAlert.value = false;
    }
  })
}

function createCalenderEvent() {
  const { data } = useAPI('/Slots/' + selectedSlot.value?._id + '/CalendarEvent').blob();
  watch(() => data.value, res => {
    const link = document.createElement('a');
    link.href = window.URL.createObjectURL(res as Blob);
    link.setAttribute('download', events.event.type.replace(/\s/gi, '-') + '.ics');
    document.body.appendChild(link);
    link.click();
    showCalendarEventAlert.value = false;
  })
}

function findMyEvents() {
  if (!events.event._id || otpRequestStatus.value === 'IN_PROGRESS') {
    return;
  }
  otpRequestStatus.value = 'IN_PROGRESS';
  const { data, error } = useAPI(`/Events/${events.event._id}/CreateOTP`).post({ phone: phone.value })
  watch(() => data.value, () => otpRequestStatus.value = 'SUCCESS');
  watch(() => error.value, () => otpRequestStatus.value = 'ERROR');
}

function isInThePast(slot: Slot) {
  const endsAt = new Date(slot.startAt);
  endsAt.setMinutes(endsAt.getMinutes() + (slot.durationMins || 0));
  return endsAt < new Date()
}

</script>

<style>
.list-label {
  @apply text-gray-400 text-sm font-semibold pt-4;
}
</style>
