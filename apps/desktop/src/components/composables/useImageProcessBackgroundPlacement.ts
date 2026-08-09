import { computed, shallowRef } from "vue";
import type { ComputedRef, Ref, ShallowRef } from "vue";

interface BackgroundImagePlacementInput {
  imageWidth: number;
  imageHeight: number;
  viewportWidth: number;
  viewportHeight: number;
  scale: number;
  offsetX: number;
  offsetY: number;
}

interface UseImageProcessBackgroundPlacementOptions {
  previewBoard: Readonly<Ref<HTMLElement | null>>;
  previewScale: Readonly<ShallowRef<number>>;
  viewportRevision: Readonly<ShallowRef<number>>;
  canPan: ComputedRef<boolean>;
  scale: Ref<number>;
}

interface BackgroundPanState {
  pointerId: number;
  startClientX: number;
  startClientY: number;
  startOffsetX: number;
  startOffsetY: number;
  maxOffsetX: number;
  maxOffsetY: number;
}

export interface BackgroundImagePlacement {
  x: number;
  y: number;
  width: number;
  height: number;
  maxOffsetX: number;
  maxOffsetY: number;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function getBackgroundImagePlacement(input: BackgroundImagePlacementInput): BackgroundImagePlacement {
  const imageWidth = Math.max(1, input.imageWidth);
  const imageHeight = Math.max(1, input.imageHeight);
  const viewportWidth = Math.max(1, input.viewportWidth);
  const viewportHeight = Math.max(1, input.viewportHeight);
  const fitScale = Math.min(viewportWidth / imageWidth, viewportHeight / imageHeight);
  const sizeScale = clamp(input.scale, 0.3, 1);
  const width = imageWidth * fitScale * sizeScale;
  const height = imageHeight * fitScale * sizeScale;
  const maxOffsetX = Math.max(0, (viewportWidth - width) / 2);
  const maxOffsetY = Math.max(0, (viewportHeight - height) / 2);

  return {
    x: maxOffsetX + clamp(input.offsetX, -1, 1) * maxOffsetX,
    y: maxOffsetY + clamp(input.offsetY, -1, 1) * maxOffsetY,
    width,
    height,
    maxOffsetX,
    maxOffsetY,
  };
}

export function getNextBackgroundImageOffset(
  currentOffset: number,
  visualPointerDelta: number,
  maxOffset: number,
  previewScale: number,
) {
  if (maxOffset <= 0) return 0;
  const logicalDelta = visualPointerDelta / Math.max(0.01, previewScale);
  return clamp(currentOffset + logicalDelta / maxOffset, -1, 1);
}

export function useImageProcessBackgroundPlacement(options: UseImageProcessBackgroundPlacementOptions) {
  const naturalWidth = shallowRef(0);
  const naturalHeight = shallowRef(0);
  const offsetX = shallowRef(0);
  const offsetY = shallowRef(0);
  const isPanning = shallowRef(false);
  let panState: BackgroundPanState | null = null;

  const placement = computed(() => {
    void options.viewportRevision.value;
    const board = options.previewBoard.value;
    if (!board || naturalWidth.value <= 0 || naturalHeight.value <= 0) return null;
    return getBackgroundImagePlacement({
      imageWidth: naturalWidth.value,
      imageHeight: naturalHeight.value,
      viewportWidth: board.clientWidth,
      viewportHeight: board.clientHeight,
      scale: options.scale.value,
      offsetX: offsetX.value,
      offsetY: offsetY.value,
    });
  });

  const backgroundStyle = computed(() => {
    const value = placement.value;
    if (!value) return {};
    return {
      left: `${value.x}px`,
      top: `${value.y}px`,
      width: `${value.width}px`,
      height: `${value.height}px`,
    };
  });

  function updateNaturalSize(width: number, height: number) {
    naturalWidth.value = Math.max(0, width);
    naturalHeight.value = Math.max(0, height);
  }

  function resetPlacement() {
    cancelPan();
    naturalWidth.value = 0;
    naturalHeight.value = 0;
    offsetX.value = 0;
    offsetY.value = 0;
    options.scale.value = 1;
  }

  function updateScale(value: number) {
    const current = placement.value;
    options.scale.value = clamp(value, 0.3, 1);
    const next = placement.value;
    if (!current || !next) return;
    offsetX.value = next.maxOffsetX > 0 ? clamp((offsetX.value * current.maxOffsetX) / next.maxOffsetX, -1, 1) : 0;
    offsetY.value = next.maxOffsetY > 0 ? clamp((offsetY.value * current.maxOffsetY) / next.maxOffsetY, -1, 1) : 0;
  }

  function startPan(event: PointerEvent) {
    const value = placement.value;
    if (event.button !== 0 || !options.canPan.value || !value || (value.maxOffsetX <= 0 && value.maxOffsetY <= 0)) return false;
    cancelPan();
    event.preventDefault();
    event.stopPropagation();
    panState = {
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startOffsetX: offsetX.value,
      startOffsetY: offsetY.value,
      maxOffsetX: value.maxOffsetX,
      maxOffsetY: value.maxOffsetY,
    };
    isPanning.value = true;
    window.addEventListener("pointermove", handlePanMove);
    window.addEventListener("pointerup", stopPan);
    window.addEventListener("pointercancel", cancelPan);
    window.addEventListener("blur", cancelPan);
    return true;
  }

  function handlePanMove(event: PointerEvent) {
    if (!panState || event.pointerId !== panState.pointerId) return;
    event.preventDefault();
    offsetX.value = getNextBackgroundImageOffset(
      panState.startOffsetX,
      event.clientX - panState.startClientX,
      panState.maxOffsetX,
      options.previewScale.value,
    );
    offsetY.value = getNextBackgroundImageOffset(
      panState.startOffsetY,
      event.clientY - panState.startClientY,
      panState.maxOffsetY,
      options.previewScale.value,
    );
  }

  function removePanListeners() {
    window.removeEventListener("pointermove", handlePanMove);
    window.removeEventListener("pointerup", stopPan);
    window.removeEventListener("pointercancel", cancelPan);
    window.removeEventListener("blur", cancelPan);
  }

  function stopPan(event: PointerEvent) {
    if (panState && event.pointerId !== panState.pointerId) return;
    panState = null;
    isPanning.value = false;
    removePanListeners();
  }

  function cancelPan() {
    panState = null;
    isPanning.value = false;
    removePanListeners();
  }

  return {
    offsetX,
    offsetY,
    isPanning,
    placement,
    backgroundStyle,
    updateNaturalSize,
    updateScale,
    resetPlacement,
    startPan,
    cancelPan,
  };
}
