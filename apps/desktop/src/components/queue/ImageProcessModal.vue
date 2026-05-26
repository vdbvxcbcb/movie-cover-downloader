<script setup lang="ts">
// 图片拼版处理弹窗：固定预设布局、轻量标注和 canvas 导出。
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch, shallowRef, useTemplateRef } from "vue";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import type { UnlistenFn } from "@tauri-apps/api/event";
import type {
  AnnotationDragMode,
  AspectRatio,
  LayoutCell,
  NoticeTone,
  OutputFormat,
  SlotImage,
} from "../composables/types";
import { defaultBackgroundColor, ratios, strokeWidths } from "../composables/constants";
import ImageProcessLayoutPicker from "./image-process/ImageProcessLayoutPicker.vue";
import ImageProcessSettingsContent from "./image-process/ImageProcessSettingsContent.vue";
import ImageProcessToolStrip from "./image-process/ImageProcessToolStrip.vue";
import { useImageProcessAnnotations } from "../composables/useImageProcessAnnotations";
import { useImageProcessLayoutState } from "../composables/useImageProcessLayoutState";
import { useImageProcessSlotImages } from "../composables/useImageProcessSlotImages";
import MessageNotice from "../common/MessageNotice.vue";
import { runtimeBridge } from "../../lib/runtime-bridge";

type ProcessBridge = typeof runtimeBridge & {
  saveProcessedImage?: (
    outputRootDir: string,
    fileName: string,
    imageBytes: Uint8Array,
    format: OutputFormat,
  ) => Promise<string>;
};

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

const props = defineProps<{
  outputRootDir: string;
}>();

const emit = defineEmits<{
  close: [];
  updateOutputRootDir: [value: string];
}>();

let unlistenDragDrop: UnlistenFn | null = null;
let exportDebounceTimer: number | null = null;
const fileInput = useTemplateRef<HTMLInputElement>("fileInput");
const backgroundInput = useTemplateRef<HTMLInputElement>("backgroundInput");
const previewBoard = useTemplateRef<HTMLElement>("previewBoard");
const activeSlotIndex = shallowRef(0);
const selectedSlotIndex = ref<number | null>(null);
const saving = shallowRef(false);
const exportDebouncing = shallowRef(false);
const browsingOutputDirectory = shallowRef(false);
const noticeMessage = shallowRef("");
const noticeTone = ref<NoticeTone>("warn");
const noticeRevision = shallowRef(0);
const savedOutputPath = shallowRef("");
const viewportHeight = ref(window.innerHeight);
const localOutputRootDir = ref(props.outputRootDir);
const leftSidebarCollapsed = shallowRef(false);
const rightSidebarCollapsed = shallowRef(false);

const settings = reactive<ImageProcessSettings>({
  ratio: "1:1",
  borderTop: 0,
  borderRight: 0,
  borderBottom: 0,
  borderLeft: 0,
  gap: 0,
  radius: 0,
  backgroundColor: defaultBackgroundColor,
  backgroundUrl: "",
  backgroundName: "",
  backgroundOpacity: 100,
  backgroundOverlay: false,
});

const { selectedLayoutId, selectedLayout, visibleCells, singleImageLayoutSelected, groupedLayouts } = useImageProcessLayoutState({
  activeSlotIndex,
  selectedSlotIndex,
});
const {
  slotImages,
  selectedSlotImage,
  selectedImageOpacity,
  draggedSlotIndex,
  hoveredSlotIndex,
  hasImages,
  acceptDroppedPath,
  openSlotFilePicker,
  handleSlotClick,
  handleSlotFileChange,
  handleSlotDrop,
  handleSlotDragEnter,
  handleSlotDragLeave,
  startSlotSwapDrag,
  removeSlotImage,
  zoomSlot,
  resetSlotZoom,
  shuffleImages,
  clearSlotImages,
  cleanupSlotImages,
  slotIndexFromDropPosition,
} = useImageProcessSlotImages({
  activeSlotIndex,
  selectedSlotIndex,
  visibleCells,
  previewBoard,
  bridge: runtimeBridge,
  createId,
  showNotice,
  clearNotice,
});
const {
  annotations,
  selectedAnnotationId,
  activeDrawingKind,
  addAnnotation,
  selectDrawingTool,
  clearAnnotations,
  annotationStyle,
  arrowHandleStyle,
  arrowSvgViewBox,
  arrowSvgCoordinate,
  arrowBodyEndCoordinate,
  arrowHeadPoints,
  shouldShowAnnotationToolbar,
  shouldShowArrowHandles,
  shouldShowResizeHandles,
  resizeHandlesFor,
  updateAnnotation,
  copyAnnotation,
  deleteAnnotation,
  startAnnotationDrag,
  startTextAnnotationPointer,
  editTextAnnotation,
  startAnnotationCreate,
  blockDrawingClick,
  cleanupAnnotationInteractions,
  arrowEndpoints,
} = useImageProcessAnnotations({
  previewBoard,
  createId,
});
const shouldContainSlotImages = computed(() => settings.ratio === "1:1" && singleImageLayoutSelected.value);
const aspectRatioValue = computed(() => {
  const [width, height] = settings.ratio.split(":").map(Number);
  return width / height;
});
const boardStyle = computed(() => ({
  aspectRatio: settings.ratio.replace(":", " / "),
  "--board-fit-width": `min(100%, ${Math.round(Math.max(320, Math.min(1240, (viewportHeight.value - 210) * aspectRatioValue.value)))}px)`,
  backgroundColor: settings.backgroundColor,
  "--background-image": settings.backgroundUrl ? `url(${settings.backgroundUrl})` : "none",
  "--background-opacity": String(settings.backgroundOpacity / 100),
  "--border-top": `${settings.borderTop}px`,
  "--border-right": `${settings.borderRight}px`,
  "--border-bottom": `${settings.borderBottom}px`,
  "--border-left": `${settings.borderLeft}px`,
  "--gap": `${settings.gap}px`,
  "--cell-radius": `${settings.radius}px`,
} as Record<string, string>));
const displaySavedOutputPath = computed(() => normalizeDisplayPath(savedOutputPath.value));
const layoutShellClass = computed(() => ({
  "image-process-layout--left-collapsed": leftSidebarCollapsed.value,
  "image-process-layout--right-collapsed": rightSidebarCollapsed.value,
}));
const drawingBoardClass = computed(() => ({
  "preview-board--drawing": Boolean(activeDrawingKind.value),
  "preview-board--draw-arrow": activeDrawingKind.value === "arrow",
  "preview-board--draw-rect": activeDrawingKind.value === "rect",
  "preview-board--draw-circle": activeDrawingKind.value === "circle",
  "preview-board--background-overlay": settings.backgroundOverlay && Boolean(settings.backgroundUrl),
}));

watch(
  () => props.outputRootDir,
  (value) => {
    if (value !== localOutputRootDir.value) {
      localOutputRootDir.value = value;
    }
  },
);

function showNotice(message: string, tone: NoticeTone = "warn") {
  noticeMessage.value = message;
  noticeTone.value = tone;
  noticeRevision.value += 1;
}

function clearNotice() {
  noticeMessage.value = "";
}

function clearSavedOutputPath() {
  savedOutputPath.value = "";
}

function normalizeDisplayPath(filePath: string) {
  return filePath.replace(/^\\\\\?\\/, "").replace(/^\/\/\?\//, "");
}

function updateViewportHeight() {
  viewportHeight.value = window.innerHeight;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function updateImageProcessSetting<K extends keyof ImageProcessSettings>(key: K, value: ImageProcessSettings[K]) {
  settings[key] = value;
}

function createId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function syncOutputRootDir(value: string) {
  localOutputRootDir.value = value;
  emit("updateOutputRootDir", value);
}

async function browseOutputDirectory() {
  if (browsingOutputDirectory.value) return;

  browsingOutputDirectory.value = true;
  try {
    const selected = await runtimeBridge.pickOutputDirectory(localOutputRootDir.value);
    if (!selected) return;
    syncOutputRootDir(selected);
    clearNotice();
  } catch (error) {
    showNotice(error instanceof Error ? error.message : String(error), "error");
  } finally {
    browsingOutputDirectory.value = false;
  }
}

function clearImagesAndAnnotations() {
  clearSlotImages();
  clearAnnotations();
}

function handleBackgroundFile(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  if (!file.type.startsWith("image/")) {
    showNotice("请选择背景图片文件。", "warn");
    input.value = "";
    return;
  }

  removeBackgroundImage();
  settings.backgroundUrl = URL.createObjectURL(file);
  settings.backgroundName = file.name;
  input.value = "";
}

function removeBackgroundImage() {
  if (settings.backgroundUrl) {
    URL.revokeObjectURL(settings.backgroundUrl);
  }
  settings.backgroundUrl = "";
  settings.backgroundName = "";
  settings.backgroundOverlay = false;
}

function resetBackgroundColor() {
  settings.backgroundColor = defaultBackgroundColor;
}

function cellStyle(cell: LayoutCell) {
  return {
    left: `${cell.x}%`,
    top: `${cell.y}%`,
    width: `${cell.w}%`,
    height: `${cell.h}%`,
  };
}

function imageStyle(image: SlotImage) {
  return {
    objectFit: shouldContainSlotImages.value ? ("scale-down" as const) : ("cover" as const),
    opacity: String(image.opacity / 100),
    transform: `scale(${image.scale})`,
  };
}

function getExportSize() {
  const ratio = aspectRatioValue.value;
  if (ratio >= 1) {
    return { width: 1800, height: Math.round(1800 / ratio) };
  }

  return { width: Math.round(1800 * ratio), height: 1800 };
}

function loadImage(url: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("图片加载失败。"));
    image.src = url;
  });
}

function roundedRect(context: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number) {
  const safeRadius = Math.min(radius, width / 2, height / 2);
  context.beginPath();
  context.moveTo(x + safeRadius, y);
  context.lineTo(x + width - safeRadius, y);
  context.quadraticCurveTo(x + width, y, x + width, y + safeRadius);
  context.lineTo(x + width, y + height - safeRadius);
  context.quadraticCurveTo(x + width, y + height, x + width - safeRadius, y + height);
  context.lineTo(x + safeRadius, y + height);
  context.quadraticCurveTo(x, y + height, x, y + height - safeRadius);
  context.lineTo(x, y + safeRadius);
  context.quadraticCurveTo(x, y, x + safeRadius, y);
  context.closePath();
}

function drawCoverImage(
  context: CanvasRenderingContext2D,
  image: HTMLImageElement,
  x: number,
  y: number,
  width: number,
  height: number,
  scale = 1,
) {
  const drawScale = Math.max(scale, 0.01);
  const imageRatio = image.naturalWidth / image.naturalHeight;
  const rectRatio = width / height;
  let sourceWidth = image.naturalWidth;
  let sourceHeight = image.naturalHeight;

  if (imageRatio > rectRatio) {
    sourceWidth = image.naturalHeight * rectRatio;
  } else {
    sourceHeight = image.naturalWidth / rectRatio;
  }

  sourceWidth /= drawScale;
  sourceHeight /= drawScale;
  const sourceX = (image.naturalWidth - sourceWidth) / 2;
  const sourceY = (image.naturalHeight - sourceHeight) / 2;
  context.drawImage(image, sourceX, sourceY, sourceWidth, sourceHeight, x, y, width, height);
}

function getScaleDownImageRect(
  image: HTMLImageElement,
  x: number,
  y: number,
  width: number,
  height: number,
  scale = 1,
  exportScaleX = 1,
  exportScaleY = 1,
) {
  const drawScale = Math.max(scale, 0.01);
  const previewWidth = width / Math.max(exportScaleX, 0.01);
  const previewHeight = height / Math.max(exportScaleY, 0.01);
  const fitScale = Math.min(1, previewWidth / image.naturalWidth, previewHeight / image.naturalHeight);
  const drawWidth = image.naturalWidth * fitScale * drawScale * exportScaleX;
  const drawHeight = image.naturalHeight * fitScale * drawScale * exportScaleY;
  return {
    x: x + (width - drawWidth) / 2,
    y: y + (height - drawHeight) / 2,
    width: drawWidth,
    height: drawHeight,
  };
}

function paintOutsideContainedImage(
  context: CanvasRenderingContext2D,
  imageRect: { x: number; y: number; width: number; height: number },
  x: number,
  y: number,
  width: number,
  height: number,
  fillStyle: string | null,
) {
  const imageLeft = clamp(imageRect.x, x, x + width);
  const imageTop = clamp(imageRect.y, y, y + height);
  const imageRight = clamp(imageRect.x + imageRect.width, x, x + width);
  const imageBottom = clamp(imageRect.y + imageRect.height, y, y + height);
  const topHeight = Math.max(0, imageTop - y);
  const bottomHeight = Math.max(0, y + height - imageBottom);
  const middleHeight = Math.max(0, imageBottom - imageTop);
  const leftWidth = Math.max(0, imageLeft - x);
  const rightWidth = Math.max(0, x + width - imageRight);
  const paintRect = fillStyle
    ? (rectX: number, rectY: number, rectWidth: number, rectHeight: number) => {
        context.fillStyle = fillStyle;
        context.fillRect(rectX, rectY, rectWidth, rectHeight);
      }
    : (rectX: number, rectY: number, rectWidth: number, rectHeight: number) => {
        context.clearRect(rectX, rectY, rectWidth, rectHeight);
      };

  if (topHeight > 0) paintRect(x, y, width, topHeight);
  if (bottomHeight > 0) paintRect(x, imageBottom, width, bottomHeight);
  if (leftWidth > 0 && middleHeight > 0) paintRect(x, imageTop, leftWidth, middleHeight);
  if (rightWidth > 0 && middleHeight > 0) paintRect(imageRight, imageTop, rightWidth, middleHeight);
}

async function renderCanvas(format: OutputFormat) {
  const { width, height } = getExportSize();
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("无法创建导出画布。");

  context.fillStyle = settings.backgroundColor;
  context.fillRect(0, 0, width, height);

  const backgroundImage = settings.backgroundUrl ? await loadImage(settings.backgroundUrl) : null;
  if (backgroundImage && !settings.backgroundOverlay) {
    context.save();
    context.globalAlpha = settings.backgroundOpacity / 100;
    drawCoverImage(context, backgroundImage, 0, 0, width, height);
    context.restore();
  }

  const scaleX = width / Math.max(1, previewBoard.value?.clientWidth ?? width);
  const scaleY = height / Math.max(1, previewBoard.value?.clientHeight ?? height);
  const borderTop = settings.borderTop * scaleY;
  const borderRight = settings.borderRight * scaleX;
  const borderBottom = settings.borderBottom * scaleY;
  const borderLeft = settings.borderLeft * scaleX;
  const gapX = settings.gap * scaleX;
  const gapY = settings.gap * scaleY;
  const radius = settings.radius * Math.min(scaleX, scaleY);
  const innerX = borderLeft;
  const innerY = borderTop;
  const innerWidth = Math.max(1, width - borderLeft - borderRight);
  const innerHeight = Math.max(1, height - borderTop - borderBottom);
  const shouldDrawContainImages = shouldContainSlotImages.value;
  const shouldPaintContainedPadding = shouldDrawContainImages && !backgroundImage;

  for (const [index, cell] of visibleCells.value.entries()) {
    const slotImage = slotImages.value[index];
    const x = innerX + (cell.x / 100) * innerWidth + gapX / 2;
    const y = innerY + (cell.y / 100) * innerHeight + gapY / 2;
    const cellWidth = Math.max(1, (cell.w / 100) * innerWidth - gapX);
    const cellHeight = Math.max(1, (cell.h / 100) * innerHeight - gapY);

    context.save();
    roundedRect(context, x, y, cellWidth, cellHeight, radius);
    context.clip();

    if (slotImage) {
      const image = await loadImage(slotImage.url);
      if (shouldDrawContainImages) {
        const imageRect = getScaleDownImageRect(image, x, y, cellWidth, cellHeight, slotImage.scale, scaleX, scaleY);
        if (shouldPaintContainedPadding) {
          paintOutsideContainedImage(context, imageRect, x, y, cellWidth, cellHeight, format === "jpg" ? "#ffffff" : null);
        }
        context.globalAlpha = slotImage.opacity / 100;
        context.drawImage(image, imageRect.x, imageRect.y, imageRect.width, imageRect.height);
      } else {
        context.globalAlpha = slotImage.opacity / 100;
        drawCoverImage(context, image, x, y, cellWidth, cellHeight, slotImage.scale);
      }
      context.globalAlpha = 1;
    } else {
      context.fillStyle = "rgba(255, 255, 255, 0.05)";
      context.fillRect(x, y, cellWidth, cellHeight);
    }
    context.restore();
  }

  if (backgroundImage && settings.backgroundOverlay) {
    context.save();
    context.globalAlpha = settings.backgroundOpacity / 100;
    drawCoverImage(context, backgroundImage, 0, 0, width, height);
    context.restore();
  }

  drawAnnotations(context, width, height);

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error("生成导出图片失败。"));
      },
      format === "jpg" ? "image/jpeg" : "image/png",
      0.92,
    );
  });
  return { blob, format };
}

function drawAnnotations(context: CanvasRenderingContext2D, width: number, height: number) {
  context.save();
  context.shadowColor = "rgba(0, 0, 0, 0.45)";
  context.shadowBlur = Math.round(width / 120);
  context.lineCap = "round";
  context.lineJoin = "round";
  const previewWidth = Math.max(1, previewBoard.value?.clientWidth ?? width);
  const scale = width / previewWidth;

  for (const annotation of annotations.value) {
    const x = annotation.x * width;
    const y = annotation.y * height;
    const w = annotation.w * width;
    const h = annotation.h * height;
    const lineWidth = Math.max(1, annotation.strokeWidth * scale);

    context.strokeStyle = annotation.color;
    context.fillStyle = annotation.color;
    context.lineWidth = lineWidth;

    if (annotation.kind === "text") {
      context.font = `700 ${Math.round(annotation.fontSize * scale)}px "Microsoft YaHei UI", sans-serif`;
      context.textBaseline = "top";
      context.fillText(annotation.text, x, y);
    } else if (annotation.kind === "arrow") {
      const endpoints = arrowEndpoints(annotation);
      const startX = endpoints.startX * width;
      const startY = endpoints.startY * height;
      const endX = endpoints.endX * width;
      const endY = endpoints.endY * height;
      const angle = Math.atan2(endY - startY, endX - startX);
      const headLength = clamp(lineWidth * 2.6, 8 * scale, 18 * scale);
      const headWidth = clamp(lineWidth * 1.9, 6 * scale, 14 * scale);
      const baseX = endX - headLength * Math.cos(angle);
      const baseY = endY - headLength * Math.sin(angle);
      const normalX = Math.cos(angle + Math.PI / 2);
      const normalY = Math.sin(angle + Math.PI / 2);
      context.beginPath();
      context.moveTo(startX, startY);
      context.lineTo(baseX, baseY);
      context.stroke();
      context.beginPath();
      context.moveTo(endX, endY);
      context.lineTo(baseX + (headWidth / 2) * normalX, baseY + (headWidth / 2) * normalY);
      context.lineTo(baseX - (headWidth / 2) * normalX, baseY - (headWidth / 2) * normalY);
      context.closePath();
      context.fill();
    } else if (annotation.kind === "rect") {
      context.save();
      context.translate(x + w / 2, y + h / 2);
      context.rotate(((annotation.rotation ?? 0) * Math.PI) / 180);
      context.strokeRect(-w / 2, -h / 2, w, h);
      context.restore();
    } else {
      context.save();
      context.translate(x + w / 2, y + h / 2);
      context.rotate(((annotation.rotation ?? 0) * Math.PI) / 180);
      context.beginPath();
      context.ellipse(0, 0, w / 2, h / 2, 0, 0, Math.PI * 2);
      context.stroke();
      context.restore();
    }
  }

  context.restore();
}

function buildFileName(format: OutputFormat) {
  const stamp = new Date()
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "")
    .replace("T", "-");
  return `image-process-${stamp}.${format}`;
}

async function revealSavedFile() {
  if (!savedOutputPath.value) return;

  try {
    await runtimeBridge.revealFilePath(savedOutputPath.value);
  } catch (error) {
    showNotice(error instanceof Error ? error.message : String(error), "error");
  }
}

function clearExportDebounce() {
  if (exportDebounceTimer !== null) {
    window.clearTimeout(exportDebounceTimer);
    exportDebounceTimer = null;
  }
  exportDebouncing.value = false;
}

function scheduleExportImage(format: OutputFormat) {
  if (saving.value) return;
  if (!localOutputRootDir.value.trim()) {
    showNotice("请先设置图片输出目录。", "warn");
    return;
  }
  if (!hasImages.value) {
    showNotice("请先上传需要处理的图片。", "warn");
    return;
  }
  clearExportDebounce();
  exportDebouncing.value = true;
  exportDebounceTimer = window.setTimeout(() => {
    exportDebounceTimer = null;
    exportDebouncing.value = false;
    void exportImage(format);
  }, 1000);
}

async function exportImage(format: OutputFormat) {
  if (saving.value) return;
  if (!localOutputRootDir.value.trim()) {
    showNotice("请先设置图片输出目录。", "warn");
    return;
  }
  if (!hasImages.value) {
    showNotice("请先上传需要处理的图片。", "warn");
    return;
  }

  saving.value = true;
  clearSavedOutputPath();
  try {
    await nextTick();
    const { blob, format: savedFormat } = await renderCanvas(format);
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const bridge = runtimeBridge as ProcessBridge;
    if (!bridge.saveProcessedImage) {
      throw new Error("runtimeBridge.saveProcessedImage 尚未实现。");
    }

    const outputPath = await bridge.saveProcessedImage(localOutputRootDir.value.trim(), buildFileName(savedFormat), bytes, savedFormat);
    savedOutputPath.value = outputPath;
    showNotice(`已导出 ${savedFormat.toUpperCase()} 图片。`, "success");
  } catch (error) {
    showNotice(error instanceof Error ? error.message : String(error), "error");
  } finally {
    saving.value = false;
  }
}

onMounted(async () => {
  window.addEventListener("resize", updateViewportHeight);

  if (!runtimeBridge.isNativeRuntime()) return;

  unlistenDragDrop = await getCurrentWebview().onDragDropEvent((event) => {
    if (event.payload.type === "enter" || event.payload.type === "over") {
      hoveredSlotIndex.value = slotIndexFromDropPosition(event.payload.position);
      return;
    }

    if (event.payload.type === "leave") {
      hoveredSlotIndex.value = null;
      return;
    }

    hoveredSlotIndex.value = null;
    const slotIndex = slotIndexFromDropPosition(event.payload.position);
    const filePath = event.payload.paths[0];
    if (slotIndex >= 0 && filePath) {
      void acceptDroppedPath(filePath, slotIndex);
    }
  });
});

onBeforeUnmount(() => {
  cleanupSlotImages();
  removeBackgroundImage();
  cleanupAnnotationInteractions();
  window.removeEventListener("resize", updateViewportHeight);
  clearExportDebounce();
  void unlistenDragDrop?.();
});
</script>

<template>
  <div class="modal-backdrop">
    <MessageNotice
      v-if="noticeMessage"
      :key="`${noticeRevision}:${noticeMessage}`"
      :message="noticeMessage"
      :tone="noticeTone"
      @close="clearNotice"
    />
    <div v-if="savedOutputPath" class="export-alert" role="status">
      <span>已保存到</span>
      <button type="button" class="export-alert__path" title="打开到导出图片所在目录并选中导出的图片" @click="void revealSavedFile()">
        {{ displaySavedOutputPath }}
      </button>
      <button type="button" class="export-alert__close" aria-label="关闭提示" @click="clearSavedOutputPath">×</button>
    </div>

    <section class="modal-card image-process-modal" role="dialog" aria-modal="true" aria-labelledby="image-process-title">
      <div class="panel__head modal-card__head image-process-modal__head">
        <div>
          <p class="eyebrow">Image Process</p>
          <h3 id="image-process-title">图片拼版处理</h3>
        </div>
        <button type="button" class="modal-close" aria-label="关闭弹窗" :disabled="saving" @click="emit('close')">×</button>
      </div>

      <div class="image-process-layout" :class="layoutShellClass">
        <aside class="layout-sidebar" :class="{ 'layout-sidebar--collapsed': leftSidebarCollapsed }">
          <button
            type="button"
            class="sidebar-toggle sidebar-toggle--left"
            :aria-label="leftSidebarCollapsed ? '展开布局选择' : '隐藏布局选择'"
            @click="leftSidebarCollapsed = !leftSidebarCollapsed"
          >
            {{ leftSidebarCollapsed ? "›" : "‹" }}
          </button>
          <div class="sidebar-content">
            <div class="sidebar-title">
              <span>预设布局</span>
              <strong>{{ selectedLayout.count }} 图</strong>
            </div>
            <ImageProcessLayoutPicker :groups="groupedLayouts" :selected-layout-id="selectedLayoutId" @select="selectedLayoutId = $event" />
          </div>
        </aside>

        <main class="canvas-panel">
          <ImageProcessToolStrip
            :active-drawing-kind="activeDrawingKind"
            :has-images="hasImages"
            :has-annotations="annotations.length > 0"
            @add-text="addAnnotation('text')"
            @select-drawing="selectDrawingTool"
            @shuffle="shuffleImages"
            @clear="clearImagesAndAnnotations"
          />

          <div class="preview-shell">
            <div
              ref="previewBoard"
              class="preview-board"
              :class="drawingBoardClass"
              :style="boardStyle"
              @pointerdown="startAnnotationCreate"
              @click.capture="blockDrawingClick"
            >
              <div class="preview-inner">
                <div
                  v-for="(cell, index) in visibleCells"
                  :key="`${selectedLayout.id}-${index}`"
                  role="button"
                  tabindex="0"
                  :aria-label="slotImages[index] ? `选择图片 ${slotImages[index]?.name}` : '上传图片'"
                  class="preview-cell"
                  :class="{
                    'preview-cell--empty': !slotImages[index],
                    'preview-cell--drag-over': hoveredSlotIndex === index,
                    'preview-cell--swap-source': draggedSlotIndex === index,
                    'preview-cell--selected': selectedSlotIndex === index && Boolean(slotImages[index]),
                  }"
                  :style="cellStyle(cell)"
                  @click="handleSlotClick(fileInput, index)"
                  @keydown.enter.prevent="handleSlotClick(fileInput, index)"
                  @keydown.space.prevent="handleSlotClick(fileInput, index)"
                  @dragenter="handleSlotDragEnter($event, index)"
                  @dragover="handleSlotDragEnter($event, index)"
                  @dragleave="handleSlotDragLeave($event, index)"
                  @drop="handleSlotDrop($event, index)"
                >
                  <span class="preview-cell__surface">
                    <img v-if="slotImages[index]" :src="slotImages[index]?.url" :alt="slotImages[index]?.name" :style="imageStyle(slotImages[index]!)" draggable="false" />
                    <span v-else class="slot-empty">＋</span>
                  </span>

                  <span v-if="slotImages[index]" class="slot-actions" @click.stop>
                    <button type="button" title="拖拽换格" aria-label="拖拽换格" @pointerdown="startSlotSwapDrag($event, index)">↕</button>
                    <button type="button" title="替换图片" aria-label="替换图片" @click="openSlotFilePicker(fileInput, index)">替</button>
                    <button type="button" title="删除图片" aria-label="删除图片" @click="removeSlotImage(index)">×</button>
                    <button type="button" title="放大" aria-label="放大" @click="zoomSlot(index, 0.12)">＋</button>
                    <button type="button" title="缩小" aria-label="缩小" @click="zoomSlot(index, -0.12)">－</button>
                    <button type="button" title="还原" aria-label="还原" @click="resetSlotZoom(index)">●</button>
                  </span>
                </div>
              </div>

              <div class="annotation-layer">
                <div
                  v-for="annotation in annotations"
                  :key="annotation.id"
                  role="button"
                  tabindex="0"
                  class="annotation-item"
                  :class="[`annotation-item--${annotation.kind}`, { 'annotation-item--active': selectedAnnotationId === annotation.id }]"
                  :style="annotationStyle(annotation)"
                  :aria-label="`编辑${annotation.kind}标注`"
                  @dblclick="editTextAnnotation(annotation)"
                  @pointerdown="startAnnotationDrag($event, annotation)"
                >
                  <input
                    v-if="annotation.kind === 'text'"
                    class="annotation-text-input"
                    type="text"
                    :value="annotation.text"
                    :size="Math.max(Array.from(annotation.text).length, 1)"
                    aria-label="编辑文字"
                    @input="updateAnnotation(annotation.id, { text: ($event.target as HTMLInputElement).value })"
                    @focus="selectedAnnotationId = annotation.id"
                    @pointerdown="startTextAnnotationPointer($event, annotation)"
                    @click.stop
                  />
                  <svg v-else-if="annotation.kind === 'arrow'" class="annotation-arrow" :viewBox="arrowSvgViewBox(annotation)" aria-hidden="true">
                    <line
                      :x1="arrowSvgCoordinate(annotation, 'start', 'x')"
                      :y1="arrowSvgCoordinate(annotation, 'start', 'y')"
                      :x2="arrowBodyEndCoordinate(annotation, 'x')"
                      :y2="arrowBodyEndCoordinate(annotation, 'y')"
                      :stroke-width="annotation.strokeWidth"
                      stroke="currentColor"
                      stroke-linecap="round"
                    />
                    <polygon :points="arrowHeadPoints(annotation)" fill="currentColor" />
                  </svg>
                  <span v-else class="annotation-shape"></span>

                  <div v-if="shouldShowAnnotationToolbar(annotation)" class="annotation-toolbar" @pointerdown.stop @click.stop>
                    <input
                      v-if="annotation.kind === 'text'"
                      class="annotation-toolbar__number"
                      type="number"
                      min="12"
                      max="180"
                      :value="annotation.fontSize"
                      title="字号"
                      @input="updateAnnotation(annotation.id, { fontSize: Number(($event.target as HTMLInputElement).value) || annotation.fontSize })"
                    />
                    <select
                      v-if="annotation.kind !== 'text'"
                      class="annotation-toolbar__select"
                      :value="annotation.strokeWidth"
                      title="线条粗细"
                      @change="updateAnnotation(annotation.id, { strokeWidth: Number(($event.target as HTMLSelectElement).value) || annotation.strokeWidth })"
                    >
                      <option v-for="width in strokeWidths" :key="width" :value="width">{{ width }}px</option>
                    </select>
                    <input
                      class="annotation-toolbar__color"
                      type="color"
                      :value="annotation.color"
                      title="颜色"
                      @input="updateAnnotation(annotation.id, { color: ($event.target as HTMLInputElement).value })"
                    />
                    <button v-if="annotation.kind === 'text'" type="button" title="复制" aria-label="复制" @click="copyAnnotation(annotation)">⧉</button>
                    <button type="button" title="关闭" aria-label="关闭" @click="deleteAnnotation(annotation.id)">×</button>
                  </div>

                  <button
                    v-if="shouldShowArrowHandles(annotation)"
                    type="button"
                    class="annotation-handle annotation-handle--arrow-start"
                    :style="arrowHandleStyle(annotation, 'start')"
                    aria-label="调整箭头起点"
                    @pointerdown.stop.prevent="startAnnotationDrag($event, annotation, 'arrow-start')"
                  ></button>
                  <button
                    v-if="shouldShowArrowHandles(annotation)"
                    type="button"
                    class="annotation-handle annotation-handle--arrow-end"
                    :style="arrowHandleStyle(annotation, 'end')"
                    aria-label="调整箭头终点"
                    @pointerdown.stop.prevent="startAnnotationDrag($event, annotation, 'arrow-end')"
                  ></button>
                  <template v-if="shouldShowResizeHandles(annotation)">
                    <button
                      v-for="handle in resizeHandlesFor(annotation.kind)"
                      :key="handle"
                      type="button"
                      class="annotation-handle"
                      :class="`annotation-handle--${handle}`"
                      :aria-label="`调整${handle}`"
                      @pointerdown.stop.prevent="startAnnotationDrag($event, annotation, `resize-${handle}` as AnnotationDragMode)"
                    ></button>
                  </template>
                  <button
                    v-if="selectedAnnotationId === annotation.id && (annotation.kind === 'rect' || annotation.kind === 'circle')"
                    type="button"
                    class="annotation-rotate-handle"
                    title="旋转"
                    aria-label="旋转标注"
                    @pointerdown.stop.prevent="startAnnotationDrag($event, annotation, 'rotate')"
                  >
                    ↻
                  </button>
                </div>
              </div>
            </div>
          </div>
        </main>

        <aside class="settings-sidebar" :class="{ 'settings-sidebar--collapsed': rightSidebarCollapsed }">
          <button
            type="button"
            class="sidebar-toggle sidebar-toggle--right"
            :aria-label="rightSidebarCollapsed ? '展开设置栏' : '隐藏设置栏'"
            @click="rightSidebarCollapsed = !rightSidebarCollapsed"
          >
            {{ rightSidebarCollapsed ? "‹" : "›" }}
          </button>
          <ImageProcessSettingsContent
            :settings="settings"
            :ratios="ratios"
            :selected-slot-image="selectedSlotImage"
            :selected-image-opacity="selectedImageOpacity"
            :output-root-dir="localOutputRootDir"
            :browsing-output-directory="browsingOutputDirectory"
            :saving="saving"
            :export-debouncing="exportDebouncing"
            @update-setting="updateImageProcessSetting"
            @update-selected-image-opacity="selectedImageOpacity = $event"
            @reset-background-color="resetBackgroundColor"
            @select-background-file="backgroundInput?.click()"
            @remove-background-image="removeBackgroundImage"
            @update-output-root-dir="syncOutputRootDir"
            @browse-output-directory="void browseOutputDirectory()"
            @export-image="scheduleExportImage"
          />
        </aside>
      </div>

      <input ref="fileInput" class="visually-hidden" type="file" accept="image/*" multiple @change="handleSlotFileChange" />
      <input ref="backgroundInput" class="visually-hidden" type="file" accept="image/*" @change="handleBackgroundFile" />
    </section>
  </div>
</template>

<style scoped>
.image-process-modal {
  width: min(1840px, calc(100vw - 16px));
  height: min(1040px, calc(100vh - 8px));
  padding: 18px;
  overflow: hidden;
}

.image-process-modal__head {
  margin-bottom: 14px;
}

.image-process-layout {
  display: grid;
  grid-template-columns: 320px minmax(360px, 1fr) 320px;
  gap: 14px;
  height: calc(100% - 58px);
  min-height: 0;
  transition: grid-template-columns 1s ease;
}

.image-process-layout--left-collapsed {
  grid-template-columns: 44px minmax(360px, 1fr) 320px;
}

.image-process-layout--right-collapsed {
  grid-template-columns: 320px minmax(360px, 1fr) 44px;
}

.image-process-layout--left-collapsed.image-process-layout--right-collapsed {
  grid-template-columns: 44px minmax(360px, 1fr) 44px;
}

.layout-sidebar,
.canvas-panel,
.settings-sidebar {
  position: relative;
  min-height: 0;
  border: 1px solid var(--line);
  border-radius: 18px;
  background:
    linear-gradient(180deg, rgba(77, 212, 198, 0.045), transparent 42%),
    rgba(5, 18, 21, 0.58);
}

.layout-sidebar,
.settings-sidebar {
  overflow: visible;
  padding: 14px;
  transition: padding 1s ease;
}

.layout-sidebar--collapsed,
.settings-sidebar--collapsed {
  overflow: visible;
  padding: 0;
}

.sidebar-content {
  height: 100%;
  min-width: 0;
  overflow: auto;
  transition: opacity 260ms ease, visibility 260ms ease;
}

.layout-sidebar--collapsed .sidebar-content,
.settings-sidebar--collapsed .sidebar-content {
  visibility: hidden;
  opacity: 0;
  overflow: hidden;
  pointer-events: none;
}

.sidebar-toggle {
  position: absolute;
  top: 50%;
  z-index: 5;
  display: grid;
  place-items: center;
  width: 28px;
  height: 58px;
  padding: 0;
  border: 1px solid var(--line);
  border-radius: 10px;
  background: rgba(4, 16, 19, 0.88);
  color: var(--accent);
  font-size: 1.2rem;
  line-height: 1;
  box-shadow: 0 14px 34px rgba(0, 0, 0, 0.24);
  transform: translateY(-50%);
  transition: border-color 160ms ease, background 160ms ease, color 160ms ease, transform 160ms ease;
}

.sidebar-toggle:hover {
  border-color: var(--line-strong);
  background: rgba(77, 212, 198, 0.14);
  color: var(--text);
}

.sidebar-toggle--left {
  right: -14px;
}

.layout-sidebar--collapsed .sidebar-toggle--left {
  right: 7px;
}

.sidebar-toggle--right {
  left: -14px;
}

.settings-sidebar--collapsed .sidebar-toggle--right {
  left: 7px;
}

.sidebar-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 14px;
  color: var(--muted);
  font-size: 0.84rem;
}

.sidebar-title strong {
  color: var(--accent);
}

.canvas-panel {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  gap: 8px;
  padding: 8px 14px 14px;
}

.slot-actions button {
  min-width: 38px;
  height: 34px;
  border: 1px solid var(--line);
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.04);
  color: var(--text);
  transition: border-color 160ms ease, background 160ms ease, transform 160ms ease;
}

.slot-actions button:hover {
  border-color: var(--line-strong);
  background: rgba(77, 212, 198, 0.1);
  transform: translateY(-1px);
}

.preview-shell {
  display: flex;
  align-items: flex-start;
  justify-content: center;
  height: 100%;
  min-height: 0;
  overflow: auto;
  border-radius: 16px;
  background:
    linear-gradient(45deg, rgba(255, 255, 255, 0.035) 25%, transparent 25%),
    linear-gradient(-45deg, rgba(255, 255, 255, 0.035) 25%, transparent 25%),
    rgba(0, 0, 0, 0.16);
  background-position: 0 0, 0 12px;
  background-size: 24px 24px;
}

.preview-board {
  position: relative;
  flex: 0 0 auto;
  width: var(--board-fit-width);
  margin-block: auto;
  overflow: hidden;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 12px;
  box-shadow: 0 26px 80px rgba(0, 0, 0, 0.28);
}

.preview-board::before {
  content: "";
  position: absolute;
  inset: 0;
  z-index: 0;
  background-image: var(--background-image);
  background-position: center;
  background-size: cover;
  opacity: var(--background-opacity);
  pointer-events: none;
}

.preview-board--background-overlay::before {
  z-index: 2;
}

.export-alert {
  position: fixed;
  top: 72px;
  left: 50%;
  z-index: 89;
  display: flex;
  align-items: center;
  gap: 10px;
  width: min(760px, calc(100vw - 64px));
  min-height: 48px;
  padding: 10px 12px 10px 16px;
  border: 1px solid var(--line-strong);
  border-radius: 12px;
  background: rgba(7, 31, 34, 0.96);
  color: var(--text);
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.34);
  transform: translateX(-50%);
}

.export-alert span {
  flex: 0 0 auto;
  color: var(--text);
}

.export-alert__path {
  min-width: 0;
  flex: 1 1 auto;
  overflow: hidden;
  border: 0;
  background: transparent;
  color: var(--accent);
  text-align: left;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.export-alert__path:hover {
  color: var(--text);
}

.export-alert__close {
  display: grid;
  place-items: center;
  flex: 0 0 auto;
  width: 26px;
  height: 26px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.04);
  color: var(--muted);
}

.export-alert__close:hover {
  border-color: var(--line-strong);
  color: var(--text);
}

.preview-board--drawing {
  cursor: crosshair;
}

.preview-board--drawing .preview-cell {
  cursor: crosshair;
}

.preview-inner {
  position: absolute;
  inset: var(--border-top) var(--border-right) var(--border-bottom) var(--border-left);
  z-index: 1;
}

.preview-cell {
  position: absolute;
  padding: calc(var(--gap) / 2);
  border: 0;
  background: transparent;
  color: var(--muted);
}

.preview-cell--selected {
  z-index: 2;
}

.preview-cell__surface {
  position: relative;
  display: grid;
  place-items: center;
  width: 100%;
  height: 100%;
  overflow: hidden;
  border: 1px dashed rgba(255, 255, 255, 0.16);
  border-radius: var(--cell-radius);
  background: rgba(255, 255, 255, 0.045);
}

.preview-cell--empty:hover .preview-cell__surface,
.preview-cell--drag-over .preview-cell__surface {
  border-color: rgba(77, 212, 198, 0.55);
  background: rgba(77, 212, 198, 0.08);
}

.preview-cell--drag-over .preview-cell__surface {
  border-style: solid;
  border-color: rgba(255, 255, 255, 0.86);
}

.preview-cell--selected::after {
  content: "";
  position: absolute;
  inset: calc(var(--gap) / 2);
  z-index: 3;
  border: 2px solid rgba(77, 212, 198, 0.98);
  border-radius: var(--cell-radius);
  box-shadow:
    inset 0 0 0 1px rgba(4, 16, 19, 0.78),
    inset 0 0 0 3px rgba(255, 255, 255, 0.16),
    0 0 0 1px rgba(4, 16, 19, 0.9),
    0 0 0 4px rgba(77, 212, 198, 0.22),
    0 16px 34px rgba(77, 212, 198, 0.13);
  pointer-events: none;
}

.preview-cell--selected::before {
  content: "";
  position: absolute;
  right: calc(var(--gap) / 2 + 8px);
  bottom: calc(var(--gap) / 2 + 8px);
  z-index: 4;
  width: 10px;
  height: 10px;
  border: 2px solid rgba(4, 16, 19, 0.92);
  border-radius: 999px;
  background: var(--accent);
  box-shadow: 0 0 0 2px rgba(77, 212, 198, 0.22);
  pointer-events: none;
}

.preview-cell--swap-source .preview-cell__surface {
  border-style: dashed;
  border-color: rgba(255, 255, 255, 0.86);
  box-shadow: none;
}

.preview-cell--swap-source .preview-cell__surface::after {
  content: "";
  position: absolute;
  inset: 0;
  background: rgba(255, 255, 255, 0.28);
  pointer-events: none;
}

.preview-cell img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  transform-origin: center;
  pointer-events: none;
}

.slot-empty {
  display: grid;
  place-items: center;
  width: 42px;
  height: 42px;
  border: 1px solid rgba(77, 212, 198, 0.34);
  border-radius: 14px;
  color: var(--accent);
  font-size: 1.7rem;
}

.slot-actions {
  position: absolute;
  top: 8px;
  right: 8px;
  display: grid;
  grid-template-columns: repeat(3, 28px);
  gap: 5px;
  opacity: 0;
  pointer-events: none;
  transition: opacity 160ms ease;
}

.preview-cell:hover .slot-actions,
.slot-actions:focus-within {
  opacity: 1;
  pointer-events: auto;
}

.slot-actions button {
  min-width: 28px;
  width: 28px;
  height: 28px;
  padding: 0;
  border-radius: 8px;
  background: rgba(4, 16, 19, 0.76);
  font-size: 0.78rem;
}

.slot-actions button:first-child {
  cursor: grab;
}

.slot-actions button:first-child:active {
  cursor: grabbing;
}

.annotation-layer {
  position: absolute;
  inset: 0;
  z-index: 3;
  pointer-events: none;
}

.annotation-item {
  position: absolute;
  padding: 0;
  border: 0;
  background: transparent;
  color: #fff;
  pointer-events: auto;
  text-shadow: 0 3px 18px rgba(0, 0, 0, 0.72);
  cursor: move;
}

.annotation-item--active {
  outline: 1px dashed rgba(77, 212, 198, 0.72);
  outline-offset: 4px;
}

.annotation-item--arrow.annotation-item--active {
  outline: none;
}

.annotation-item--text {
  display: flex;
  align-items: flex-start;
  justify-content: flex-start;
  font-weight: 700;
  line-height: 1.15;
  white-space: nowrap;
  cursor: move;
}

.annotation-text-input {
  width: 100%;
  height: 100%;
  min-width: 0;
  padding: 0;
  border: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  font-weight: 700;
  line-height: 1.15;
  outline: none;
  text-shadow: inherit;
  caret-color: currentColor;
  cursor: move;
}

.annotation-arrow {
  display: block;
  width: 100%;
  height: 100%;
  overflow: visible;
  filter: drop-shadow(0 4px 18px rgba(0, 0, 0, 0.52));
}

.annotation-shape {
  display: block;
  width: 100%;
  height: 100%;
  border: var(--annotation-line-width) solid currentColor;
  border-radius: 4px;
  box-shadow: 0 4px 22px rgba(0, 0, 0, 0.44);
  transform: rotate(var(--annotation-rotation));
  transform-origin: center;
}

.annotation-item--circle .annotation-shape {
  border-radius: 999px;
}

.annotation-toolbar {
  position: absolute;
  left: 0;
  bottom: calc(100% + 12px);
  z-index: 3;
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: max-content;
  padding: 8px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 12px;
  background: rgba(29, 39, 49, 0.96);
  box-shadow: 0 16px 36px rgba(0, 0, 0, 0.32);
  color: #fff;
  font-size: 13px;
  font-weight: 500;
  line-height: 1;
  text-shadow: none;
}

.annotation-toolbar__number,
.annotation-toolbar__select {
  flex: 0 0 auto;
  width: 62px;
  height: 30px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 7px;
  background: rgba(255, 255, 255, 0.08);
  color: #fff;
  color-scheme: dark;
  font: 500 13px/1 sans-serif;
}

.annotation-toolbar__select option {
  background: #1d2731;
  color: #fff;
}

.annotation-toolbar__color {
  flex: 0 0 auto;
  width: 32px;
  height: 30px;
  padding: 2px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 7px;
  background: rgba(255, 255, 255, 0.08);
  cursor: pointer;
}

.annotation-toolbar button {
  flex: 0 0 auto;
  display: grid;
  place-items: center;
  width: 30px;
  height: 30px;
  border: 0;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.1);
  color: #fff;
}

.annotation-toolbar button:hover {
  background: rgba(77, 212, 198, 0.18);
}

.annotation-handle {
  position: absolute;
  z-index: 2;
  width: 12px;
  height: 12px;
  padding: 0;
  border: 2px solid #ffffff;
  border-radius: 999px;
  background: var(--accent);
  box-shadow: 0 0 0 2px rgba(0, 0, 0, 0.34);
}

.annotation-handle--nw {
  top: -8px;
  left: -8px;
  cursor: nwse-resize;
}

.annotation-handle--n {
  top: -8px;
  left: 50%;
  cursor: ns-resize;
  transform: translateX(-50%);
}

.annotation-handle--ne {
  top: -8px;
  right: -8px;
  cursor: nesw-resize;
}

.annotation-handle--e {
  top: 50%;
  right: -8px;
  cursor: ew-resize;
  transform: translateY(-50%);
}

.annotation-handle--sw {
  bottom: -8px;
  left: -8px;
  cursor: nesw-resize;
}

.annotation-handle--w {
  top: 50%;
  left: -8px;
  cursor: ew-resize;
  transform: translateY(-50%);
}

.annotation-handle--se {
  right: -8px;
  bottom: -8px;
  cursor: nwse-resize;
}

.annotation-handle--s {
  bottom: -8px;
  left: 50%;
  cursor: ns-resize;
  transform: translateX(-50%);
}

.annotation-handle--arrow-start {
  cursor: grab;
  transform: translate(-50%, -50%);
}

.annotation-handle--arrow-end {
  cursor: grab;
  transform: translate(-50%, -50%);
}

.annotation-handle--arrow-start:active,
.annotation-handle--arrow-end:active {
  cursor: grabbing;
}

.annotation-rotate-handle {
  position: absolute;
  left: 50%;
  bottom: -32px;
  z-index: 2;
  display: grid;
  place-items: center;
  width: 24px;
  height: 24px;
  padding: 0;
  border: 1px solid rgba(255, 255, 255, 0.66);
  border-radius: 999px;
  background: rgba(4, 16, 19, 0.88);
  color: #fff;
  font-size: 0.92rem;
  line-height: 1;
  box-shadow: 0 8px 20px rgba(0, 0, 0, 0.28);
  cursor: grab;
  transform: translateX(-50%);
}

.annotation-rotate-handle:active {
  cursor: grabbing;
}

.settings-sidebar {
  display: grid;
  align-content: start;
  gap: 12px;
}

.visually-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
}

@media (max-width: 1280px) {
  .image-process-modal {
    overflow: hidden;
  }

  .image-process-layout {
    grid-template-columns: clamp(260px, 23vw, 300px) minmax(360px, 1fr) clamp(240px, 22vw, 280px);
    height: calc(100% - 58px);
  }

  .image-process-layout--left-collapsed {
    grid-template-columns: 44px minmax(360px, 1fr) clamp(240px, 22vw, 280px);
  }

  .image-process-layout--right-collapsed {
    grid-template-columns: clamp(260px, 23vw, 300px) minmax(360px, 1fr) 44px;
  }

  .image-process-layout--left-collapsed.image-process-layout--right-collapsed {
    grid-template-columns: 44px minmax(360px, 1fr) 44px;
  }

  .canvas-panel {
    min-height: min(720px, calc(100dvh - 150px));
  }

  .settings-sidebar {
    grid-column: auto;
    grid-template-columns: minmax(0, 1fr);
  }
}

@media (max-width: 960px) {
  .image-process-modal {
    overflow: auto;
  }

  .image-process-layout,
  .settings-sidebar {
    grid-template-columns: 1fr;
  }

  .image-process-layout,
  .image-process-layout--left-collapsed,
  .image-process-layout--right-collapsed,
  .image-process-layout--left-collapsed.image-process-layout--right-collapsed {
    grid-template-columns: 1fr;
    height: auto;
  }

  .settings-sidebar {
    grid-column: 1;
  }

  .canvas-panel {
    min-height: 520px;
  }
}
</style>
