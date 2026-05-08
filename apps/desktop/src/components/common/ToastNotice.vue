<script setup lang="ts">
// 全局提示组件：展示可关闭的短消息反馈。
import { onBeforeUnmount, onMounted, watch } from "vue";

const props = withDefaults(
  defineProps<{
    message: string;
    tone?: "info" | "success" | "warn";
    duration?: number;
  }>(),
  {
    tone: "info",
    duration: 3000,
  },
);

const emit = defineEmits<{
  close: [];
}>();

let closeTimer: number | null = null;

function clearCloseTimer() {
  if (closeTimer !== null) {
    window.clearTimeout(closeTimer);
    closeTimer = null;
  }
}

function scheduleClose() {
  clearCloseTimer();
  closeTimer = window.setTimeout(() => {
    closeTimer = null;
    emit("close");
  }, props.duration);
}

onMounted(scheduleClose);
onBeforeUnmount(clearCloseTimer);

watch(
  () => props.message,
  () => scheduleClose(),
);
</script>

<template>
  <div class="toast" :class="`toast--${tone}`">
    <strong>状态更新</strong>
    <p>{{ message }}</p>
    <button class="toast__close" @click="emit('close')">关闭</button>
  </div>
</template>
