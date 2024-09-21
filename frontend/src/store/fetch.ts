import { createFetch } from "@vueuse/core";

export const useAPI = createFetch({
  baseUrl: import.meta.env.VITE_API_HOST
})
