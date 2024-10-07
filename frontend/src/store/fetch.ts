import { createFetch } from "@vueuse/core";

export const useAPI = createFetch({
  baseUrl: import.meta.env.VITE_API_HOST,
  options: {
    beforeFetch(ctx) {
      if (ctx.url === import.meta.env.VITE_API_HOST + '/') {
        ctx.cancel();
      }
    },
  }
})
