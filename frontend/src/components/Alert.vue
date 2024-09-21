<template>
  <div class="rounded-md border-2 p-4"
    :class="[
      type === 'SUCCESS' ? 'bg-green-100 border-green-200' : '',
      type === 'ERROR' ? 'bg-red-100 border-red-200' : '',
    ]">
    <div class="flex">
      <div class="flex-shrink-0">
        <CheckCircleIcon v-if="type === 'SUCCESS'" class="h-5 w-5 text-green-500" aria-hidden="true"/>
        <XCircleIcon v-if="type === 'ERROR'" class="h-5 w-5 text-red-500" aria-hidden="true"/>
      </div>
      <div class="ml-3">
        <h3 class="font-bold" :class="[
          type === 'SUCCESS' ? 'text-green-900' : '',
          type === 'ERROR' ? 'text-red-900' : '',
        ]">{{ title || 'Some Title' }}</h3>
        <div class="mt-2" :class="[
          type === 'SUCCESS' ? 'text-green-700' : '',
          type === 'ERROR' ? 'text-red-700' : '',
        ]">
          <p>
            <slot/>
          </p>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { CheckCircleIcon, XCircleIcon } from '@heroicons/vue/20/solid'

defineProps<{title?: string, type: 'SUCCESS' | 'ERROR' }>()

</script>
