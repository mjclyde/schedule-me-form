<template>
  <div class="isolate mt-2 grid grid-cols-12 gap-px rounded-lg bg-gray-200 text-sm shadow ring-1 ring-gray-200">
    <button v-for="(event, eventIdx) in events" :key="event.time" type="button"
      :class="[
      'py-3 focus:z-10',
      'col-span-' + (event.duration / 5),
      `rounded-${event.border}-lg`,
      event.available ? 'bg-white hover:bg-gray-100' : 'bg-gray-50 text-gray-300 cursor-default',
      ]"
    >
      {{ event.time }}
    </button>
  </div>
</template>

<script setup lang="ts">

const events = [
  { duration: 15, time: '3:00 pm', available: false, border: 'tl' },
  { duration: 15, time: '3:15 pm', available: false },
  { duration: 15, time: '3:30 pm', available: true },
  { duration: 15, time: '3:45 pm', available: true, border: 'tr' },
  { duration: 15, time: '4:00 pm', available: true },
  { duration: 15, time: '4:15 pm', available: false },
  { duration: 15, time: '4:30 pm', available: true, selected: true },
  { duration: 15, time: '4:45 pm', available: false },
  { duration: 15, time: '5:00 pm', available: true, border: 'bl' },
  { duration: 15, time: '5:15 pm', available: true },
  { duration: 15, time: '5:30 pm', available: true },
  { duration: 15, time: '5:45 pm', available: false, border: 'br' },
]

</script>
