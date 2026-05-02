<script setup lang="ts">
withDefaults(
  defineProps<{
    label: string;
    variant?: "primary" | "ghost";
    size?: "md" | "sm";
    disabled?: boolean;
  }>(),
  {
    variant: "ghost",
    size: "md",
    disabled: false,
  },
);

const emit = defineEmits<{
  click: [];
}>();
</script>

<template>
  <button
    class="action-btn"
    :class="{
      'action-btn--primary': variant === 'primary',
      'action-btn--small': size === 'sm',
    }"
    :disabled="disabled"
    @click="emit('click')"
  >
    {{ label }}
  </button>
</template>
