<script setup lang="ts">
import type { DrawingKind } from "../../composables/types";

defineProps<{
  activeDrawingKind: DrawingKind | null;
  hasImages: boolean;
  hasAnnotations: boolean;
  previewScale: number;
  canUndo: boolean;
}>();

const emit = defineEmits<{
  addText: [];
  selectDrawing: [kind: DrawingKind];
  shuffle: [];
  clearAnnotations: [];
  clear: [];
  updatePreviewScale: [value: number];
  undo: [];
}>();

function clampPreviewScale(value: number) {
  return Math.min(1, Math.max(0.3, Number(value.toFixed(1))));
}
</script>

<template>
  <div class="tool-strip">
    <button type="button" title="添加文字" @click="emit('addText')">文字</button>
    <button
      type="button"
      class="tool-strip__icon"
      :class="{ 'tool-strip__icon--active': activeDrawingKind === 'arrow' }"
      title="绘制箭头"
      @click="emit('selectDrawing', 'arrow')"
    >
      ↗
    </button>
    <button
      type="button"
      class="tool-strip__icon"
      :class="{ 'tool-strip__icon--active': activeDrawingKind === 'rect' }"
      title="绘制方框"
      @click="emit('selectDrawing', 'rect')"
    >
      □
    </button>
    <button
      type="button"
      class="tool-strip__icon tool-strip-circle"
      :class="{ 'tool-strip__icon--active': activeDrawingKind === 'circle' }"
      title="绘制圆圈"
      @click="emit('selectDrawing', 'circle')"
    >
      ○
    </button>
    <button type="button" class="tool-strip__icon" title="撤销标注" aria-label="撤销标注" :disabled="!canUndo" @click="emit('undo')">↶</button>
    <button type="button" title="随机图片位置" :disabled="!hasImages" @click="emit('shuffle')">随机</button>
    <button type="button" title="清除标注" :disabled="!hasAnnotations" @click="emit('clearAnnotations')">清除标注</button>
    <button type="button" title="清除全部前景图与标注" :disabled="!hasImages && !hasAnnotations" @click="emit('clear')">
      清除全部
    </button>
    <span class="tool-strip__divider" aria-hidden="true"></span>
    <div class="preview-zoom" aria-label="画布预览缩放">
      <button
        type="button"
        class="tool-strip__icon"
        title="缩小画布预览"
        aria-label="缩小画布预览"
        :disabled="previewScale <= 0.3"
        @click="emit('updatePreviewScale', clampPreviewScale(previewScale - 0.1))"
      >
        −
      </button>
      <output>{{ Math.round(previewScale * 100) }}%</output>
      <button
        type="button"
        class="tool-strip__icon"
        title="放大画布预览"
        aria-label="放大画布预览"
        :disabled="previewScale >= 1"
        @click="emit('updatePreviewScale', clampPreviewScale(previewScale + 0.1))"
      >
        ＋
      </button>
      <button type="button" title="还原画布预览" aria-label="还原画布预览" :disabled="previewScale === 1" @click="emit('updatePreviewScale', 1)">
        还原
      </button>
    </div>
  </div>
</template>

<style scoped>
.tool-strip {
  position: relative;
  z-index: 8;
  justify-self: center;
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  width: max-content;
  max-width: 100%;
  padding: 6px;
  border: 1px solid var(--line);
  border-radius: 14px;
  background: rgba(4, 16, 19, 0.72);
  box-shadow: 0 14px 34px rgba(0, 0, 0, 0.28);
  backdrop-filter: blur(14px);
}

.tool-strip button {
  min-width: 38px;
  height: 34px;
  padding: 0 12px;
  border: 1px solid var(--line);
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.04);
  color: var(--text);
  transition: border-color 160ms ease, background 160ms ease, transform 160ms ease;
}

.tool-strip__icon {
  font-size: 1.3rem;
  font-weight: 700;
}

.tool-strip button:hover:not(:disabled),
.tool-strip__icon--active {
  border-color: var(--line-strong);
  background: rgba(77, 212, 198, 0.1);
  transform: translateY(-1px);
}

.tool-strip button:disabled {
  cursor: not-allowed;
  opacity: 0.46;
}

.tool-strip__divider {
  width: 1px;
  height: 24px;
  margin: 5px 2px;
  background: var(--line);
}

.preview-zoom {
  display: flex;
  align-items: center;
  gap: 6px;
}

.preview-zoom output {
  width: 44px;
  color: var(--muted);
  font-size: 0.78rem;
  text-align: center;
}
</style>
