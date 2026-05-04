<script setup lang="ts">
// 通用筛选标签：用于可切换的轻量筛选按钮。
defineProps<{
  label: string;
  active?: boolean;
}>();

const emit = defineEmits<{
  click: [];
}>();
</script>

<template>
  <button class="chip" :class="{ 'chip--active': active }" @click="emit('click')">{{ label }}</button>
</template>
