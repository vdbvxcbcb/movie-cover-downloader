<script setup lang="ts">
// 任务进度单元格：把下载数量转换成文字和进度条。
import { computed } from "vue";
import type { TaskItem } from "../../types/app";

const props = defineProps<{
  task: TaskItem;
}>();

// 进度单元只读取 download 快照；没有发现总数时显示 -，发现后显示 saved/target。
// 把任务下载快照提取成当前单元格需要的 saved/target 数据。
const progress = computed(() => ({
  savedCount: props.task.download?.savedCount ?? 0,
  targetCount: props.task.download?.targetCount ?? 0,
}));

// 格式化进度文本：没有总数时显示 -，有总数时显示 saved/target。
const progressText = computed(() => {
  if (!progress.value.targetCount) {
    return "-";
  }

  if (progress.value.savedCount === 0) {
    return `-/${progress.value.targetCount}`;
  }

  return `${progress.value.savedCount}/${progress.value.targetCount}`;
});

// 根据 saved/target 计算进度条宽度百分比。
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
