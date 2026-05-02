<script setup lang="ts">
import ActionButton from "../common/ActionButton.vue";
import type { TopAction } from "../../types/app";

defineProps<{
  eyebrow: string;
  title: string;
  description: string;
  actions: TopAction[];
  pendingActionIds: string[];
}>();

const emit = defineEmits<{
  action: [actionId: string];
}>();
</script>

<template>
  <header class="topbar">
    <div class="topbar__title">
      <p class="eyebrow">{{ eyebrow }}</p>
      <h2>{{ title }}</h2>
      <p class="topbar__description">{{ description }}</p>
    </div>

    <div class="topbar__actions">
      <ActionButton
        v-for="action in actions"
        :key="action.label"
        :label="action.label"
        :variant="action.variant"
        :size="action.size"
        :disabled="pendingActionIds.includes(action.id)"
        @click="emit('action', action.id)"
      />
    </div>
  </header>
</template>
