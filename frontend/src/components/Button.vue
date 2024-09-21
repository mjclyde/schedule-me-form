<template>
  <button @click="clicked" :disabled="disabled" type="button"
    class="rounded-md px-3 py-3 text font-semibold shadow-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
    :class="[disabled ? 'bg-gray-300 text-gray-600' : 'bg-sky-600 hover:bg-sky-500 text-white focus-visible:outline-sky-600']"
    >
    <slot/>
  </button>
</template>

<script setup lang="ts">

const props = defineProps<{disabled?: boolean}>()
const emit = defineEmits(['click']);

function clicked() {
  if (!props.disabled) {
    emit('click')
  }
}

</script>
