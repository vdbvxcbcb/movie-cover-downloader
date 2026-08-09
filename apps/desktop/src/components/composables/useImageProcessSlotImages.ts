import { computed, ref, shallowRef } from "vue";
import type { ComputedRef, Ref, ShallowRef } from "vue";
import type { ImageRotation, LayoutCell, NoticeTone, SlotImage } from "./types";

interface SlotImageBridge {
  readDroppedImageFile?: (filePath: string) => Promise<Uint8Array>;
}

interface UseImageProcessSlotImagesOptions {
  activeSlotIndex: ShallowRef<number>;
  selectedSlotIndex: Ref<number | null>;
  visibleCells: ComputedRef<LayoutCell[]>;
  previewBoard: Readonly<Ref<HTMLElement | null>>;
  bridge: SlotImageBridge;
  createId: (prefix: string) => string;
  showNotice: (message: string, tone?: NoticeTone) => void;
  clearNotice: () => void;
  getSlotViewport: (index: number) => { width: number; height: number } | null;
  previewScale: Readonly<ShallowRef<number>>;
}

interface SlotImagePanState {
  pointerId: number;
  slotIndex: number;
  imageId: string;
  startClientX: number;
  startClientY: number;
  startOffsetX: number;
  startOffsetY: number;
  maxOffsetX: number;
  maxOffsetY: number;
}

interface SlotImagePlacementInput {
  imageWidth: number;
  imageHeight: number;
  viewportWidth: number;
  viewportHeight: number;
  scale: number;
  offsetX: number;
  offsetY: number;
}

interface SlotIndexFromClientPositionInput {
  clientX: number;
  clientY: number;
  boardLeft: number;
  boardTop: number;
  boardWidth: number;
  boardHeight: number;
  previewScale: number;
  borderTop: number;
  borderRight: number;
  borderBottom: number;
  borderLeft: number;
  cells: LayoutCell[];
}

export interface SlotImagePlacement {
  x: number;
  y: number;
  width: number;
  height: number;
  maxOffsetX: number;
  maxOffsetY: number;
}

export function normalizeImageRotation(rotation: number): ImageRotation {
  const normalized = ((rotation % 360) + 360) % 360;
  return normalized === 90 || normalized === 180 || normalized === 270 ? normalized : 0;
}

export function getRotatedImageDimensions(width: number, height: number, rotation: ImageRotation) {
  return rotation === 90 || rotation === 270 ? { width: height, height: width } : { width, height };
}

export function getRotatedImageDrawBox(placement: SlotImagePlacement, rotation: ImageRotation) {
  const quarterTurn = rotation === 90 || rotation === 270;
  const width = quarterTurn ? placement.height : placement.width;
  const height = quarterTurn ? placement.width : placement.height;
  return {
    x: placement.x + placement.width / 2 - width / 2,
    y: placement.y + placement.height / 2 - height / 2,
    width,
    height,
  };
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function getNextSlotImageOffset(currentOffset: number, pointerDelta: number, maxOffset: number) {
  if (maxOffset <= 0) return clamp(currentOffset, -1, 1);
  return clamp(currentOffset + pointerDelta / maxOffset, -1, 1);
}

export function getSlotIndexFromClientPosition(input: SlotIndexFromClientPositionInput) {
  const previewScale = Math.max(0.01, input.previewScale);
  const x = (input.clientX - input.boardLeft) / previewScale;
  const y = (input.clientY - input.boardTop) / previewScale;
  if (x < 0 || y < 0 || x > input.boardWidth || y > input.boardHeight) return -1;

  const innerWidth = Math.max(1, input.boardWidth - input.borderLeft - input.borderRight);
  const innerHeight = Math.max(1, input.boardHeight - input.borderTop - input.borderBottom);
  const innerX = x - input.borderLeft;
  const innerY = y - input.borderTop;
  if (innerX < 0 || innerY < 0 || innerX > innerWidth || innerY > innerHeight) return -1;

  return input.cells.findIndex((cell) => {
    const cellLeft = (cell.x / 100) * innerWidth;
    const cellTop = (cell.y / 100) * innerHeight;
    const cellRight = cellLeft + (cell.w / 100) * innerWidth;
    const cellBottom = cellTop + (cell.h / 100) * innerHeight;
    return innerX >= cellLeft && innerX <= cellRight && innerY >= cellTop && innerY <= cellBottom;
  });
}

function getRetainedSlotImageOffset(
  currentOffset: number,
  currentSize: number,
  viewportSize: number,
  currentMaxOffset: number,
  nextSize: number,
  nextMaxOffset: number,
) {
  if (currentMaxOffset <= 0 || nextMaxOffset <= 0) return currentOffset;
  const currentPosition = (viewportSize - currentSize) / 2 + currentOffset * currentMaxOffset;
  const focus = (viewportSize / 2 - currentPosition) / currentSize;
  return clamp((nextSize * (0.5 - focus)) / nextMaxOffset, -1, 1);
}

export function getSlotImagePlacement(input: SlotImagePlacementInput): SlotImagePlacement {
  const imageWidth = Math.max(1, input.imageWidth);
  const imageHeight = Math.max(1, input.imageHeight);
  const viewportWidth = Math.max(1, input.viewportWidth);
  const viewportHeight = Math.max(1, input.viewportHeight);
  const fitScale = Math.max(viewportWidth / imageWidth, viewportHeight / imageHeight);
  const width = imageWidth * fitScale * Math.max(0.01, input.scale);
  const height = imageHeight * fitScale * Math.max(0.01, input.scale);
  const maxOffsetX = Math.max(0, (width - viewportWidth) / 2);
  const maxOffsetY = Math.max(0, (height - viewportHeight) / 2);

  return {
    x: (viewportWidth - width) / 2 + clamp(input.offsetX, -1, 1) * maxOffsetX,
    y: (viewportHeight - height) / 2 + clamp(input.offsetY, -1, 1) * maxOffsetY,
    width,
    height,
    maxOffsetX,
    maxOffsetY,
  };
}

function createEmptySlotImages() {
  return Array.from({ length: 9 }).fill(null) as (SlotImage | null)[];
}

export function fileNameFromPath(filePath: string) {
  return filePath.split(/[\\/]/).pop() || "dropped-image";
}

export function imageMimeType(fileName: string) {
  const extension = fileName.split(".").pop()?.toLowerCase();
  if (extension === "jpg" || extension === "jpeg") return "image/jpeg";
  if (extension === "png") return "image/png";
  if (extension === "webp") return "image/webp";
  if (extension === "gif") return "image/gif";
  if (extension === "bmp") return "image/bmp";
  return "application/octet-stream";
}

export function useImageProcessSlotImages(options: UseImageProcessSlotImagesOptions) {
  const slotImages = ref<(SlotImage | null)[]>(createEmptySlotImages());
  const draggedSlotIndex = ref<number | null>(null);
  const hoveredSlotIndex = ref<number | null>(null);
  const panningSlotIndex = shallowRef<number | null>(null);
  let slotImagePanState: SlotImagePanState | null = null;
  let droppedPathsRevision = 0;
  let disposed = false;

  const selectedSlotImage = computed(() =>
    options.selectedSlotIndex.value === null ? null : slotImages.value[options.selectedSlotIndex.value] ?? null,
  );
  const selectedImageOpacity = computed({
    get() {
      return selectedSlotImage.value?.opacity ?? 100;
    },
    set(value: number) {
      if (options.selectedSlotIndex.value === null) return;
      const current = slotImages.value[options.selectedSlotIndex.value];
      if (!current) return;
      const nextImages = [...slotImages.value];
      nextImages[options.selectedSlotIndex.value] = {
        ...current,
        opacity: Math.min(100, Math.max(20, Number(value) || 100)),
      };
      slotImages.value = nextImages;
    },
  });
  const hasImages = computed(() => slotImages.value.some(Boolean));

  function revokeSlotImage(image: SlotImage | null) {
    if (image?.url) {
      URL.revokeObjectURL(image.url);
    }
  }

  function setSlotImage(index: number, file: File) {
    if (!file.type.startsWith("image/")) {
      options.showNotice("请选择图片文件。", "warn");
      return;
    }

    const nextImages = [...slotImages.value];
    revokeSlotImage(nextImages[index] ?? null);
    nextImages[index] = {
      id: options.createId("image"),
      url: URL.createObjectURL(file),
      name: file.name,
      scale: 1,
      opacity: 100,
      naturalWidth: 0,
      naturalHeight: 0,
      offsetX: 0,
      offsetY: 0,
      rotation: 0,
    };
    slotImages.value = nextImages;
    options.selectedSlotIndex.value = index;
    options.clearNotice();
  }

  async function acceptDroppedPath(filePath: string, index: number, revision: number) {
    try {
      if (!options.bridge.readDroppedImageFile) {
        throw new Error("runtimeBridge.readDroppedImageFile 尚未实现。");
      }

      const fileName = fileNameFromPath(filePath);
      const bytes = await options.bridge.readDroppedImageFile(filePath);
      if (disposed || revision !== droppedPathsRevision) return;
      const file = new File([bytes], fileName, { type: imageMimeType(fileName) });
      setSlotImage(index, file);
    } catch (error) {
      if (disposed || revision !== droppedPathsRevision) return;
      options.showNotice(error instanceof Error ? error.message : String(error), "error");
    }
  }

  async function acceptDroppedPaths(filePaths: string[], startIndex: number) {
    if (disposed) return;
    const revision = ++droppedPathsRevision;
    let targetIndex = filePaths.length > 1 ? 0 : startIndex;
    for (const filePath of filePaths) {
      if (disposed || revision !== droppedPathsRevision || targetIndex >= options.visibleCells.value.length) break;
      await acceptDroppedPath(filePath, targetIndex, revision);
      targetIndex += 1;
    }
  }

  function openSlotFilePicker(fileInput: HTMLInputElement | null, index: number) {
    options.activeSlotIndex.value = index;
    fileInput?.click();
  }

  function handleSlotClick(fileInput: HTMLInputElement | null, index: number) {
    if (slotImages.value[index]) {
      options.selectedSlotIndex.value = index;
      return;
    }

    openSlotFilePicker(fileInput, index);
  }

  function handleSlotFileChange(event: Event) {
    const input = event.target as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    if (files.length === 0) return;
    droppedPathsRevision += 1;

    let targetIndex = options.activeSlotIndex.value;
    for (const file of files) {
      if (targetIndex >= options.visibleCells.value.length) break;
      setSlotImage(targetIndex, file);
      targetIndex += 1;
    }
    input.value = "";
  }

  function swapSlotImages(source: number, target: number) {
    if (source === target || source < 0 || target < 0) return;
    const nextImages = [...slotImages.value];
    [nextImages[source], nextImages[target]] = [nextImages[target] ?? null, nextImages[source] ?? null];
    slotImages.value = nextImages;
    if (options.selectedSlotIndex.value === source) {
      options.selectedSlotIndex.value = target;
    } else if (options.selectedSlotIndex.value === target) {
      options.selectedSlotIndex.value = source;
    }
  }

  function handleSlotDrop(event: DragEvent, index: number) {
    event.preventDefault();
    event.stopPropagation();
    hoveredSlotIndex.value = null;
    droppedPathsRevision += 1;

    if (draggedSlotIndex.value !== null && draggedSlotIndex.value !== index) {
      swapSlotImages(draggedSlotIndex.value, index);
      draggedSlotIndex.value = null;
      return;
    }

    const files = Array.from(event.dataTransfer?.files ?? []);
    const startIndex = files.length > 1 ? 0 : index;
    for (const [offset, file] of files.entries()) {
      const targetIndex = startIndex + offset;
      if (targetIndex >= options.visibleCells.value.length) break;
      setSlotImage(targetIndex, file);
    }
  }

  function slotIndexFromClientPosition(clientX: number, clientY: number) {
    if (!options.previewBoard.value) return -1;
    const rect = options.previewBoard.value.getBoundingClientRect();
    const style = getComputedStyle(options.previewBoard.value);
    return getSlotIndexFromClientPosition({
      clientX,
      clientY,
      boardLeft: rect.left,
      boardTop: rect.top,
      boardWidth: options.previewBoard.value.clientWidth,
      boardHeight: options.previewBoard.value.clientHeight,
      previewScale: options.previewScale.value,
      borderLeft: Number.parseFloat(style.getPropertyValue("--border-left")) || 0,
      borderTop: Number.parseFloat(style.getPropertyValue("--border-top")) || 0,
      borderRight: Number.parseFloat(style.getPropertyValue("--border-right")) || 0,
      borderBottom: Number.parseFloat(style.getPropertyValue("--border-bottom")) || 0,
      cells: options.visibleCells.value,
    });
  }

  function slotIndexFromDropPosition(position: { x: number; y: number }) {
    const scaleFactor = window.devicePixelRatio || 1;
    return slotIndexFromClientPosition(position.x / scaleFactor, position.y / scaleFactor);
  }

  function handleSlotDragEnter(event: DragEvent, index: number) {
    event.preventDefault();
    event.stopPropagation();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = draggedSlotIndex.value !== null ? "move" : "copy";
    }
    hoveredSlotIndex.value = index;
  }

  function handleSlotDragLeave(event: DragEvent, index: number) {
    event.preventDefault();
    event.stopPropagation();
    const current = event.currentTarget as HTMLElement;
    const nextTarget = event.relatedTarget as Node | null;
    if (hoveredSlotIndex.value === index && (!nextTarget || !current.contains(nextTarget))) {
      hoveredSlotIndex.value = null;
    }
  }

  function startSlotSwapDrag(event: PointerEvent, index: number) {
    event.preventDefault();
    event.stopPropagation();
    draggedSlotIndex.value = index;
    hoveredSlotIndex.value = index;
    window.addEventListener("pointermove", handleSlotSwapMove);
    window.addEventListener("pointerup", stopSlotSwapDrag, { once: true });
    window.addEventListener("pointercancel", cancelSlotSwapDrag, { once: true });
    window.addEventListener("blur", cancelSlotSwapDrag, { once: true });
  }

  function handleSlotSwapMove(event: PointerEvent) {
    if (draggedSlotIndex.value === null) return;
    hoveredSlotIndex.value = slotIndexFromClientPosition(event.clientX, event.clientY);
  }

  function stopSlotSwapDrag(event: PointerEvent) {
    if (draggedSlotIndex.value !== null) {
      const targetIndex = slotIndexFromClientPosition(event.clientX, event.clientY);
      if (targetIndex >= 0) {
        swapSlotImages(draggedSlotIndex.value, targetIndex);
      }
    }
    draggedSlotIndex.value = null;
    hoveredSlotIndex.value = null;
    window.removeEventListener("pointermove", handleSlotSwapMove);
    window.removeEventListener("pointercancel", cancelSlotSwapDrag);
    window.removeEventListener("blur", cancelSlotSwapDrag);
  }

  function cancelSlotSwapDrag() {
    draggedSlotIndex.value = null;
    hoveredSlotIndex.value = null;
    window.removeEventListener("pointermove", handleSlotSwapMove);
    window.removeEventListener("pointerup", stopSlotSwapDrag);
    window.removeEventListener("pointercancel", cancelSlotSwapDrag);
    window.removeEventListener("blur", cancelSlotSwapDrag);
  }

  function removeSlotImage(index: number) {
    droppedPathsRevision += 1;
    if (panningSlotIndex.value === index) {
      cancelSlotImagePan();
    }
    const nextImages = [...slotImages.value];
    revokeSlotImage(nextImages[index] ?? null);
    nextImages[index] = null;
    slotImages.value = nextImages;
    if (options.selectedSlotIndex.value === index) {
      options.selectedSlotIndex.value = null;
    }
  }

  function zoomSlot(index: number, delta: number) {
    const current = slotImages.value[index];
    if (!current) return;
    const currentPlacement = getSlotPlacement(index);
    const viewport = options.getSlotViewport(index);
    const scale = Math.min(3, Math.max(1, Number((current.scale + delta).toFixed(2))));
    let offsetX = scale <= 1 ? 0 : current.offsetX;
    let offsetY = scale <= 1 ? 0 : current.offsetY;
    if (scale > 1 && currentPlacement && viewport) {
      const dimensions = getRotatedImageDimensions(current.naturalWidth, current.naturalHeight, current.rotation);
      const nextPlacement = getSlotImagePlacement({
        imageWidth: dimensions.width,
        imageHeight: dimensions.height,
        viewportWidth: viewport.width,
        viewportHeight: viewport.height,
        scale,
        offsetX: current.offsetX,
        offsetY: current.offsetY,
      });
      offsetX = getRetainedSlotImageOffset(
        current.offsetX,
        currentPlacement.width,
        viewport.width,
        currentPlacement.maxOffsetX,
        nextPlacement.width,
        nextPlacement.maxOffsetX,
      );
      offsetY = getRetainedSlotImageOffset(
        current.offsetY,
        currentPlacement.height,
        viewport.height,
        currentPlacement.maxOffsetY,
        nextPlacement.height,
        nextPlacement.maxOffsetY,
      );
    }
    const nextImages = [...slotImages.value];
    nextImages[index] = {
      ...current,
      scale,
      offsetX,
      offsetY,
    };
    slotImages.value = nextImages;
  }

  function resetSlotZoom(index: number) {
    const current = slotImages.value[index];
    if (!current) return;
    const nextImages = [...slotImages.value];
    nextImages[index] = { ...current, scale: 1, offsetX: 0, offsetY: 0, rotation: 0 };
    slotImages.value = nextImages;
  }

  function updateSlotImageDimensions(index: number, naturalWidth: number, naturalHeight: number) {
    const current = slotImages.value[index];
    if (!current || naturalWidth <= 0 || naturalHeight <= 0) return;
    const nextImages = [...slotImages.value];
    nextImages[index] = { ...current, naturalWidth, naturalHeight };
    slotImages.value = nextImages;
  }

  function getSlotPlacement(index: number) {
    const image = slotImages.value[index];
    const viewport = options.getSlotViewport(index);
    if (!image || !viewport || image.naturalWidth <= 0 || image.naturalHeight <= 0) return null;
    const dimensions = getRotatedImageDimensions(image.naturalWidth, image.naturalHeight, image.rotation);
    return getSlotImagePlacement({
      imageWidth: dimensions.width,
      imageHeight: dimensions.height,
      viewportWidth: viewport.width,
      viewportHeight: viewport.height,
      scale: image.scale,
      offsetX: image.offsetX,
      offsetY: image.offsetY,
    });
  }

  function rotateSlot(index: number, delta: number) {
    const current = slotImages.value[index];
    if (!current) return;
    const nextImages = [...slotImages.value];
    nextImages[index] = { ...current, rotation: normalizeImageRotation(current.rotation + delta), offsetX: 0, offsetY: 0 };
    slotImages.value = nextImages;
  }

  function isSlotImagePannable(index: number) {
    if (options.selectedSlotIndex.value !== index) return false;
    const image = slotImages.value[index];
    if (!image) return false;
    const placement = getSlotPlacement(index);
    return Boolean(placement && (placement.maxOffsetX > 0 || placement.maxOffsetY > 0));
  }

  function startSlotImagePan(event: PointerEvent, index: number) {
    if (event.button !== 0 || !isSlotImagePannable(index)) return false;
    const image = slotImages.value[index];
    const placement = getSlotPlacement(index);
    if (!image || !placement) return false;

    cancelSlotImagePan();
    event.preventDefault();
    event.stopPropagation();
    slotImagePanState = {
      pointerId: event.pointerId,
      slotIndex: index,
      imageId: image.id,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startOffsetX: image.offsetX,
      startOffsetY: image.offsetY,
      maxOffsetX: placement.maxOffsetX,
      maxOffsetY: placement.maxOffsetY,
    };
    panningSlotIndex.value = index;
    window.addEventListener("pointermove", handleSlotImagePanMove);
    window.addEventListener("pointerup", stopSlotImagePan);
    window.addEventListener("pointercancel", cancelSlotImagePan);
    window.addEventListener("blur", cancelSlotImagePan);
    return true;
  }

  function handleSlotImagePanMove(event: PointerEvent) {
    const panState = slotImagePanState;
    if (!panState || event.pointerId !== panState.pointerId) return;
    const current = slotImages.value[panState.slotIndex];
    if (!current || current.id !== panState.imageId) {
      cancelSlotImagePan();
      return;
    }

    event.preventDefault();
    const nextImages = [...slotImages.value];
    nextImages[panState.slotIndex] = {
      ...current,
      offsetX: getNextSlotImageOffset(
        panState.startOffsetX,
        (event.clientX - panState.startClientX) / Math.max(0.01, options.previewScale.value),
        panState.maxOffsetX,
      ),
      offsetY: getNextSlotImageOffset(
        panState.startOffsetY,
        (event.clientY - panState.startClientY) / Math.max(0.01, options.previewScale.value),
        panState.maxOffsetY,
      ),
    };
    slotImages.value = nextImages;
  }

  function removeSlotImagePanListeners() {
    window.removeEventListener("pointermove", handleSlotImagePanMove);
    window.removeEventListener("pointerup", stopSlotImagePan);
    window.removeEventListener("pointercancel", cancelSlotImagePan);
    window.removeEventListener("blur", cancelSlotImagePan);
  }

  function stopSlotImagePan(event: PointerEvent) {
    if (slotImagePanState && event.pointerId !== slotImagePanState.pointerId) return;
    slotImagePanState = null;
    panningSlotIndex.value = null;
    removeSlotImagePanListeners();
  }

  function cancelSlotImagePan() {
    slotImagePanState = null;
    panningSlotIndex.value = null;
    removeSlotImagePanListeners();
  }

  function shuffleImages() {
    const visibleIndexes = options.visibleCells.value.map((_, index) => index);
    const images = visibleIndexes.map((index) => slotImages.value[index]).filter((image): image is SlotImage => Boolean(image));
    if (images.length < 2) return;

    const slots = [...visibleIndexes].sort(() => Math.random() - 0.5);
    const shuffled = [...images].sort(() => Math.random() - 0.5);
    const nextImages = [...slotImages.value];
    for (const index of visibleIndexes) {
      nextImages[index] = null;
    }
    shuffled.forEach((image, index) => {
      const slotIndex = slots[index];
      if (slotIndex !== undefined) {
        nextImages[slotIndex] = image;
      }
    });
    slotImages.value = nextImages;
    options.selectedSlotIndex.value = null;
  }

  function clearSlotImages() {
    droppedPathsRevision += 1;
    for (const image of slotImages.value) {
      revokeSlotImage(image);
    }
    slotImages.value = createEmptySlotImages();
    options.selectedSlotIndex.value = null;
  }

  function cleanupSlotImages() {
    disposed = true;
    clearSlotImages();
    cancelSlotSwapDrag();
    cancelSlotImagePan();
  }

  return {
    slotImages,
    selectedSlotImage,
    selectedImageOpacity,
    draggedSlotIndex,
    hoveredSlotIndex,
    panningSlotIndex,
    hasImages,
    acceptDroppedPaths,
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
    rotateSlot,
    updateSlotImageDimensions,
    isSlotImagePannable,
    startSlotImagePan,
    cancelSlotImagePan,
    shuffleImages,
    clearSlotImages,
    cleanupSlotImages,
    slotIndexFromDropPosition,
  };
}
