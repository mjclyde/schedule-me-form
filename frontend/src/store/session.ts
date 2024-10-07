import { defineStore } from "pinia";
import { computed, Ref, watch } from "vue";
import { useAPI } from "./fetch";
import { BeforeFetchContext, useStorage } from "@vueuse/core";

interface Person {
  _id: string;
  name: string;
  phone: string;
}

export const useSession = defineStore("session", () => {
  const otp = useStorage("otp", "");
  const url = computed(() => (otp.value ? "/Me" : ""));

  function beforeFetch(ctx: BeforeFetchContext) {
    if (otp.value && typeof otp.value === "string") {
      ctx.options.headers = {
        ...ctx.options.headers,
        Authorization: otp.value,
      };
    }
  }

  const { data, execute } = useAPI(url, {
    refetch: true,
    beforeFetch,
  })
    .get()
    .json();

  watch(
    () => otp.value,
    () => execute()
  );

  return {
    person: data as Ref<Person>,
    beforeFetch,
  };
});
