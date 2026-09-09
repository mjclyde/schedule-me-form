<template>
  <div class="px-6 pt-24 pb-10 sm:pt-20 sm:pb-16 lg:px-8">
    <div class="mx-auto max-w-2xl text-center">
      <p class="text-base font-semibold leading-7 text-sky-600">{{ schedule.schedule?.type }}</p>
      <h2 class="mt-2 text-4xl font-bold tracking-tight text-gray-700 md:text-6xl">
        {{ schedule.schedule?.name }}
      </h2>
      <p class="mt-6 text-lg leading-8 text-gray-600">
        {{ schedule.schedule?.description }}
      </p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useSchedule } from '../store/schedule';

const schedule = useSchedule();

</script>
