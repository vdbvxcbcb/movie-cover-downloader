<script setup lang="ts">
import { onMounted } from "vue";
import { useAppStore } from "./stores/app";

const appStore = useAppStore();

onMounted(() => {
  void appStore.bootstrap();
});
</script>

<template>
  <RouterView />
</template>
