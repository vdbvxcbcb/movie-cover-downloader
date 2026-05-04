<script setup lang="ts">
// 日志列表组件：按时间展示运行日志，并为空状态保留固定高度。
import type { LogEntry } from "../../types/app";

defineProps<{
  entries: LogEntry[];
  scrollable?: boolean;
}>();
</script>

<template>
  <div :class="['log-console', { 'log-console--scrollable': scrollable }]">
    <p v-if="!entries.length" class="log-console__empty">暂无日志</p>
    <p v-for="entry in entries" :key="entry.id">
      <span :class="`log-level log-level--${entry.level.toLowerCase()}`">[{{ entry.level }}]</span>
      <span>[{{ entry.timestamp }}]</span>
      <span>[{{ entry.scope }}]</span>
      {{ entry.message }}
    </p>
  </div>
</template>
