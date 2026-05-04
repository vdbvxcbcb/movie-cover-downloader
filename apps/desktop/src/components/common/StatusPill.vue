<script setup lang="ts">
// 状态徽标组件：根据 tone 显示统一颜色的状态标签。
import { computed } from "vue";

const props = withDefaults(
  defineProps<{
    label: string;
    tone?: "good" | "warn" | "danger" | "neutral";
  }>(),
  {
    tone: "neutral",
  },
);

// 把传入的状态色调转成模板使用的 class，保持状态徽标样式集中。
const tone = computed(() => props.tone);
</script>

<template>
  <span class="pill" :class="`pill--${tone}`">{{ label }}</span>
</template>
