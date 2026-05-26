<script setup lang="ts">
import { toRef, useTemplateRef } from "vue";
import type { SelectableDoubanPhoto } from "../../types/app";
import { formatSelectedPhotoCategory } from "../composables/selected-photo-helpers";
import { useSelectedPhotoGridSelection } from "../composables/useSelectedPhotoGridSelection";

const props = defineProps<{
  photos: SelectableDoubanPhoto[];
  visiblePhotos: SelectableDoubanPhoto[];
  showLoading: boolean;
  emptyText: string;
  isPhotoLoaded: (photo: SelectableDoubanPhoto) => boolean;
  isPhotoFailed: (photo: SelectableDoubanPhoto) => boolean;
  getPreviewUrl: (photo: SelectableDoubanPhoto) => string;
}>();

const emit = defineEmits<{
  updatePhotos: [photos: SelectableDoubanPhoto[]];
  requestNextBatch: [];
  photoLoad: [photo: SelectableDoubanPhoto];
  photoError: [photo: SelectableDoubanPhoto];
  openPreview: [photoId: string];
}>();

const selectedPhotoGridRef = useTemplateRef<HTMLElement>("selectedPhotoGridRef");

const {
  isSelectedPhotoDragSelecting,
  selectedPhotoDragBox,
  selectedPhotoDragBoxStyle,
  handleSelectedPhotoGridPointerDown,
  handleSelectedPhotoGridPointerMove,
  finishSelectedPhotoDrag,
  cancelSelectedPhotoDrag,
  handleSelectedPhotoDoubleClick,
} = useSelectedPhotoGridSelection({
  photos: toRef(props, "photos"),
  gridRef: selectedPhotoGridRef,
  updatePhotos: (photos) => emit("updatePhotos", photos),
  openPreview: (photoId) => emit("openPreview", photoId),
});

function handleSelectedPhotoGridScroll(event: Event) {
  const element = event.currentTarget as HTMLElement | null;
  if (!element) return;
  const distanceToBottom = element.scrollHeight - element.scrollTop - element.clientHeight;
  if (distanceToBottom > 24) return;

  emit("requestNextBatch");
}
</script>

<template>
  <div
    v-if="visiblePhotos.length"
    ref="selectedPhotoGridRef"
    class="selected-photo-grid"
    :class="{ 'selected-photo-grid--selecting': isSelectedPhotoDragSelecting }"
    @scroll="handleSelectedPhotoGridScroll"
    @pointerdown="handleSelectedPhotoGridPointerDown"
    @pointermove="handleSelectedPhotoGridPointerMove"
    @pointerup="finishSelectedPhotoDrag"
    @pointercancel="cancelSelectedPhotoDrag"
    @lostpointercapture="cancelSelectedPhotoDrag"
  >
    <button
      v-for="photo in visiblePhotos"
      :key="photo.id"
      type="button"
      class="selected-photo-card"
      :class="{ 'selected-photo-card--selected': photo.selected }"
      :data-selected-photo-id="photo.id"
      @dblclick.stop="handleSelectedPhotoDoubleClick(photo.id)"
      @dragstart.prevent
    >
      <span class="selected-photo-card__checkbox" :class="{ 'selected-photo-card__checkbox--checked': photo.selected }" aria-hidden="true"></span>
      <span class="selected-photo-card__tag">{{ formatSelectedPhotoCategory(photo) }}</span>
      <span class="selected-photo-card__media">
        <span
          v-if="!isPhotoLoaded(photo) && !isPhotoFailed(photo)"
          class="selected-photo-card__loading"
          aria-hidden="true"
        ></span>
        <span v-if="isPhotoFailed(photo)" class="selected-photo-card__placeholder" aria-hidden="true">
          <span class="selected-photo-card__placeholder-icon"></span>
        </span>
        <img
          v-show="!isPhotoFailed(photo)"
          :src="getPreviewUrl(photo)"
          :alt="photo.title"
          loading="lazy"
          @load="emit('photoLoad', photo)"
          @error="emit('photoError', photo)"
        />
      </span>
      <span class="selected-photo-card__meta">
        <span>{{ photo.title || formatSelectedPhotoCategory(photo) }}</span>
      </span>
    </button>
    <div v-if="showLoading" class="selected-photo-grid__loading" aria-live="polite">
      <span class="selected-spin selected-spin--large" aria-hidden="true">
        <span></span>
        <span></span>
        <span></span>
        <span></span>
      </span>
      <span>继续解析中...</span>
    </div>
    <span
      v-if="selectedPhotoDragBox"
      class="selected-photo-grid__selection"
      :style="selectedPhotoDragBoxStyle"
      aria-hidden="true"
    ></span>
  </div>
  <div v-else class="selected-download__empty">
    {{ emptyText }}
  </div>
</template>

<style scoped>
.selected-photo-grid {
  position: relative;
  grid-row: 4;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(clamp(118px, 10vw, 138px), 1fr));
  align-content: start;
  gap: 14px;
  height: 100%;
  min-height: 0;
  min-width: 0;
  max-height: 100%;
  overflow: auto;
  overscroll-behavior: contain;
  padding: 2px 4px 8px 2px;
  scrollbar-gutter: stable;
  user-select: none;
}

.selected-photo-grid--selecting {
  cursor: crosshair;
}

.selected-photo-grid__selection {
  position: absolute;
  z-index: 4;
  pointer-events: none;
  border: 1px solid rgba(77, 212, 198, 0.88);
  border-radius: 8px;
  background: rgba(77, 212, 198, 0.16);
  box-shadow: 0 0 0 1px rgba(3, 17, 19, 0.28);
}

.selected-photo-grid__loading {
  grid-column: 1 / -1;
  min-height: 118px;
  display: grid;
  place-items: center;
  align-content: center;
  gap: 10px;
  color: var(--accent);
  border: 1px dashed rgba(77, 212, 198, 0.22);
  border-radius: 12px;
  background:
    linear-gradient(180deg, rgba(77, 212, 198, 0.06), rgba(77, 212, 198, 0.02)),
    rgba(4, 16, 19, 0.62);
  font-size: 0.86rem;
}

.selected-photo-card {
  position: relative;
  display: grid;
  grid-template-rows: minmax(0, 1fr) 34px;
  height: 188px;
  padding: 0;
  overflow: hidden;
  border-radius: 12px;
  border: 1px solid rgba(255, 255, 255, 0.07);
  background: rgba(7, 23, 27, 0.92);
  transition: border-color 160ms ease, box-shadow 160ms ease, transform 160ms ease, background 160ms ease;
  user-select: none;
}

.selected-photo-card:hover {
  border-color: rgba(77, 212, 198, 0.58);
  background: rgba(11, 33, 38, 0.96);
  transform: translateY(-1px);
}

.selected-photo-card--selected {
  border-color: var(--accent);
  box-shadow:
    inset 0 0 0 2px rgba(77, 212, 198, 0.96),
    0 0 0 1px rgba(77, 212, 198, 0.36);
}

.selected-photo-card__media {
  position: relative;
  display: block;
  min-height: 0;
  overflow: hidden;
  background:
    linear-gradient(135deg, rgba(255, 255, 255, 0.05), transparent),
    rgba(255, 255, 255, 0.04);
}

.selected-photo-card__media img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.selected-photo-card__loading {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  background:
    linear-gradient(110deg, rgba(255, 255, 255, 0.04) 8%, rgba(255, 255, 255, 0.1) 18%, rgba(255, 255, 255, 0.04) 33%),
    rgba(15, 37, 42, 0.92);
  background-size: 200% 100%;
  animation: selected-photo-loading 1.1s linear infinite;
}

.selected-photo-card__loading::after {
  content: "";
  width: 22px;
  height: 22px;
  border-radius: 999px;
  border: 2px solid rgba(223, 240, 235, 0.2);
  border-top-color: var(--accent);
  animation: selected-photo-spinner 760ms linear infinite;
}

.selected-photo-card__placeholder {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  background: #f6f6f3;
}

.selected-photo-card__placeholder-icon {
  position: relative;
  width: 42px;
  height: 42px;
  border-radius: 10px;
  border: 2px solid #deded9;
}

.selected-photo-card__placeholder-icon::before,
.selected-photo-card__placeholder-icon::after {
  content: "";
  position: absolute;
}

.selected-photo-card__placeholder-icon::before {
  left: 10px;
  top: 9px;
  width: 18px;
  height: 18px;
  border: 2px solid #deded9;
  border-top: 0;
  border-radius: 0 0 8px 8px;
}

.selected-photo-card__placeholder-icon::after {
  left: 13px;
  top: 5px;
  width: 12px;
  height: 9px;
  border: 2px solid #deded9;
  border-bottom: 0;
  border-radius: 9px 9px 0 0;
}

@keyframes selected-photo-loading {
  to {
    background-position-x: -200%;
  }
}

@keyframes selected-photo-spinner {
  to {
    transform: rotate(360deg);
  }
}

.selected-photo-card__tag {
  position: absolute;
  top: 8px;
  right: 8px;
  z-index: 1;
  max-width: calc(100% - 42px);
  padding: 3px 7px;
  border-radius: 999px;
  color: rgba(223, 240, 235, 0.92);
  background: rgba(3, 10, 13, 0.7);
  border: 1px solid rgba(255, 255, 255, 0.12);
  font-size: 0.72rem;
  line-height: 1.2;
}

.selected-photo-card__meta {
  display: flex;
  align-items: center;
  min-width: 0;
  padding: 0 10px;
  border-top: 1px solid rgba(255, 255, 255, 0.07);
  color: rgba(223, 240, 235, 0.9);
  background: rgba(3, 10, 13, 0.78);
  font-size: 0.8rem;
  text-align: left;
}

.selected-photo-card__meta span {
  display: block;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.selected-photo-card__checkbox {
  position: absolute;
  top: 8px;
  left: 8px;
  z-index: 1;
  width: 18px;
  height: 18px;
  border-radius: 4px;
  border: 1px solid rgba(223, 240, 235, 0.78);
  background: rgba(3, 10, 13, 0.72);
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.28);
}

.selected-photo-card:hover .selected-photo-card__checkbox {
  border-color: var(--accent);
}

.selected-photo-card__checkbox--checked {
  border-color: var(--accent);
  background: var(--accent);
}

.selected-photo-card__checkbox--checked::after {
  content: "";
  position: absolute;
  left: 5px;
  top: 2px;
  width: 5px;
  height: 9px;
  border: solid #031113;
  border-width: 0 2px 2px 0;
  transform: rotate(45deg);
}

.selected-download__empty {
  grid-row: 4;
  min-height: 0;
  height: 100%;
  padding: 24px 12px;
  display: grid;
  align-self: stretch;
  place-items: center;
  color: var(--muted);
  text-align: center;
}

.selected-spin {
  position: relative;
  display: inline-block;
  color: var(--accent);
  animation: selected-spin-rotate 1.05s linear infinite;
}

.selected-spin span {
  position: absolute;
  width: 32%;
  height: 32%;
  border-radius: 999px;
  background: currentColor;
  opacity: 1;
}

.selected-spin span:nth-child(1) {
  top: 0;
  left: 50%;
  transform: translateX(-50%);
}

.selected-spin span:nth-child(2) {
  top: 50%;
  right: 0;
  transform: translateY(-50%);
  opacity: 0.72;
}

.selected-spin span:nth-child(3) {
  bottom: 0;
  left: 50%;
  transform: translateX(-50%);
  opacity: 0.46;
}

.selected-spin span:nth-child(4) {
  top: 50%;
  left: 0;
  transform: translateY(-50%);
  opacity: 0.24;
}

.selected-spin--large {
  width: 34px;
  height: 34px;
}

@keyframes selected-spin-rotate {
  to {
    transform: rotate(360deg);
  }
}

@media (prefers-reduced-motion: reduce) {
  .selected-spin,
  .selected-photo-card__loading,
  .selected-photo-card__loading::after {
    animation: none;
  }
}

@media (max-width: 720px) {
  .selected-photo-grid {
    grid-template-columns: repeat(auto-fill, minmax(138px, 1fr));
    gap: 10px;
  }

  .selected-photo-card {
    height: 154px;
    grid-template-rows: minmax(0, 1fr) 28px;
    border-radius: 10px;
  }

  .selected-photo-card__meta {
    min-height: 28px;
    padding: 0 9px;
    font-size: 0.74rem;
  }
}
</style>
