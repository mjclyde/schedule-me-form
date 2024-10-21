<template>
  <div
    class="outline outline-1 outline-gray-200 sm:text-lg text-md text-gray-700 font-semibold py-4 px-5 my-4 rounded-md shadow-sm flex items-center"
    :class="[isPast ? 'in-the-past' : '']">
    <div class="flex items-center flex-1">
      <CalendarDaysIcon class="h-7 w-7 mr-5 text-gray-400" aria-hidden="true" />
      {{ MonthNames[slot.month].substring(0, 3) }}. {{ slot.date }}
      <span class="subtle-text">@</span>
      {{ slot.timeStr }}
      <span class="subtle-text">{{ slot.durationMins }} mins</span>
    </div>
    <button @click="$emit('delete', slot)" v-if="!isPast" type="button"
      class="rounded-md bg-white px-3 py-2.5 text-sm font-semibold text-gray-500 shadow-sm ring-1 ring-inset ring-gray-300 hover:bg-gray-50 active:text-red-500 active:ring-red-300">
      <TrashIcon class="h-4 w-4" aria-hidden="true" />
    </button>
  </div>
</template>

<script lang="ts" setup>
import { FormattedSlot, MonthNames } from '../store/slots';
import { CalendarDaysIcon, TrashIcon } from '@heroicons/vue/20/solid'

defineProps<{ slot: FormattedSlot, isPast?: boolean }>()
defineEmits(['delete']);

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
</style>
