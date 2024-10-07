<template>
  <div class="max-w-xl mx-auto px-8">
    <div v-if="!session.person">
      <div class="text-gray-400 italic text-center mt-8 mb-3">
        To manage your events, enter your phone number below
      </div>
      <ContactForm :phone-only="true" v-model:phone="phone" />
      <Button @click="submit" :disabled="!canSubmit" class="w-full mt-6 relative flex justify-center items-center">
        Find My Events
        <div v-if="requestStatus === 'IN_PROGRESS'"
          class="absolute animate-spin right-3 w-6 h-6 border-4 border-sky-700 border-t-white rounded-full"></div>
      </Button>
    </div>
    <div class="mt-8">
      <div class="list-label">Upcoming Events</div>
      <MySlot v-for="s of futureSlots" :slot="s" :key="s._id" />
      <div class="list-label">Past Events</div>
      <MySlot v-for="s of pastSlots" :slot="s" :key="s._id" :is-past="true" />
    </div>
  </div>
  <ModalAlert/>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import ContactForm from '../components/ContactForm.vue';
import Button from '../components/Button.vue';
import MySlot from '../components/MySlot.vue';
import { useSession } from '../store/session';
import { useSlots } from '../store/slots';
import { Slot } from '../../common/slot';
import ModalAlert from '../components/ModalAlert.vue';

type SignUpRequestStatus = 'NA' | 'SUCCESS' | 'ERROR' | 'IN_PROGRESS';

const session = useSession();
const slots = useSlots();
const phone = ref('');
const canSubmit = computed(() => /\(\d{3}\)\s+\d{3}-\d{4}/gi.test(phone.value));
const requestStatus = ref<SignUpRequestStatus>('NA');

const pastSlots = computed(() => slots.mySlots.filter(s => isInThePast(s)));
const futureSlots = computed(() => slots.mySlots.filter(s => !isInThePast(s)));

function submit() {

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
