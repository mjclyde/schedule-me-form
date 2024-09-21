<template>
  <Listbox as="div" v-model="store.selectedSlot">
    <ListboxLabel class="block text-center mt-8 mb-4 text-gray-500 font-bold text-sm">Select a Time</ListboxLabel>
    <div class="relative mt-2">
      <ListboxButton :disabled="!store.selectedSlot" class="relative w-full cursor-default rounded-md bg-white py-3 pl-5 pr-10 text-left text-gray-900 shadow-sm ring-1 ring-inset ring-gray-300 focus:outline-none focus:ring-2 focus:ring-sky-600 sm:leading-6"
        :class="[!store.selectedSlot ? 'opacity-40' : '']"
      >
        <span class="truncate">{{ store.selectedSlot ? store.selectedSlot.timeStr : 'Select a Time' }}</span>
        <span class="truncate ml-4 text-sm text-gray-400" v-if="store.selectedSlot">{{ store.selectedSlot.durationMins }} mins</span>
        <span class="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-2">
          <ChevronUpDownIcon class="h-5 w-5 text-gray-400" aria-hidden="true" />
        </span>
      </ListboxButton>

      <transition leave-active-class="transition ease-in duration-100" leave-from-class="opacity-100" leave-to-class="opacity-0">
        <ListboxOptions class="absolute z-10 mt-1 max-h-60 w-full overflow-auto rounded-md bg-white py-1 text-base shadow-lg ring-1 ring-black ring-opacity-5 focus:outline-none sm:text-sm">
          <ListboxOption as="template" v-for="s in store.selectedCalendarDay?.slots" :key="s._id" :value="s" v-slot="{ active, selected }">
            <li :class="[active ? 'bg-sky-600 text-white' : 'text-gray-900', 'relative cursor-default select-none py-2 pl-8 pr-4']">
              <span :class="[selected ? 'font-semibold' : 'font-normal', 'truncate']">{{ s.timeStr }}</span>
              <span class="truncate ml-4 text-sm">{{ s.durationMins }} mins</span>

              <span v-if="selected" :class="[active ? 'text-white' : 'text-sky-600', 'absolute inset-y-0 left-0 flex items-center pl-1.5']">
                <CheckIcon class="h-5 w-5" aria-hidden="true" />
              </span>
            </li>
          </ListboxOption>
        </ListboxOptions>
      </transition>
    </div>
  </Listbox>
</template>

<script setup lang="ts">
import { Listbox, ListboxButton, ListboxLabel, ListboxOption, ListboxOptions } from '@headlessui/vue'
import { CheckIcon, ChevronUpDownIcon } from '@heroicons/vue/20/solid'
import { useSlots } from '../store/slots';

const store = useSlots();

</script>
