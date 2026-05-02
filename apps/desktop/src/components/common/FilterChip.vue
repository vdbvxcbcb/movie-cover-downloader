<script setup lang="ts">
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
