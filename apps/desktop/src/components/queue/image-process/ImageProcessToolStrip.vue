<script setup lang="ts">
import type { DrawingKind } from "../../composables/types";

defineProps<{
  activeDrawingKind: DrawingKind | null;
  hasImages: boolean;
  hasAnnotations: boolean;
}>();

const emit = defineEmits<{
  addText: [];
  selectDrawing: [kind: DrawingKind];
  shuffle: [];
  clear: [];
}>();
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
    <button type="button" title="随机图片位置" :disabled="!hasImages" @click="emit('shuffle')">随机</button>
    <button type="button" title="清空图片和标注" :disabled="!hasImages && !hasAnnotations" @click="emit('clear')">
      清除
    </button>
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
</style>
