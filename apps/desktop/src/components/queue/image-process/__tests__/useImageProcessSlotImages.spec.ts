import { computed, ref, shallowRef } from "vue";
import { describe, expect, it } from "vitest";
import type { SlotImage } from "../../../composables/types";
import {
  fileNameFromPath,
  getNextSlotImageOffset,
  getSlotImagePlacement,
  imageMimeType,
  useImageProcessSlotImages,
} from "../../../composables/useImageProcessSlotImages";

function createSlotImage(overrides: Partial<SlotImage> = {}): SlotImage {
  return {
    id: "image-1",
    url: "blob:image-1",
    name: "image.jpg",
    scale: 1,
    opacity: 100,
    naturalWidth: 400,
    naturalHeight: 200,
    offsetX: 0,
    offsetY: 0,
    ...overrides,
  };
}

function createSlotImages(selectedIndex: number | null = 0) {
  const selectedSlotIndex = ref<number | null>(selectedIndex);
  const composable = useImageProcessSlotImages({
    activeSlotIndex: shallowRef(0),
    selectedSlotIndex,
    visibleCells: computed(() => [{ x: 0, y: 0, w: 100, h: 100 }]),
    previewBoard: ref(null),
    bridge: {},
    createId: () => "image-1",
    showNotice: () => {},
    clearNotice: () => {},
    getSlotViewport: () => ({ width: 100, height: 100 }),
  });
  return { ...composable, selectedSlotIndex };
}

describe("image process slot images", () => {
  it("normalizes dropped file names and image mime types", () => {
    expect(fileNameFromPath("D:\\covers\\poster.webp")).toBe("poster.webp");
    expect(fileNameFromPath("/tmp/still.jpg")).toBe("still.jpg");
    expect(fileNameFromPath("")).toBe("dropped-image");
    expect(imageMimeType("poster.webp")).toBe("image/webp");
    expect(imageMimeType("still.jpeg")).toBe("image/jpeg");
    expect(imageMimeType("notes.txt")).toBe("application/octet-stream");
  });

  it("moves a zoomed cover image inside a fixed viewport without exposing empty space", () => {
    const centered = getSlotImagePlacement({
      imageWidth: 400,
      imageHeight: 200,
      viewportWidth: 100,
      viewportHeight: 100,
      scale: 2,
      offsetX: 0,
      offsetY: 0,
    });
    const leftEdge = getSlotImagePlacement({
      imageWidth: 400,
      imageHeight: 200,
      viewportWidth: 100,
      viewportHeight: 100,
      scale: 2,
      offsetX: 1,
      offsetY: 0,
    });
    const rightEdge = getSlotImagePlacement({
      imageWidth: 400,
      imageHeight: 200,
      viewportWidth: 100,
      viewportHeight: 100,
      scale: 2,
      offsetX: -1,
      offsetY: 0,
    });

    expect(centered).toEqual({ x: -150, y: -50, width: 400, height: 200, maxOffsetX: 150, maxOffsetY: 50 });
    expect(leftEdge.x).toBe(0);
    expect(rightEdge.x + rightEdge.width).toBe(100);
  });

  it("clamps pointer movement to the available image offset", () => {
    expect(getNextSlotImageOffset(0, 30, 60)).toBe(0.5);
    expect(getNextSlotImageOffset(0.75, 30, 60)).toBe(1);
    expect(getNextSlotImageOffset(-0.75, -30, 60)).toBe(-1);
    expect(getNextSlotImageOffset(0.5, 30, 0)).toBe(0.5);
  });

  it("starts panning only for the selected zoomed image", () => {
    const selected = createSlotImages(0);
    selected.slotImages.value[0] = createSlotImage({ scale: 2 });
    const pointerDown = new PointerEvent("pointerdown", { pointerId: 1, clientX: 10, clientY: 10 });

    expect(selected.startSlotImagePan(pointerDown, 0)).toBe(true);
    selected.cancelSlotImagePan();

    const unselected = createSlotImages(null);
    unselected.slotImages.value[0] = createSlotImage({ scale: 2 });
    expect(unselected.startSlotImagePan(pointerDown, 0)).toBe(false);

    selected.slotImages.value[0] = createSlotImage({ scale: 1 });
    expect(selected.startSlotImagePan(pointerDown, 0)).toBe(false);
  });

  it("stores the dragged viewport position and stops at image boundaries", () => {
    const composable = createSlotImages();
    composable.slotImages.value[0] = createSlotImage({ scale: 2 });

    composable.startSlotImagePan(new PointerEvent("pointerdown", { pointerId: 1, clientX: 10, clientY: 10 }), 0);
    window.dispatchEvent(new PointerEvent("pointermove", { pointerId: 1, clientX: 310, clientY: 110 }));

    expect(composable.slotImages.value[0]?.offsetX).toBe(1);
    expect(composable.slotImages.value[0]?.offsetY).toBe(1);
    expect(composable.panningSlotIndex.value).toBe(0);

    window.dispatchEvent(new PointerEvent("pointerup", { pointerId: 1 }));
    expect(composable.panningSlotIndex.value).toBeNull();
  });

  it("centers the viewport when zoom returns to 100 percent or is reset", () => {
    const composable = createSlotImages();
    composable.slotImages.value[0] = createSlotImage({ scale: 1.12, offsetX: 0.6, offsetY: -0.4 });

    composable.zoomSlot(0, -0.12);
    expect(composable.slotImages.value[0]).toMatchObject({ scale: 1, offsetX: 0, offsetY: 0 });

    composable.slotImages.value[0] = createSlotImage({ scale: 2, offsetX: -1, offsetY: 1 });
    composable.resetSlotZoom(0);
    expect(composable.slotImages.value[0]).toMatchObject({ scale: 1, offsetX: 0, offsetY: 0 });
  });

  it("does not shrink below 100 percent", () => {
    const composable = createSlotImages();
    composable.slotImages.value[0] = createSlotImage({ scale: 1.06, offsetX: 0.4, offsetY: -0.2 });

    composable.zoomSlot(0, -0.12);

    expect(composable.slotImages.value[0]).toMatchObject({ scale: 1, offsetX: 0, offsetY: 0 });
  });

  it("keeps a selected image pannable after shrinking from a larger zoom", () => {
    const composable = createSlotImages();
    composable.slotImages.value[0] = createSlotImage({ scale: 1.5, offsetX: 0.4, offsetY: -0.2 });

    composable.zoomSlot(0, -0.12);

    expect(composable.slotImages.value[0]?.scale).toBe(1.38);
    expect(composable.isSlotImagePannable(0)).toBe(true);
    expect(composable.slotImages.value[0]?.offsetX).not.toBe(0);
  });

  it("keeps the current image focus while zooming further", () => {
    const composable = createSlotImages();
    composable.slotImages.value[0] = createSlotImage({ scale: 2, offsetX: 0.5, offsetY: 0 });

    composable.zoomSlot(0, 1);

    expect(composable.slotImages.value[0]?.scale).toBe(3);
    expect(composable.slotImages.value[0]?.offsetX).toBeCloseTo(0.45);
  });
});
