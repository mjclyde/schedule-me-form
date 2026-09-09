<template>
  <div
    class="outline outline-1 outline-gray-200 sm:text-lg text-md text-gray-700 font-semibold py-4 px-5 my-4 rounded-md shadow-sm flex items-center"
    :class="[isPast ? 'in-the-past' : 'clickable']" @click="$emit('click', booking)">
    <div class="flex items-center flex-1">
      <CalendarDaysIcon class="h-7 w-7 mr-5 text-gray-400" aria-hidden="true" />
      {{ booking.dayStr }}
      <span class="subtle-text">@</span>
      {{ booking.timeStr }}
      <span class="subtle-text">{{ booking.durationMins }} mins</span>
    </div>
    <button @click.stop="$emit('cancel', booking)" v-if="!isPast" type="button"
      class="rounded-md bg-white px-3 py-2.5 text-sm font-semibold text-gray-500 shadow-sm ring-1 ring-inset ring-gray-300 hover:bg-gray-50 active:text-red-500 active:ring-red-300">
      <TrashIcon class="h-4 w-4" aria-hidden="true" />
    </button>
  </div>
</template>

<script lang="ts" setup>
import { FormattedBooking } from '../store/bookings';
import { CalendarDaysIcon, TrashIcon } from '@heroicons/vue/20/solid'

defineProps<{ booking: FormattedBooking, isPast?: boolean }>()
defineEmits(['cancel', 'click']);

</script>

<style>
.in-the-past {
  @apply text-gray-300;

  .subtle-text {
    @apply text-gray-300;
  }
}

.subtle-text {
  @apply text-sm text-gray-400 mx-2;
}

.clickable {
  cursor: pointer;
}

.clickable:not(:has(button:hover)):hover {
  @apply bg-sky-100 outline-sky-200;
}

.clickable:not(:has(button:active)):active {
  @apply bg-sky-200 outline-sky-300;
}
</style>
