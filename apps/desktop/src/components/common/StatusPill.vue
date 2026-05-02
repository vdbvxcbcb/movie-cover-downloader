<script setup lang="ts">
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

const tone = computed(() => props.tone);
</script>

<template>
  <span class="pill" :class="`pill--${tone}`">{{ label }}</span>
</template>
