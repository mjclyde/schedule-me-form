<template>
  <MainHeader />
  <div v-if="requestStatus === 'SUCCESS'" class="max-w-xl mx-auto px-8">
    <Alert v-if="slotStore.selectedSlot && slotStore.selectedCalendarDay" type="SUCCESS" title="You are signed up!">
      You have signed up for {{ eventStore.event?.type }} on {{ MonthNames[slotStore.selectedCalendarDay.month] }}
      {{ slotStore.selectedCalendarDay.date }}, {{ slotStore.selectedCalendarDay.year }} at
      {{ slotStore.selectedSlot.timeStr }}. We look forward to seeing you there!
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
  </div>
</template>

<script setup lang="ts">
import MainHeader from './components/MainHeader.vue';
import Calendar from './components/Calendar.vue';
import Slots from './components/Slots.vue';
import ContactForm from './components/ContactForm.vue';
import Button from './components/Button.vue';
import Alert from './components/Alert.vue';
import { useSlots, MonthNames } from './store/slots';
import { computed, ref, watch, watchEffect } from 'vue';
import { useEvent } from './store/event';
import { useAPI } from './store/fetch';

type SignUpRequestStatus = 'NA' | 'SUCCESS' | 'ERROR' | 'IN_PROGRESS';

const slotStore = useSlots();
const eventStore = useEvent();
const name = ref('');
const phone = ref('');
const requestStatus = ref<SignUpRequestStatus>('NA');

const canSignUp = computed(() => {
  return !!name.value && /\(\d{3}\)\s+\d{3}-\d{4}/gi.test(phone.value) && !!slotStore.selectedSlot?._id;
});

function signUp() {
  if (requestStatus.value === 'IN_PROGRESS' || !canSignUp.value) {
    return;
  }

  requestStatus.value = 'IN_PROGRESS';
  const { error, data } = useAPI(`Slots/${slotStore.selectedSlot?._id}/SignUp`).put({
    name: name.value,
    phone: phone.value,
  }).json();

  watch(() => error.value, err => {
    if (err) {
      requestStatus.value = 'ERROR';
      slotStore.clearSelection();
    }
  });

  watch(() => data.value as { success: boolean }, data => {
    if (data.success) {
      requestStatus.value = 'SUCCESS';
    } else {
      requestStatus.value = 'ERROR';
      slotStore.clearSelection();
    }
  })

}

watchEffect(() => {
  if (requestStatus.value === 'ERROR' && slotStore.selectedSlot?._id) {
    requestStatus.value = 'NA';
  }
})

</script>

<style scoped></style>
