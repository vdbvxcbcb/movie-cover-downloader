<script setup lang="ts">
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
