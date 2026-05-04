<script setup lang="ts">
// 通用操作按钮：统一主按钮、危险按钮和禁用态样式。
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
