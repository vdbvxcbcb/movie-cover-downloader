<script setup lang="ts">
import type { SelectableDoubanPhoto } from "../../types/app";

defineProps<{
  photo: SelectableDoubanPhoto | null;
  imageUrl: string;
  currentIndex: number | null;
  total: number;
}>();

const emit = defineEmits<{
  close: [];
  step: [delta: -1 | 1];
  imageError: [photo: SelectableDoubanPhoto];
}>();
</script>

<template>
  <Teleport to="body">
    <div
      v-if="photo"
      class="selected-photo-preview"
      role="dialog"
      aria-modal="true"
      @click.self="emit('close')"
    >
      <button type="button" class="selected-photo-preview__close" aria-label="关闭预览" @click="emit('close')">×</button>
      <button
        type="button"
        class="selected-photo-preview__nav selected-photo-preview__nav--prev"
        aria-label="上一张"
        @click="emit('step', -1)"
      >
        ‹
      </button>
      <img
        class="selected-photo-preview__image"
        :src="imageUrl"
        :alt="photo.title"
        @error="emit('imageError', photo)"
      />
      <button
        type="button"
        class="selected-photo-preview__nav selected-photo-preview__nav--next"
        aria-label="下一张"
        @click="emit('step', 1)"
      >
        ›
      </button>
      <div class="selected-photo-preview__counter">
        {{ (currentIndex ?? 0) + 1 }} / {{ total }}
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.selected-photo-preview {
  position: fixed;
  inset: 0;
  z-index: 2200;
  display: grid;
  place-items: center;
  padding: 56px 76px 72px;
  background: rgba(0, 0, 0, 0.68);
  backdrop-filter: blur(2px);
}

.selected-photo-preview__image {
  max-width: min(86vw, 1120px);
  max-height: calc(100vh - 150px);
  object-fit: contain;
  box-shadow: 0 26px 72px rgba(0, 0, 0, 0.44);
}

.selected-photo-preview__close,
.selected-photo-preview__nav {
  position: fixed;
  display: grid;
  place-items: center;
  padding: 0;
  border: 0;
  color: rgba(255, 255, 255, 0.9);
  background: rgba(255, 255, 255, 0.18);
  backdrop-filter: blur(8px);
  line-height: 1;
}

.selected-photo-preview__close {
  top: 24px;
  right: 24px;
  width: 42px;
  height: 42px;
  border-radius: 999px;
  font-size: 1.5rem;
}

.selected-photo-preview__nav {
  top: 50%;
  width: 48px;
  height: 48px;
  border-radius: 999px;
  color: transparent;
  transform: translateY(50%);
}

.selected-photo-preview__nav::before {
  content: "";
  width: 12px;
  height: 12px;
  border-top: 3px solid rgba(255, 255, 255, 0.9);
  border-right: 3px solid rgba(255, 255, 255, 0.9);
}

.selected-photo-preview__nav--prev {
  left: 28px;
}

.selected-photo-preview__nav--prev::before {
  transform: translate(2px, 80%) rotate(-135deg);
}

.selected-photo-preview__nav--next {
  right: 28px;
}

.selected-photo-preview__nav--next::before {
  transform: translate(-2px, 80%) rotate(45deg);
}

.selected-photo-preview__counter {
  position: fixed;
  left: 50%;
  bottom: 28px;
  min-width: 72px;
  padding: 8px 14px;
  border-radius: 999px;
  color: rgba(255, 255, 255, 0.92);
  background: rgba(255, 255, 255, 0.18);
  text-align: center;
  transform: translateX(-50%);
}
</style>
