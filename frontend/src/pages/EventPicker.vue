<template>
  <div v-if="requestStatus === 'SUCCESS'" class="max-w-xl mx-auto px-8 my-8">
    <Alert v-if="signedUpForSlot" type="SUCCESS" title="You are signed up!">
      You have signed up for {{ eventStore.event?.type }} on {{ MonthNames[signedUpForSlot.month] }}
      {{ signedUpForSlot.date }}, {{ signedUpForSlot.year }} at
      {{ signedUpForSlot.timeStr }}. We look forward to seeing you there!
      <a class="mt-4 flex items-center justify-center text-lg bg-green-600 text-white p-3 px-5 rounded-md hover:bg-green-500 active:bg-green-700" :href="calendarEventUrl">
        <PlusCircleIcon class="h-7 w-7 mr-3" aria-hidden="true" />
        Add event to your Calendar
      </a>
    </Alert>
  </div>
  <div v-else class="max-w-xl mx-auto px-8 mb-20">
    <Calendar />
    <Slots />
    <div class="text-center mt-8 mb-4 text-gray-500 font-bold text-sm">Enter Your Info</div>
    <ContactForm v-model:name="name" v-model:phone="phone" />
    <Button @click="signUp" :disabled="!canSignUp" class="w-full mt-6 relative flex justify-center items-center">
      Sign Up <span v-if="slotStore.selectedSlot && slotStore.selectedCalendarDay" class="ml-2">{{
        MonthNames[slotStore.selectedCalendarDay.month].substring(0, 3) }}. {{ slotStore.selectedCalendarDay.date }} at
        {{ slotStore.selectedSlot.timeStr }}</span>
      <div v-if="requestStatus === 'IN_PROGRESS'"
        class="absolute animate-spin right-3 w-6 h-6 border-4 border-sky-700 border-t-white rounded-full"></div>
    </Button>
    <Alert v-if="requestStatus === 'ERROR'" class="mt-6 " type="ERROR" title="Oops">
      It looks like the time you've selected is no longer available. Please select another
      date and time, then try again.
    </Alert>
    <div class="flex justify-center">
      <CheckBox v-model:is-checked="remindMe" class="mt-4" />
    </div>
  </div>
</template>

<script setup lang="ts">
import Calendar from '../components/Calendar.vue';
import Slots from '../components/Slots.vue';
import ContactForm from '../components/ContactForm.vue';
import Button from '../components/Button.vue';
import Alert from '../components/Alert.vue';
import CheckBox from '../components/CheckBox.vue';
import { useSlots, MonthNames, FormattedSlot } from '../store/slots';
import { computed, ref, watch, watchEffect } from 'vue';
import { useEvent } from '../store/event';
import { useAPI } from '../store/fetch';
import { PlusCircleIcon } from '@heroicons/vue/20/solid'

type SignUpRequestStatus = 'NA' | 'SUCCESS' | 'ERROR' | 'IN_PROGRESS';

const slotStore = useSlots();
const eventStore = useEvent();
const name = ref('');
const phone = ref('');
const remindMe = ref(true);
const requestStatus = ref<SignUpRequestStatus>('NA');
const signedUpForSlot = ref<FormattedSlot | null>(null);

const canSignUp = computed(() => {
  return !!name.value && /\(\d{3}\)\s+\d{3}-\d{4}/gi.test(phone.value) && !!slotStore.selectedSlot?._id;
});

const calendarEventUrl = computed(() => {
  return `${import.meta.env.VITE_API_HOST}/Slots/${signedUpForSlot.value?._id}/CalendarEvent`
})

function signUp() {
  if (requestStatus.value === 'IN_PROGRESS' || !canSignUp.value) {
    return;
  }

  requestStatus.value = 'IN_PROGRESS';
  const { error, data } = useAPI(`Slots/${slotStore.selectedSlot?._id}/SignUp`).put({
    name: name.value,
    phone: phone.value,
    remindMe: remindMe.value,
  }).json();

  watch(() => error.value, err => {
    if (err) {
      requestStatus.value = 'ERROR';
      slotStore.clearSelection();
    }
  });

  watch(() => data.value as { success: boolean }, data => {
    signedUpForSlot.value = slotStore.selectedSlot;
    if (data.success) {
      requestStatus.value = 'SUCCESS';
    } else {
      requestStatus.value = 'ERROR';
      slotStore.clearSelection();
    }
    slotStore.fetchSlots();
  })

}

watchEffect(() => {
  if (requestStatus.value === 'ERROR' && slotStore.selectedSlot?._id) {
    requestStatus.value = 'NA';
  }
})

</script>

<style scoped></style>
