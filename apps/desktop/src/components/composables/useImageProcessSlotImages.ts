import { computed, ref } from "vue";
import type { ComputedRef, Ref, ShallowRef } from "vue";
import type { LayoutCell, NoticeTone, SlotImage } from "./types";

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
    };
    slotImages.value = nextImages;
    options.selectedSlotIndex.value = index;
    options.clearNotice();
  }

  async function acceptDroppedPath(filePath: string, index: number) {
    try {
      if (!options.bridge.readDroppedImageFile) {
        throw new Error("runtimeBridge.readDroppedImageFile 尚未实现。");
      }

      const fileName = fileNameFromPath(filePath);
      const bytes = await options.bridge.readDroppedImageFile(filePath);
      const file = new File([bytes], fileName, { type: imageMimeType(fileName) });
      setSlotImage(index, file);
    } catch (error) {
      options.showNotice(error instanceof Error ? error.message : String(error), "error");
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

    if (draggedSlotIndex.value !== null && draggedSlotIndex.value !== index) {
      swapSlotImages(draggedSlotIndex.value, index);
      draggedSlotIndex.value = null;
      return;
    }

    const file = event.dataTransfer?.files?.[0];
    if (file) {
      setSlotImage(index, file);
    }
  }

  function slotIndexFromClientPosition(clientX: number, clientY: number) {
    if (!options.previewBoard.value) return -1;
    const rect = options.previewBoard.value.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    if (x < 0 || y < 0 || x > rect.width || y > rect.height) return -1;

    const style = getComputedStyle(options.previewBoard.value);
    const left = Number.parseFloat(style.getPropertyValue("--border-left")) || 0;
    const top = Number.parseFloat(style.getPropertyValue("--border-top")) || 0;
    const right = Number.parseFloat(style.getPropertyValue("--border-right")) || 0;
    const bottom = Number.parseFloat(style.getPropertyValue("--border-bottom")) || 0;
    const innerWidth = Math.max(1, rect.width - left - right);
    const innerHeight = Math.max(1, rect.height - top - bottom);
    const innerX = x - left;
    const innerY = y - top;
    if (innerX < 0 || innerY < 0 || innerX > innerWidth || innerY > innerHeight) return -1;

    return options.visibleCells.value.findIndex((cell) => {
      const cellLeft = (cell.x / 100) * innerWidth;
      const cellTop = (cell.y / 100) * innerHeight;
      const cellRight = cellLeft + (cell.w / 100) * innerWidth;
      const cellBottom = cellTop + (cell.h / 100) * innerHeight;
      return innerX >= cellLeft && innerX <= cellRight && innerY >= cellTop && innerY <= cellBottom;
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
    const nextImages = [...slotImages.value];
    nextImages[index] = {
      ...current,
      scale: Math.min(3, Math.max(0.5, Number((current.scale + delta).toFixed(2)))),
    };
    slotImages.value = nextImages;
  }

  function resetSlotZoom(index: number) {
    const current = slotImages.value[index];
    if (!current) return;
    const nextImages = [...slotImages.value];
    nextImages[index] = { ...current, scale: 1 };
    slotImages.value = nextImages;
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
    for (const image of slotImages.value) {
      revokeSlotImage(image);
    }
    slotImages.value = createEmptySlotImages();
    options.selectedSlotIndex.value = null;
  }

  function cleanupSlotImages() {
    clearSlotImages();
    cancelSlotSwapDrag();
  }

  return {
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
  };
}
