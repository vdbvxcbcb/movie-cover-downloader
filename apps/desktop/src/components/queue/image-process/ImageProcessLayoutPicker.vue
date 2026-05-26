<script setup lang="ts">
import type { LayoutCell, LayoutPreset } from "../../composables/types";

defineProps<{
  groups: Array<{ count: number; layouts: LayoutPreset[] }>;
  selectedLayoutId: string;
}>();

const emit = defineEmits<{
  select: [layoutId: string];
}>();

function cellStyle(cell: LayoutCell) {
  return {
    left: `${cell.x}%`,
    top: `${cell.y}%`,
    width: `${cell.w}%`,
    height: `${cell.h}%`,
  };
}
</script>

<template>
  <div class="layout-groups">
    <section v-for="group in groups" :key="group.count" class="layout-group">
      <p>{{ group.count }} 张图片</p>
      <div class="preset-list">
        <button
          v-for="layout in group.layouts"
          :key="layout.id"
          type="button"
          class="preset-card"
          :class="{ 'preset-card--active': selectedLayoutId === layout.id }"
          :title="layout.name"
          @click="emit('select', layout.id)"
        >
          <span class="preset-thumb">
            <i v-for="cell in layout.cells" :key="`${layout.id}-${cell.x}-${cell.y}-${cell.w}-${cell.h}`" :style="cellStyle(cell)"></i>
          </span>
          <small>{{ layout.name }}</small>
        </button>
      </div>
    </section>
  </div>
</template>

<style scoped>
.layout-groups {
  display: grid;
  gap: 12px;
}

.layout-group {
  display: grid;
  gap: 8px;
}

.layout-group p {
  color: var(--muted);
  font-size: 0.84rem;
  font-weight: 500;
}

.preset-list {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
}

.preset-card {
  display: grid;
  gap: 6px;
  min-width: 0;
  padding: 8px;
  border: 1px solid var(--line);
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.03);
  color: var(--muted);
  transition: border-color 160ms ease, background 160ms ease, color 160ms ease;
}

.preset-card:hover,
.preset-card--active {
  color: var(--text);
  border-color: var(--line-strong);
  background: rgba(77, 212, 198, 0.1);
}

.preset-thumb {
  position: relative;
  aspect-ratio: 1 / 0.72;
  overflow: hidden;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.04);
}

.preset-thumb i {
  position: absolute;
  padding: 2px;
}

.preset-thumb i::after {
  content: "";
  display: block;
  width: 100%;
  height: 100%;
  border-radius: 4px;
  background: rgba(77, 212, 198, 0.32);
}

.preset-card small {
  overflow: hidden;
  font-size: 0.76rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
