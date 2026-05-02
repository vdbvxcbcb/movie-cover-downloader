<script setup lang="ts">
import { computed } from "vue";
import type { TaskItem } from "../../types/app";

const props = defineProps<{
  task: TaskItem;
}>();

const progress = computed(() => ({
  savedCount: props.task.download?.savedCount ?? 0,
  targetCount: props.task.download?.targetCount ?? 0,
}));

const progressText = computed(() => {
  if (!progress.value.targetCount) {
    return "-";
  }

  if (progress.value.savedCount === 0) {
    return `-/${progress.value.targetCount}`;
  }

  return `${progress.value.savedCount}/${progress.value.targetCount}`;
});

const progressPercent = computed(() => {
  if (!progress.value.targetCount) {
    return 0;
  }

  return Math.round(Math.min(progress.value.savedCount / progress.value.targetCount, 1) * 100);
});
</script>

<template>
  <div class="progress-cell">
    <span class="progress-cell__text">{{ progressText }}</span>
    <div class="progress-cell__track" aria-hidden="true">
      <span class="progress-cell__bar" :style="{ width: `${progressPercent}%` }" />
    </div>
  </div>
</template>

<style scoped>
.progress-cell {
  display: grid;
  gap: 8px;
}

.progress-cell__text {
  white-space: nowrap;
}

.progress-cell__track {
  width: 100%;
  height: 5px;
  border-radius: 999px;
  overflow: hidden;
  background: rgba(255, 255, 255, 0.08);
}

.progress-cell__bar {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: linear-gradient(90deg, var(--accent), #7ce5c9);
  transition: width 160ms ease;
}
</style>
