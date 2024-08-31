<template>
  <MainHeader/>
  <div class="max-w-xl mx-auto px-8 mb-20">
    <Calendar/>
    <div class="text-center mt-8 mb-4 text-gray-500 font-bold text-sm">Select a Time</div>
    <Events/>
    <div class="text-center mt-8 mb-4 text-gray-500 font-bold text-sm">Enter Your Info</div>
    <ContactForm/>
    <Button class="w-full mt-6"/>
  </div>
</template>

<script setup lang="ts">
import MainHeader from './components/MainHeader.vue';
import Calendar from './components/Calendar.vue';
import Events from './components/Events.vue';
import ContactForm from './components/ContactForm.vue';
import Button from './components/Button.vue';
</script>

<style scoped></style>
