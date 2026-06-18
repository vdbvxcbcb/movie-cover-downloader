<script setup lang="ts">
// 下载队列筛选栏：提供排序选择和搜索功能
import { computed, ref, watch } from "vue";
import type { TaskSortOrder } from "../../lib/task-order";

const props = defineProps<{
  sortOrder: TaskSortOrder;
  searchQuery: string;
}>();

const emit = defineEmits<{
  "update:sortOrder": [order: TaskSortOrder];
  "update:searchQuery": [query: string];
}>();

const sortOptions = [
  { value: "desc" as const, label: "按添加时间降序" },
  { value: "asc" as const, label: "按添加时间升序" },
];

const selectedSortLabel = computed(() => {
  return sortOptions.find((opt) => opt.value === props.sortOrder)?.label ?? "按添加时间排序";
});

const localSearchQuery = ref(props.searchQuery);
let debounceTimer: ReturnType<typeof setTimeout> | null = null;

function handleSortChange(event: Event) {
  const select = event.target as HTMLSelectElement;
  emit("update:sortOrder", select.value as TaskSortOrder);
}

function handleSearchInput(event: Event) {
  const input = event.target as HTMLInputElement;
  localSearchQuery.value = input.value;

  if (debounceTimer) {
    clearTimeout(debounceTimer);
  }

  debounceTimer = setTimeout(() => {
    emit("update:searchQuery", localSearchQuery.value);
  }, 300);
}

function handleSearchClick() {
  emit("update:searchQuery", localSearchQuery.value);
}

watch(() => props.searchQuery, (newVal) => {
  localSearchQuery.value = newVal;
});
</script>

<template>
  <div class="queue-filter-bar">
    <div class="filter-group">
      <label class="filter-select-wrapper">
        <select
          :value="sortOrder"
          class="filter-select"
          @change="handleSortChange"
        >
          <option
            v-for="option in sortOptions"
            :key="option.value"
            :value="option.value"
          >
            {{ option.label }}
          </option>
        </select>
        <span class="filter-select-display">{{ selectedSortLabel }}</span>
        <svg class="filter-select-icon" viewBox="0 0 24 24" aria-hidden="true">
          <path d="m7 10 5 5 5-5" />
        </svg>
      </label>

      <div class="filter-search-wrapper">
        <input
          type="text"
          :value="localSearchQuery"
          placeholder="输入影片名字搜索"
          class="filter-search"
          @input="handleSearchInput"
          @keydown.enter="handleSearchClick"
        />
        <button
          type="button"
          class="filter-search-button"
          aria-label="搜索"
          @click="handleSearchClick"
        >
          <svg class="filter-search-icon" viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="11" cy="11" r="8" />
            <path d="m21 21-4.35-4.35" />
          </svg>
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.queue-filter-bar {
  display: flex;
  justify-content: flex-end;
}

.filter-group {
  display: flex;
  gap: 12px;
  align-items: center;
}

/* 排序选择器 */
.filter-select-wrapper {
  position: relative;
  display: inline-block;
  cursor: pointer;
}

.filter-select {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  opacity: 0;
  cursor: pointer;
}

.filter-select-display {
  display: block;
  min-width: 172px;
  padding: 10px 40px 10px 14px;
  border-radius: 12px;
  border: 1px solid var(--line);
  background: rgba(255, 255, 255, 0.04);
  color: var(--text);
  font-size: 14px;
  white-space: nowrap;
  transition:
    border-color 180ms ease,
    background-color 180ms ease,
    box-shadow 180ms ease;
}

.filter-select-wrapper:hover .filter-select-display,
.filter-select:focus + .filter-select-display {
  border-color: var(--line-strong);
  background: rgba(77, 212, 198, 0.06);
}

.filter-select:focus + .filter-select-display {
  box-shadow: 0 0 0 3px rgba(77, 212, 198, 0.12);
}

.filter-select-icon {
  position: absolute;
  top: 50%;
  right: 14px;
  width: 18px;
  height: 18px;
  transform: translateY(-50%);
  fill: none;
  stroke: var(--muted);
  stroke-width: 2;
  stroke-linecap: round;
  stroke-linejoin: round;
  pointer-events: none;
  transition: stroke 180ms ease;
}

.filter-select-wrapper:hover .filter-select-icon,
.filter-select:focus ~ .filter-select-icon {
  stroke: var(--accent);
}

/* 搜索框 */
.filter-search-wrapper {
  position: relative;
  display: inline-flex;
  align-items: stretch;
}

.filter-search {
  width: 240px;
  padding: 10px 14px;
  border-radius: 12px 0 0 12px;
  border: 1px solid var(--line);
  border-right: none;
  background: rgba(255, 255, 255, 0.04);
  color: var(--text);
  font-size: 14px;
  outline: none;
  transition:
    border-color 180ms ease,
    background-color 180ms ease,
    box-shadow 180ms ease;
}

.filter-search::placeholder {
  color: var(--muted);
}

.filter-search:hover,
.filter-search:focus {
  border-color: var(--line-strong);
  background: rgba(77, 212, 198, 0.06);
}

.filter-search:focus {
  background: rgba(77, 212, 198, 0.08);
  box-shadow: -3px 0 0 0 rgba(77, 212, 198, 0.12), 0 3px 0 0 rgba(77, 212, 198, 0.12), 0 -3px 0 0 rgba(77, 212, 198, 0.12);
}

.filter-search-button {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0 14px;
  border-radius: 0 12px 12px 0;
  border: 1px solid var(--line);
  background: rgba(255, 255, 255, 0.04);
  color: var(--muted);
  cursor: pointer;
  transition:
    border-color 180ms ease,
    background-color 180ms ease,
    color 180ms ease,
    box-shadow 180ms ease;
}

.filter-search-button:hover {
  border-color: var(--line-strong);
  background: rgba(77, 212, 198, 0.12);
  color: var(--accent);
}

.filter-search-button:active {
  background: rgba(77, 212, 198, 0.18);
}

.filter-search:focus + .filter-search-button {
  border-color: var(--line-strong);
  box-shadow: 3px 0 0 0 rgba(77, 212, 198, 0.12), 0 3px 0 0 rgba(77, 212, 198, 0.12), 0 -3px 0 0 rgba(77, 212, 198, 0.12);
}

.filter-search-icon {
  width: 18px;
  height: 18px;
  fill: none;
  stroke: currentColor;
  stroke-width: 2;
  stroke-linecap: round;
  stroke-linejoin: round;
}
</style>

