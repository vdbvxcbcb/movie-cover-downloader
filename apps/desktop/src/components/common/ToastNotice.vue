<script setup lang="ts">
// 全局提示组件：展示可关闭的短消息反馈。
withDefaults(
  defineProps<{
    message: string;
    tone?: "info" | "success" | "warn";
  }>(),
  {
    tone: "info",
  },
);

const emit = defineEmits<{
  close: [];
}>();
</script>

<template>
  <div class="toast" :class="`toast--${tone}`">
    <strong>状态更新</strong>
    <p>{{ message }}</p>
    <button class="toast__close" @click="emit('close')">关闭</button>
  </div>
</template>
