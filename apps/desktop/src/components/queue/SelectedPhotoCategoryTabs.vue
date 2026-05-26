<script setup lang="ts">
import type { DoubanAssetType } from "../../types/app";

defineProps<{
  activeType: DoubanAssetType;
  counts: Record<DoubanAssetType, number>;
}>();

const emit = defineEmits<{
  select: [assetType: DoubanAssetType];
}>();

const categoryTabs: Array<{ type: DoubanAssetType; label: string }> = [
  { type: "still", label: "剧照" },
  { type: "poster", label: "海报" },
  { type: "wallpaper", label: "壁纸" },
];
</script>

<template>
  <div class="selected-download__filters">
    <button
      v-for="tab in categoryTabs"
      :key="tab.type"
      type="button"
      :class="{ 'selected-download__filter--active': activeType === tab.type }"
      @click="emit('select', tab.type)"
    >
      {{ tab.label }} {{ counts[tab.type] }}
    </button>
  </div>
</template>

<style scoped>
.selected-download__filters {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
  align-items: center;
}

.selected-download__filters button {
  min-height: 38px;
  padding: 0 13px;
  border-radius: 12px;
  color: var(--muted);
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid var(--line);
}

.selected-download__filters button:hover,
.selected-download__filter--active {
  color: var(--text) !important;
  border-color: var(--line-strong) !important;
  background: rgba(77, 212, 198, 0.1) !important;
}
</style>
