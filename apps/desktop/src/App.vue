<script setup lang="ts">
// 应用根组件：负责启动持久化恢复，并承载全局布局。
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
