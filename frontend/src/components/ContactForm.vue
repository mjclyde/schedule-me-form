<template>
  <div class="isolate -space-y-px rounded-md shadow-sm">
    <div class="relative rounded-md rounded-b-none px-3 pb-1.5 pt-2.5 ring-1 ring-inset ring-gray-300 focus-within:z-10 focus-within:ring-2 focus-within:ring-sky-600">
      <label for="name" class="block text-xs font-medium text-gray-500">Name</label>
      <div class="relative py-1">
        <div class="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-1">
          <UserIcon class="h-5 w-5 text-gray-500" aria-hidden="true" />
        </div>
        <input type="text" name="name" id="name" class="pl-10 block w-full border-0 p-0 text-gray-900 placeholder:text-gray-300 focus:ring-0 sm:text-sm sm:leading-6" placeholder="Jane Smith" />
      </div>
    </div>
    <div class="relative rounded-md rounded-t-none px-3 pb-1.5 pt-2.5 ring-1 ring-inset ring-gray-300 focus-within:z-10 focus-within:ring-2 focus-within:ring-sky-600">
      <label for="phone" class="block text-xs font-medium text-gray-500">Phone</label>
      <div class="relative py-1">
        <div class="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-1">
          <PhoneIcon class="h-5 w-5 text-gray-500" aria-hidden="true" />
        </div>
        <input type="text" name="phone" id="phone" class="pl-10 block w-full border-0 p-0 text-gray-900 placeholder:text-gray-300 focus:ring-0 sm:text-sm sm:leading-6" placeholder="(435) 555-1234" />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { UserIcon, PhoneIcon } from '@heroicons/vue/20/solid'
</script>
