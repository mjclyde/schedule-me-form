import { createWebHistory, createRouter } from 'vue-router'

import EventPicker from './pages/EventPicker.vue'
import MyEvents from './pages/MyEvents.vue'

const routes = [
  { path: '/', component: EventPicker },
  { path: '/my-events', component: MyEvents },
]

const router = createRouter({
  history: createWebHistory(),
  routes,
})

export default router
