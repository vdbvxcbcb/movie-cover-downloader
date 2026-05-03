<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from "vue";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import type { UnlistenFn } from "@tauri-apps/api/event";
import ActionButton from "../common/ActionButton.vue";
import { runtimeBridge } from "../../lib/runtime-bridge";

type CropRatio = "9:16" | "3:4";
type ResizeHandle = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";
type DragMode = "move" | ResizeHandle;

const cropHandles: ResizeHandle[] = ["n", "s", "e", "w", "ne", "nw", "se", "sw"];
let unlistenDragDrop: UnlistenFn | null = null;

const props = defineProps<{
  outputRootDir: string;
}>();

const emit = defineEmits<{
  close: [];
}>();

const fileInput = ref<HTMLInputElement | null>(null);
const workspace = ref<HTMLElement | null>(null);
const imageElement = ref<HTMLImageElement | null>(null);
const isDraggingFile = ref(false);
const selectedRatio = ref<CropRatio>("9:16");
const zoom = ref(1);
const alertMessage = ref("");
const savedOutputPath = ref("");
const saving = ref(false);

const imageState = reactive({
  url: "",
  name: "",
  naturalWidth: 0,
  naturalHeight: 0,
  baseScale: 1,
  width: 0,
  height: 0,
  x: 0,
  y: 0,
});

const crop = reactive({
  x: 0,
  y: 0,
  width: 260,
  height: 462,
});

const dragState = reactive<{
  active: boolean;
  mode: DragMode;
  startX: number;
  startY: number;
  cropX: number;
  cropY: number;
  cropWidth: number;
  cropHeight: number;
}>({
  active: false,
  mode: "move",
  startX: 0,
  startY: 0,
  cropX: 0,
  cropY: 0,
  cropWidth: 0,
  cropHeight: 0,
});

const hasImage = computed(() => Boolean(imageState.url));
const ratioValue = computed(() => (selectedRatio.value === "3:4" ? 3 / 4 : 9 / 16));
const zoomLabel = computed(() => `${zoom.value.toFixed(1)}x`);
const cropSizeLabel = computed(() => `${Math.round(crop.width / displayScale())} x ${Math.round(crop.height / displayScale())}`);
const customCropOutputDir = computed(() => `${props.outputRootDir.replace(/[\\/]+$/, "")}/custom-crop-photo`);
const cropDimStyles = computed(() => {
  const bounds = imageBounds();
  const cropRight = crop.x + crop.width;
  const cropBottom = crop.y + crop.height;

  return {
    top: rectStyle(bounds.left, bounds.top, bounds.width, crop.y - bounds.top),
    left: rectStyle(bounds.left, crop.y, crop.x - bounds.left, crop.height),
    right: rectStyle(cropRight, crop.y, bounds.right - cropRight, crop.height),
    bottom: rectStyle(bounds.left, cropBottom, bounds.width, bounds.bottom - cropBottom),
  };
});


function showAlert(message: string, filePath = "") {
  alertMessage.value = message;
  savedOutputPath.value = filePath;
}

function clearAlert() {
  alertMessage.value = "";
  savedOutputPath.value = "";
}

async function revealSavedFile() {
  if (!savedOutputPath.value) return;

  try {
    await runtimeBridge.revealFilePath(savedOutputPath.value);
  } catch (error) {
    showAlert(error instanceof Error ? error.message : String(error));
  }
}

function displayScale() {
  return imageState.baseScale * zoom.value || 1;
}

function imageBounds() {
  return {
    left: imageState.x,
    top: imageState.y,
    right: imageState.x + imageState.width,
    bottom: imageState.y + imageState.height,
    width: imageState.width,
    height: imageState.height,
  };
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function rectStyle(left: number, top: number, width: number, height: number) {
  return {
    width: `${Math.max(0, width)}px`,
    height: `${Math.max(0, height)}px`,
    transform: `translate(${left}px, ${top}px)`,
  };
}

function clampCropToImage() {
  const bounds = imageBounds();
  const maxWidth = Math.max(80, bounds.width);
  const maxHeight = Math.max(80, bounds.height);
  crop.width = Math.min(crop.width, maxWidth);
  crop.height = crop.width / ratioValue.value;
  if (crop.height > maxHeight) {
    crop.height = maxHeight;
    crop.width = crop.height * ratioValue.value;
  }
  crop.x = clamp(crop.x, bounds.left, bounds.right - crop.width);
  crop.y = clamp(crop.y, bounds.top, bounds.bottom - crop.height);
}

function updateImageLayout(resetCrop = false) {
  if (!workspace.value || !imageState.naturalWidth || !imageState.naturalHeight) return;

  const rect = workspace.value.getBoundingClientRect();
  const maxWidth = Math.max(320, rect.width - 48);
  const maxHeight = Math.max(280, rect.height - 48);
  imageState.baseScale = Math.min(maxWidth / imageState.naturalWidth, maxHeight / imageState.naturalHeight);
  imageState.width = imageState.naturalWidth * imageState.baseScale * zoom.value;
  imageState.height = imageState.naturalHeight * imageState.baseScale * zoom.value;
  imageState.x = (rect.width - imageState.width) / 2;
  imageState.y = (rect.height - imageState.height) / 2;

  if (resetCrop) {
    resetCropBox();
  }
}

function resetCropBox() {
  const bounds = imageBounds();
  const ratio = ratioValue.value;
  let nextWidth = Math.min(bounds.width * 0.7, bounds.height * 0.7 * ratio);
  let nextHeight = nextWidth / ratio;

  if (nextHeight > bounds.height * 0.7) {
    nextHeight = bounds.height * 0.7;
    nextWidth = nextHeight * ratio;
  }

  crop.width = Math.max(100, nextWidth);
  crop.height = crop.width / ratio;
  crop.x = bounds.left + (bounds.width - crop.width) / 2;
  crop.y = bounds.top + (bounds.height - crop.height) / 2;
  clampCropToImage();
}

function adjustCropRatio() {
  if (!hasImage.value) return;
  const centerX = crop.x + crop.width / 2;
  const centerY = crop.y + crop.height / 2;
  const ratio = ratioValue.value;
  let nextWidth = crop.width;
  let nextHeight = nextWidth / ratio;
  const bounds = imageBounds();

  if (nextHeight > bounds.height) {
    nextHeight = bounds.height * 0.8;
    nextWidth = nextHeight * ratio;
  }
  if (nextWidth > bounds.width) {
    nextWidth = bounds.width * 0.8;
    nextHeight = nextWidth / ratio;
  }

  crop.width = nextWidth;
  crop.height = nextHeight;
  crop.x = centerX - crop.width / 2;
  crop.y = centerY - crop.height / 2;
  clampCropToImage();
}

function fileNameFromPath(filePath: string) {
  return filePath.split(/[\\/]/).pop() ?? "dropped-image";
}

function inferImageMimeType(fileName: string) {
  const normalized = fileName.toLowerCase();
  if (normalized.endsWith(".png")) return "image/png";
  if (normalized.endsWith(".webp")) return "image/webp";
  if (normalized.endsWith(".gif")) return "image/gif";
  if (normalized.endsWith(".bmp")) return "image/bmp";
  return "image/jpeg";
}

function setImageSource(url: string, name: string) {
  if (imageState.url) {
    URL.revokeObjectURL(imageState.url);
  }

  imageState.url = url;
  imageState.name = name;
  zoom.value = 1;
  clearAlert();
}

function acceptImageBytes(bytes: Uint8Array, name: string) {
  const blob = new Blob([bytes], { type: inferImageMimeType(name) });
  setImageSource(URL.createObjectURL(blob), name);
}

async function acceptDroppedPath(filePath: string) {
  try {
    const bytes = await runtimeBridge.readLocalImageFile(filePath);
    acceptImageBytes(bytes, fileNameFromPath(filePath));
  } catch (error) {
    showAlert(error instanceof Error ? error.message : String(error));
  }
}
function openFilePicker() {
  fileInput.value?.click();
}

function acceptFile(file: File) {
  if (!file.type.startsWith("image/")) {
    showAlert("请选择图片文件。 ");
    return;
  }

  setImageSource(URL.createObjectURL(file), file.name);
}

function handleFileChange(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (file) acceptFile(file);
  input.value = "";
}

function handleDrop(event: DragEvent) {
  event.preventDefault();
  event.stopPropagation();
  isDraggingFile.value = false;
  const file = event.dataTransfer?.files?.[0];
  if (file) acceptFile(file);
}

function handleDragEnter(event: DragEvent) {
  event.preventDefault();
  event.stopPropagation();
  isDraggingFile.value = true;
}

function handleDragLeave(event: DragEvent) {
  event.preventDefault();
  event.stopPropagation();
  if (event.currentTarget === event.target) {
    isDraggingFile.value = false;
  }
}

async function handleImageLoaded() {
  if (!imageElement.value) return;
  imageState.naturalWidth = imageElement.value.naturalWidth;
  imageState.naturalHeight = imageElement.value.naturalHeight;
  await nextTick();
  updateImageLayout(true);
}

function startCropDrag(event: PointerEvent, mode: DragMode) {
  if (!hasImage.value) return;
  event.preventDefault();
  (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
  dragState.active = true;
  dragState.mode = mode;
  dragState.startX = event.clientX;
  dragState.startY = event.clientY;
  dragState.cropX = crop.x;
  dragState.cropY = crop.y;
  dragState.cropWidth = crop.width;
  dragState.cropHeight = crop.height;
  window.addEventListener("pointermove", handleCropDrag);
  window.addEventListener("pointerup", stopCropDrag, { once: true });
}

function resizeFromDrag(dx: number, dy: number) {
  const ratio = ratioValue.value;
  let width = dragState.cropWidth;

  if (dragState.mode.includes("e")) width = dragState.cropWidth + dx;
  if (dragState.mode.includes("w")) width = dragState.cropWidth - dx;
  if (dragState.mode.includes("s")) width = Math.max(width, (dragState.cropHeight + dy) * ratio);
  if (dragState.mode.includes("n")) width = Math.max(width, (dragState.cropHeight - dy) * ratio);

  width = Math.max(90, width);
  let height = width / ratio;
  const bounds = imageBounds();
  const maxWidth = Math.min(bounds.width, bounds.height * ratio);
  if (width > maxWidth) {
    width = maxWidth;
    height = width / ratio;
  }

  let x = dragState.cropX;
  let y = dragState.cropY;
  if (dragState.mode.includes("w")) x = dragState.cropX + dragState.cropWidth - width;
  if (dragState.mode.includes("n")) y = dragState.cropY + dragState.cropHeight - height;

  crop.width = width;
  crop.height = height;
  crop.x = x;
  crop.y = y;
  clampCropToImage();
}

function handleCropDrag(event: PointerEvent) {
  if (!dragState.active) return;
  const dx = event.clientX - dragState.startX;
  const dy = event.clientY - dragState.startY;

  if (dragState.mode === "move") {
    crop.x = dragState.cropX + dx;
    crop.y = dragState.cropY + dy;
    clampCropToImage();
    return;
  }

  resizeFromDrag(dx, dy);
}

function stopCropDrag() {
  dragState.active = false;
  window.removeEventListener("pointermove", handleCropDrag);
}

function buildOutputFileName() {
  const stamp = new Date()
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "")
    .replace("T", "-");
  return `custom-crop-${stamp}-${selectedRatio.value.replace(":", "x")}.png`;
}

async function renderCropBlob() {
  if (!imageElement.value || !hasImage.value) {
    throw new Error("请先上传图片。 ");
  }

  const scale = displayScale();
  const sourceX = Math.round((crop.x - imageState.x) / scale);
  const sourceY = Math.round((crop.y - imageState.y) / scale);
  const sourceWidth = Math.round(crop.width / scale);
  const sourceHeight = Math.round(crop.height / scale);

  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, sourceWidth);
  canvas.height = Math.max(1, sourceHeight);
  const context = canvas.getContext("2d");
  if (!context) throw new Error("无法创建裁剪画布。 ");

  context.drawImage(
    imageElement.value,
    sourceX,
    sourceY,
    sourceWidth,
    sourceHeight,
    0,
    0,
    canvas.width,
    canvas.height,
  );

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("生成裁剪图片失败。 "));
    }, "image/png");
  });
}

async function downloadCrop() {
  if (saving.value) return;
  saving.value = true;
  clearAlert();

  try {
    const blob = await renderCropBlob();
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const outputPath = await runtimeBridge.saveCustomCroppedImage(props.outputRootDir, buildOutputFileName(), bytes);
    showAlert("已保存到", outputPath);
  } catch (error) {
    showAlert(error instanceof Error ? error.message : String(error));
  } finally {
    saving.value = false;
  }
}

onMounted(async () => {
  if (!runtimeBridge.isNativeRuntime()) return;

  unlistenDragDrop = await getCurrentWebview().onDragDropEvent((event) => {
    if (event.payload.type === "enter" || event.payload.type === "over") {
      isDraggingFile.value = true;
      return;
    }

    if (event.payload.type === "leave") {
      isDraggingFile.value = false;
      return;
    }

    isDraggingFile.value = false;
    const filePath = event.payload.paths[0];
    if (filePath) {
      void acceptDroppedPath(filePath);
    }
  });
});
watch(selectedRatio, adjustCropRatio);
watch(zoom, () => updateImageLayout(false));

onBeforeUnmount(() => {
  if (imageState.url) URL.revokeObjectURL(imageState.url);
  window.removeEventListener("pointermove", handleCropDrag);
  void unlistenDragDrop?.();
});
</script>

<template>
  <div class="modal-backdrop">
    <section class="modal-card custom-crop-modal">
      <div class="panel__head modal-card__head">
        <div>
          <p class="eyebrow">Custom Crop</p>
          <h3>自定义裁剪</h3>
        </div>
        <button type="button" class="modal-close" aria-label="关闭弹窗" @click="emit('close')">×</button>
      </div>

      <div v-if="alertMessage" class="crop-alert" role="alert">
        <div class="crop-alert__content">
          <span>{{ alertMessage }}</span>
          <button v-if="savedOutputPath" type="button" class="crop-alert__path" title="打开到下载图片所在目录并选中下载完成的图片" @click="void revealSavedFile()">{{ savedOutputPath }}</button>
        </div>
        <button type="button" class="crop-alert__close" aria-label="关闭提示" @click="clearAlert">×</button>
      </div>

      <div v-if="!hasImage" class="upload-dropzone" :class="{ 'upload-dropzone--active': isDraggingFile }" @click="openFilePicker" @dragenter="handleDragEnter" @dragover="handleDragEnter" @dragleave="handleDragLeave" @drop="handleDrop">
        <div class="upload-dropzone__icon">＋</div>
        <strong>点击或拖拽图片到这里上传</strong>
        <span>支持本地 PNG、JPG、WEBP 等图片文件</span>
      </div>

      <div v-else class="cropper-layout">
        <div ref="workspace" class="crop-workspace">
          <img
            ref="imageElement"
            class="crop-source-image"
            :src="imageState.url"
            :style="{ width: `${imageState.width}px`, height: `${imageState.height}px`, transform: `translate(${imageState.x}px, ${imageState.y}px)` }"
            alt="待裁剪图片"
            @load="void handleImageLoaded()"
          />
          <div class="crop-dim" :style="cropDimStyles.top"></div>
          <div class="crop-dim" :style="cropDimStyles.left"></div>
          <div class="crop-dim" :style="cropDimStyles.right"></div>
          <div class="crop-dim" :style="cropDimStyles.bottom"></div>

          <div
            class="crop-frame"
            :style="{ width: `${crop.width}px`, height: `${crop.height}px`, transform: `translate(${crop.x}px, ${crop.y}px)` }"
            @pointerdown="startCropDrag($event, 'move')"
          >
            <span class="crop-grid crop-grid--v1"></span>
            <span class="crop-grid crop-grid--v2"></span>
            <span class="crop-grid crop-grid--h1"></span>
            <span class="crop-grid crop-grid--h2"></span>
            <button v-for="handle in cropHandles" :key="handle" type="button" class="crop-handle" :class="`crop-handle--${handle}`" @pointerdown.stop="startCropDrag($event, handle)" />
          </div>
        </div>

        <aside class="crop-sidebar">
          <label class="field crop-field">
            <span>宽高比</span>
            <select v-model="selectedRatio">
              <option value="9:16">9:16</option>
              <option value="3:4">3:4</option>
            </select>
          </label>

          <div class="crop-meta">
            <span>原图：{{ imageState.naturalWidth }} x {{ imageState.naturalHeight }}</span>
            <span>裁剪：{{ cropSizeLabel }}</span>
            <span>输出：{{ customCropOutputDir }}</span>
          </div>

          <label class="crop-slider">
            <span>缩放 <strong>{{ zoomLabel }}</strong></span>
            <input v-model.number="zoom" type="range" min="1" max="3" step="0.1" />
          </label>

          <button type="button" class="upload-mini" @click="openFilePicker">重新上传</button>
        </aside>
      </div>

      <input ref="fileInput" class="visually-hidden" type="file" accept="image/*" @change="handleFileChange" />

      <div class="topbar__actions crop-actions">
        <ActionButton label="取消" @click="emit('close')" />
        <ActionButton label="下载" variant="primary" :disabled="!hasImage || saving" @click="void downloadCrop()" />
      </div>
    </section>
  </div>
</template>

<style scoped>
.custom-crop-modal {
  width: min(1180px, 100%);
  max-height: calc(100vh - 48px);
  overflow: auto;
}

.crop-alert {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 14px;
  padding: 10px 12px 10px 14px;
  border: 1px solid rgba(77, 212, 198, 0.24);
  border-radius: 12px;
  background: rgba(77, 212, 198, 0.08);
  color: var(--text);
}

.crop-alert__content {
  display: flex;
  min-width: 0;
  gap: 4px;
  align-items: center;
  flex-wrap: wrap;
}

.crop-alert__path,
.crop-alert__close {
  border: 0;
  background: transparent;
  color: inherit;
}

.crop-alert__path {
  min-width: 0;
  padding: 0;
  color: var(--text);
  cursor: pointer;
  text-align: left;
  word-break: break-all;
}

.crop-alert__path:hover {
  color: var(--accent);
  text-decoration: underline;
}

.crop-alert__close {
  display: grid;
  place-items: center;
  flex: 0 0 auto;
  width: 24px;
  height: 24px;
  border-radius: 8px;
  color: var(--muted);
  cursor: pointer;
  font-size: 18px;
  line-height: 1;
}

.crop-alert__close:hover {
  background: rgba(255, 255, 255, 0.08);
  color: var(--text);
}

.upload-dropzone {
  display: grid;
  place-items: center;
  gap: 12px;
  min-height: 300px;
  margin-bottom: 18px;
  border: 1px dashed rgba(77, 212, 198, 0.48);
  border-radius: 18px;
  background: rgba(255, 255, 255, 0.03);
  color: var(--muted);
  text-align: center;
  cursor: pointer;
  transition: border-color 160ms ease, background 160ms ease;
}

.upload-dropzone strong {
  color: var(--text);
  font-size: 1.05rem;
}

.upload-dropzone--active {
  border-color: var(--accent);
  background: rgba(77, 212, 198, 0.1);
}

.upload-dropzone__icon {
  display: grid;
  place-items: center;
  width: 54px;
  height: 54px;
  border-radius: 16px;
  border: 1px solid rgba(77, 212, 198, 0.34);
  color: var(--accent);
  font-size: 2rem;
}

.cropper-layout {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 250px;
  gap: 18px;
  margin-bottom: 18px;
}

.crop-workspace {
  position: relative;
  min-height: 560px;
  overflow: hidden;
  border: 1px solid var(--line);
  border-radius: 18px;
  background: rgba(255, 255, 255, 0.05);
  user-select: none;
}

.crop-source-image {
  position: absolute;
  inset: 0 auto auto 0;
  transform-origin: top left;
  pointer-events: none;
}

.crop-dim {
  position: absolute;
  inset: 0 auto auto 0;
  background: rgba(2, 10, 12, 0.54);
  pointer-events: none;
  transform-origin: top left;
}

.crop-frame {
  position: absolute;
  inset: 0 auto auto 0;
  border: 2px solid #4d68ff;
  cursor: move;
  box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.58) inset;
}

.crop-grid {
  position: absolute;
  background: rgba(255, 255, 255, 0.7);
  pointer-events: none;
}

.crop-grid--v1,
.crop-grid--v2 {
  top: 0;
  bottom: 0;
  width: 1px;
}

.crop-grid--v1 {
  left: 33.333%;
}

.crop-grid--v2 {
  left: 66.666%;
}

.crop-grid--h1,
.crop-grid--h2 {
  left: 0;
  right: 0;
  height: 1px;
}

.crop-grid--h1 {
  top: 33.333%;
}

.crop-grid--h2 {
  top: 66.666%;
}

.crop-handle {
  position: absolute;
  width: 14px;
  height: 14px;
  border: 2px solid #4d68ff;
  border-radius: 4px;
  background: #f5f8ff;
}

.crop-handle--n,
.crop-handle--s {
  left: 50%;
  margin-left: -7px;
  cursor: ns-resize;
}

.crop-handle--e,
.crop-handle--w {
  top: 50%;
  margin-top: -7px;
  cursor: ew-resize;
}

.crop-handle--n,
.crop-handle--ne,
.crop-handle--nw {
  top: -8px;
}

.crop-handle--s,
.crop-handle--se,
.crop-handle--sw {
  bottom: -8px;
}

.crop-handle--e,
.crop-handle--ne,
.crop-handle--se {
  right: -8px;
}

.crop-handle--w,
.crop-handle--nw,
.crop-handle--sw {
  left: -8px;
}

.crop-handle--ne,
.crop-handle--sw {
  cursor: nesw-resize;
}

.crop-handle--nw,
.crop-handle--se {
  cursor: nwse-resize;
}

.crop-sidebar {
  display: grid;
  align-content: start;
  gap: 16px;
  min-width: 0;
}

.crop-field {
  gap: 8px;
}

.crop-meta {
  display: grid;
  gap: 8px;
  color: var(--muted);
  font-size: 0.86rem;
  line-height: 1.5;
  word-break: break-all;
}

.crop-slider {
  display: grid;
  gap: 8px;
  color: var(--muted);
}

.crop-slider span {
  display: flex;
  justify-content: space-between;
}

.crop-slider input {
  width: 100%;
  accent-color: var(--accent);
}

.upload-mini {
  height: 42px;
  border: 1px solid var(--line);
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.04);
  color: var(--text);
}

.crop-actions {
  justify-content: flex-end;
}

.visually-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
}

@media (max-width: 1100px) {
  .cropper-layout {
    grid-template-columns: 1fr;
  }

  .crop-workspace {
    min-height: 460px;
  }
}
</style>




