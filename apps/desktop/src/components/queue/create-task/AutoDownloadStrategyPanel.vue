<script setup lang="ts">
import type { DoubanAssetType, ImageAspectRatio, ImageCountMode } from "../../../types/app";

defineProps<{
  doubanAssetType: DoubanAssetType;
  imageCountMode: ImageCountMode;
  maxImagesInput: string;
  imageAspectRatio: ImageAspectRatio;
  canDecreaseMaxImages: boolean;
  canIncreaseMaxImages: boolean;
}>();

const emit = defineEmits<{
  selectAssetType: [value: DoubanAssetType];
  selectCountMode: [value: ImageCountMode];
  maxImagesBlur: [event: Event];
  maxImagesInput: [event: Event];
  maxImagesKeydown: [event: KeyboardEvent];
  stepMaxImages: [delta: -1 | 1];
  selectAspectRatio: [value: ImageAspectRatio];
}>();
</script>

<template>
  <section class="strategy-card field--wide">
    <div class="strategy-grid">
      <div class="strategy-panel">
        <span class="create-task-modal__field-label">豆瓣抓图类型</span>
        <div class="segmented-control">
          <button
            type="button"
            class="segmented-control__item"
            :class="{ 'segmented-control__item--active': doubanAssetType === 'still' }"
            @click="emit('selectAssetType', 'still')"
          >
            剧照
          </button>
          <button
            type="button"
            class="segmented-control__item"
            :class="{ 'segmented-control__item--active': doubanAssetType === 'poster' }"
            @click="emit('selectAssetType', 'poster')"
          >
            海报
          </button>
          <button
            type="button"
            class="segmented-control__item"
            :class="{ 'segmented-control__item--active': doubanAssetType === 'wallpaper' }"
            @click="emit('selectAssetType', 'wallpaper')"
          >
            壁纸
          </button>
        </div>
        <p class="field-hint field-hint--spacer" aria-hidden="true">&nbsp;</p>
      </div>

      <div class="strategy-panel">
        <span class="create-task-modal__field-label">数量（张）</span>
        <div class="quantity-control-row">
          <div class="segmented-control">
            <button
              type="button"
              class="segmented-control__item"
              :class="{ 'segmented-control__item--active': imageCountMode === 'limited' }"
              @click="emit('selectCountMode', 'limited')"
            >
              限制
            </button>
            <button
              type="button"
              class="segmented-control__item"
              :class="{ 'segmented-control__item--active': imageCountMode === 'unlimited' }"
              @click="emit('selectCountMode', 'unlimited')"
            >
              无限制
            </button>
          </div>
          <div v-if="imageCountMode === 'limited'" class="quantity-field">
            <div class="number-stepper">
              <button
                type="button"
                class="number-stepper__control"
                :disabled="!canDecreaseMaxImages"
                aria-label="减少下载数量"
                @click="emit('stepMaxImages', -1)"
              >
                -
              </button>
              <input
                :value="maxImagesInput"
                type="text"
                min="1"
                max="100"
                step="1"
                inputmode="numeric"
                placeholder="默认 10"
                @blur="emit('maxImagesBlur', $event)"
                @input="emit('maxImagesInput', $event)"
                @keydown="emit('maxImagesKeydown', $event)"
              />
              <button
                type="button"
                class="number-stepper__control"
                :disabled="!canIncreaseMaxImages"
                aria-label="增加下载数量"
                @click="emit('stepMaxImages', 1)"
              >
                +
              </button>
            </div>
          </div>
        </div>
        <p v-if="imageCountMode === 'unlimited'" class="field-hint">将抓取当前分类页可发现的全部图片，不再显示数量输入。</p>
        <p v-else class="field-hint field-hint--spacer" aria-hidden="true">&nbsp;</p>
      </div>

      <div class="strategy-panel">
        <span class="create-task-modal__field-label">图片尺寸</span>
        <div class="segmented-control">
          <button
            type="button"
            class="segmented-control__item"
            :class="{ 'segmented-control__item--active': imageAspectRatio === 'original' }"
            @click="emit('selectAspectRatio', 'original')"
          >
            原图尺寸
          </button>
          <button
            type="button"
            class="segmented-control__item"
            :class="{ 'segmented-control__item--active': imageAspectRatio === '9:16' }"
            @click="emit('selectAspectRatio', '9:16')"
          >
            9:16
          </button>
          <button
            type="button"
            class="segmented-control__item"
            :class="{ 'segmented-control__item--active': imageAspectRatio === '3:4' }"
            @click="emit('selectAspectRatio', '3:4')"
          >
            3:4
          </button>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.create-task-modal__field-label {
  color: var(--muted);
  font-size: 0.84rem;
}

.strategy-card {
  display: grid;
  gap: 10px;
  padding: 10px;
  border: 1px solid var(--line);
  border-radius: 20px;
  background:
    linear-gradient(180deg, rgba(77, 212, 198, 0.05), transparent 100%),
    rgba(255, 255, 255, 0.03);
}

.strategy-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(360px, 1.15fr) minmax(0, 1fr);
  gap: 10px;
}

.strategy-panel {
  display: grid;
  align-content: start;
  gap: 8px;
  min-width: 0;
  padding: 10px;
  border: 1px solid rgba(255, 255, 255, 0.05);
  border-radius: 14px;
  background: rgba(4, 16, 19, 0.44);
}

.strategy-panel:first-child .segmented-control {
  align-self: start;
}

.field-hint {
  min-height: 1.65em;
  margin: 0;
  overflow: hidden;
  color: var(--muted);
  font-size: 0.84rem;
  line-height: 1.65;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.field-hint--spacer {
  display: none;
}

.quantity-control-row {
  display: flex;
  gap: 8px;
  align-items: flex-start;
  min-width: 0;
}

.quantity-control-row .segmented-control {
  flex: 0 0 auto;
}

.segmented-control {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
  align-items: flex-start;
}

.segmented-control__item {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 42px;
  min-width: 88px;
  padding: 0 16px;
  border: 1px solid var(--line);
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.03);
  color: var(--muted);
  transition: border-color 160ms ease, background 160ms ease, color 160ms ease, transform 160ms ease;
}

.segmented-control__item:hover {
  border-color: var(--line-strong);
  color: var(--text);
  transform: translateY(-1px);
}

.segmented-control__item--active {
  color: #031113;
  border-color: transparent;
  background: linear-gradient(135deg, var(--accent), #7ce5c9);
  box-shadow: 0 10px 24px rgba(77, 212, 198, 0.2);
}

.quantity-field {
  flex: 1 1 180px;
  min-width: 176px;
  max-width: 186px;
}

.number-stepper {
  display: grid;
  grid-template-columns: 44px minmax(0, 1fr) 44px;
  align-items: stretch;
  width: 100%;
  min-height: 44px;
  overflow: hidden;
  border: 1px solid var(--line);
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.04);
}

.number-stepper:focus-within {
  border-color: var(--line-strong);
  box-shadow: 0 0 0 3px rgba(77, 212, 198, 0.12);
}

.number-stepper__control {
  display: grid;
  place-items: center;
  border: 0;
  border-right: 1px solid var(--line);
  background: rgba(255, 255, 255, 0.03);
  color: var(--muted);
  font-size: 1.05rem;
  line-height: 1;
  transition: background 160ms ease, color 160ms ease;
}

.number-stepper__control:last-child {
  border-right: 0;
  border-left: 1px solid var(--line);
}

.number-stepper__control:hover:not(:disabled) {
  color: var(--text);
  background: rgba(77, 212, 198, 0.1);
}

.number-stepper__control:disabled {
  cursor: not-allowed;
  opacity: 0.42;
}

.quantity-field .number-stepper input {
  min-width: 0;
  padding: 0 14px;
  border: 0;
  border-radius: 0;
  background: transparent;
  box-shadow: none;
  text-align: center;
}

.quantity-field .number-stepper input:focus {
  box-shadow: none;
  text-align: center;
}

@media (max-width: 1480px) {
  .strategy-grid {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
}

@media (max-width: 980px) {
  .strategy-grid {
    grid-template-columns: 1fr;
  }

  .strategy-card,
  .strategy-panel {
    padding: 8px;
  }

  .segmented-control__item {
    height: 38px;
    min-width: 78px;
    padding: 0 12px;
  }
}
</style>
