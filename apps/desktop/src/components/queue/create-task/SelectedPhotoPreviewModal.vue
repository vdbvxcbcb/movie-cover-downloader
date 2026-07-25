<script setup lang="ts">
import { computed, shallowRef } from "vue";
import type { SelectableDoubanPhoto } from "../../../types/app";

const props = defineProps<{
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

const commonAspectRatios = [
  { label: "1:1", value: 1 },
  { label: "16:9", value: 16 / 9 },
  { label: "9:16", value: 9 / 16 },
  { label: "4:3", value: 4 / 3 },
  { label: "3:4", value: 3 / 4 },
  { label: "3:2", value: 3 / 2 },
  { label: "2:3", value: 2 / 3 },
] as const;

interface LoadedDimensions {
  imageKey: string;
  width: number;
  height: number;
}

const loadedDimensions = shallowRef<LoadedDimensions | null>(null);
const currentImageKey = computed(() => `${props.photo?.id ?? ""}:${props.imageUrl}`);

function normalizeDimension(value: number | undefined) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.round(value) : 0;
}

const displayedDimensions = computed(() => {
  const metadataWidth = normalizeDimension(props.photo?.width);
  const metadataHeight = normalizeDimension(props.photo?.height);
  if (metadataWidth > 0 && metadataHeight > 0) {
    return { width: metadataWidth, height: metadataHeight };
  }

  const loaded = loadedDimensions.value;
  return loaded?.imageKey === currentImageKey.value ? loaded : null;
});
const dimensionLabel = computed(() => {
  const dimensions = displayedDimensions.value;
  if (!dimensions) return "";
  const aspectRatio = dimensions.width / dimensions.height;
  const nearestRatio = commonAspectRatios.reduce((nearest, candidate) =>
    Math.abs(Math.log(aspectRatio / candidate.value)) < Math.abs(Math.log(aspectRatio / nearest.value)) ? candidate : nearest,
  );
  return `${dimensions.width}x${dimensions.height} ${nearestRatio.label}`;
});

function handleImageLoad(event: Event) {
  const image = event.currentTarget as HTMLImageElement;
  if (image.naturalWidth <= 0 || image.naturalHeight <= 0) return;
  loadedDimensions.value = {
    imageKey: currentImageKey.value,
    width: image.naturalWidth,
    height: image.naturalHeight,
  };
}
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
        @load="handleImageLoad"
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
      <div v-if="dimensionLabel" class="selected-photo-preview__meta">
        {{ dimensionLabel }}
      </div>
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

.selected-photo-preview__meta {
  position: fixed;
  left: 50%;
  bottom: 76px;
  max-width: calc(100vw - 152px);
  padding: 7px 12px;
  overflow: hidden;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 6px;
  color: rgba(255, 255, 255, 0.88);
  background: rgba(8, 18, 20, 0.72);
  backdrop-filter: blur(8px);
  font-size: 0.82rem;
  font-variant-numeric: tabular-nums;
  line-height: 1.2;
  text-overflow: ellipsis;
  white-space: nowrap;
  transform: translateX(-50%);
}
</style>
