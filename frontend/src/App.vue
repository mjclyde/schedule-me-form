<template>
  <MainHeader />
  <nav class="flex justify-center">
    <div class="grid gap-0.1 grid-cols-2 bg-gray-300 outline outline-1 outline-gray-300 rounded-md">
      <RouterLink class="link rounded-bl-md rounded-tl-md" to="/">Sign Up</RouterLink>
      <RouterLink class="link rounded-br-md rounded-tr-md" to="/my-events">My Events</RouterLink>
    </div>
  </nav>
  <main>
    <RouterView />
  </main>
</template>

<script setup lang="ts">
import MainHeader from './components/MainHeader.vue';
import { watchEffect } from 'vue';
import { useEvent } from './store/event';

const eventStore = useEvent();

watchEffect(() => {
  if (eventStore.event?.name) {
    window.document.title = eventStore.event.name;
  }
})

</script>

<style>
.link {
  @apply text-center bg-white px-5 py-3 font-bold bg-gray-100 text-gray-500;
}
.link:active {
  @apply bg-gray-200 text-gray-800;
}

.link.router-link-active {
  @apply bg-white text-sky-600 border-b-2 border-sky-500;
}
</style>
