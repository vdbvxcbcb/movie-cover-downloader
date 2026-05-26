<script setup lang="ts">
import ActionButton from "../../common/ActionButton.vue";
import type { AspectRatio, OutputFormat, SlotImage } from "../../composables/types";

interface ImageProcessSettings {
  ratio: AspectRatio;
  borderTop: number;
  borderRight: number;
  borderBottom: number;
  borderLeft: number;
  gap: number;
  radius: number;
  backgroundColor: string;
  backgroundUrl: string;
  backgroundName: string;
  backgroundOpacity: number;
  backgroundOverlay: boolean;
}

defineProps<{
  settings: ImageProcessSettings;
  ratios: readonly AspectRatio[];
  selectedSlotImage: SlotImage | null;
  selectedImageOpacity: number;
  outputRootDir: string;
  browsingOutputDirectory: boolean;
  saving: boolean;
  exportDebouncing: boolean;
}>();

const emit = defineEmits<{
  <K extends keyof ImageProcessSettings>(event: "updateSetting", key: K, value: ImageProcessSettings[K]): void;
  (event: "updateSelectedImageOpacity", value: number): void;
  (event: "resetBackgroundColor"): void;
  (event: "selectBackgroundFile"): void;
  (event: "removeBackgroundImage"): void;
  (event: "updateOutputRootDir", value: string): void;
  (event: "browseOutputDirectory"): void;
  (event: "exportImage", format: OutputFormat): void;
}>();

function updateNumberSetting<K extends keyof ImageProcessSettings>(key: K, value: string) {
  emit("updateSetting", key, Number(value) as ImageProcessSettings[K]);
}
</script>

<template>
  <div class="sidebar-content settings-sidebar__content">
    <section class="settings-section">
      <h4>画布</h4>
      <label class="field compact-field">
        <span>比例</span>
        <select :value="settings.ratio" @change="emit('updateSetting', 'ratio', ($event.target as HTMLSelectElement).value as AspectRatio)">
          <option v-for="ratio in ratios" :key="ratio" :value="ratio">{{ ratio }}</option>
        </select>
      </label>
    </section>

    <section class="settings-section">
      <h4>边框</h4>
      <div class="number-grid">
        <label><span>上</span><input :value="settings.borderTop" type="number" min="0" max="220" @input="updateNumberSetting('borderTop', ($event.target as HTMLInputElement).value)" /></label>
        <label><span>右</span><input :value="settings.borderRight" type="number" min="0" max="220" @input="updateNumberSetting('borderRight', ($event.target as HTMLInputElement).value)" /></label>
        <label><span>下</span><input :value="settings.borderBottom" type="number" min="0" max="220" @input="updateNumberSetting('borderBottom', ($event.target as HTMLInputElement).value)" /></label>
        <label><span>左</span><input :value="settings.borderLeft" type="number" min="0" max="220" @input="updateNumberSetting('borderLeft', ($event.target as HTMLInputElement).value)" /></label>
      </div>
      <label class="range-field">
        <span>间距 {{ settings.gap }}px</span>
        <input :value="settings.gap" type="range" min="0" max="60" @input="updateNumberSetting('gap', ($event.target as HTMLInputElement).value)" />
      </label>
      <label class="range-field">
        <span>圆角 {{ settings.radius }}px</span>
        <input :value="settings.radius" type="range" min="0" max="80" @input="updateNumberSetting('radius', ($event.target as HTMLInputElement).value)" />
      </label>
    </section>

    <section class="settings-section">
      <h4>背景</h4>
      <div class="color-field">
        <span>背景色</span>
        <div class="color-field__actions">
          <input :value="settings.backgroundColor" type="color" aria-label="背景色" @input="emit('updateSetting', 'backgroundColor', ($event.target as HTMLInputElement).value)" />
          <ActionButton label="重置背景色" size="sm" @click="emit('resetBackgroundColor')" />
        </div>
      </div>
      <label class="range-field">
        <span>背景图透明度 {{ settings.backgroundUrl ? `${settings.backgroundOpacity}%` : "未上传" }}</span>
        <input
          :value="settings.backgroundOpacity"
          type="range"
          min="0"
          max="100"
          :disabled="!settings.backgroundUrl"
          @input="updateNumberSetting('backgroundOpacity', ($event.target as HTMLInputElement).value)"
        />
      </label>
      <div class="setting-actions">
        <ActionButton label="上传背景图" size="sm" @click="emit('selectBackgroundFile')" />
        <ActionButton
          :label="settings.backgroundOverlay ? '取消' : '重叠'"
          :variant="settings.backgroundOverlay ? 'primary' : 'ghost'"
          size="sm"
          :disabled="!settings.backgroundUrl"
          @click="emit('updateSetting', 'backgroundOverlay', !settings.backgroundOverlay)"
        />
        <ActionButton label="移除" size="sm" :disabled="!settings.backgroundUrl" @click="emit('removeBackgroundImage')" />
      </div>
      <p v-if="settings.backgroundName" class="setting-meta">{{ settings.backgroundName }}</p>
    </section>

    <section class="settings-section">
      <h4>图片</h4>
      <label class="range-field">
        <span>图片透明度 {{ selectedSlotImage ? `${selectedImageOpacity}%` : "未选择" }}</span>
        <input
          :value="selectedImageOpacity"
          type="range"
          min="20"
          max="100"
          :disabled="!selectedSlotImage"
          @input="emit('updateSelectedImageOpacity', Number(($event.target as HTMLInputElement).value))"
        />
      </label>
      <p class="setting-meta">{{ selectedSlotImage ? selectedSlotImage.name : "点击画布中的某一张图片后，可单独调整透明度。" }}</p>
    </section>

    <section class="settings-section">
      <h4>导出</h4>
      <label class="field compact-field">
        <span>图片输出目录</span>
        <div class="field-inline">
          <input :value="outputRootDir" placeholder="例如：D:\cover" @input="emit('updateOutputRootDir', ($event.target as HTMLInputElement).value)" />
          <ActionButton label="浏览" size="sm" :disabled="browsingOutputDirectory" @click="emit('browseOutputDirectory')" />
        </div>
      </label>
      <div class="export-actions">
        <ActionButton label="导出 JPG" variant="primary" :disabled="saving || exportDebouncing" @click="emit('exportImage', 'jpg')" />
        <ActionButton label="导出 PNG" :disabled="saving || exportDebouncing" @click="emit('exportImage', 'png')" />
      </div>
    </section>
  </div>
</template>

<style scoped>
.settings-sidebar__content {
  display: grid;
  align-content: start;
  gap: 12px;
}

.settings-section {
  display: grid;
  gap: 12px;
  padding: 12px;
  border: 1px solid rgba(255, 255, 255, 0.055);
  border-radius: 14px;
  background: rgba(2, 10, 12, 0.24);
}

.settings-section h4 {
  color: var(--muted);
  font-size: 0.84rem;
  font-weight: 500;
}

.compact-field {
  margin: 0;
}

.number-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}

.number-grid label,
.range-field,
.color-field {
  display: grid;
  gap: 6px;
  color: var(--muted);
  font-size: 0.82rem;
}

.number-grid input,
.compact-field input,
.compact-field select {
  min-width: 0;
}

.number-grid input {
  width: 100%;
  padding: 8px 9px;
  border: 1px solid var(--line);
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.04);
  color: var(--text);
  outline: none;
}

.range-field input {
  width: 100%;
  accent-color: var(--accent);
}

.color-field {
  grid-template-columns: minmax(0, 1fr);
  align-items: center;
}

.color-field__actions {
  display: flex;
  align-items: center;
  justify-content: stretch;
  gap: 8px;
  min-width: 0;
}

.color-field input {
  flex: 0 0 52px;
  width: 52px;
  height: 38px;
  padding: 2px;
  border: 1px solid var(--line);
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.04);
}

.color-field__actions :deep(.action-btn) {
  flex: 1 1 auto;
  min-height: 38px;
  padding-top: 0;
  padding-bottom: 0;
  white-space: nowrap;
}

.setting-actions,
.export-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.setting-meta {
  overflow: hidden;
  color: var(--muted);
  font-size: 0.8rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.export-actions :deep(.action-btn) {
  flex: 1 1 120px;
}
</style>
