import { computed, ref, shallowRef } from "vue";
import { describe, expect, it, vi } from "vitest";
import type { SlotImage } from "../../../composables/types";
import {
  fileNameFromPath,
  getNextSlotImageOffset,
  getRotatedImageDimensions,
  getRotatedImageDrawBox,
  getSlotIndexFromClientPosition,
  getSlotImagePlacement,
  imageMimeType,
  normalizeImageRotation,
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
    rotation: 0,
    ...overrides,
  };
}

function createSlotImages(
  selectedIndex: number | null = 0,
  previewScale = 1,
  cellCount = 1,
  bridge: { readDroppedImageFile?: (filePath: string) => Promise<Uint8Array> } = {},
  showNotice: (message: string) => void = () => {},
) {
  const selectedSlotIndex = ref<number | null>(selectedIndex);
  const composable = useImageProcessSlotImages({
    activeSlotIndex: shallowRef(0),
    selectedSlotIndex,
    visibleCells: computed(() => Array.from({ length: cellCount }, (_, index) => ({ x: index * (100 / cellCount), y: 0, w: 100 / cellCount, h: 100 }))),
    previewBoard: ref(null),
    bridge,
    createId: () => "image-1",
    showNotice,
    clearNotice: () => {},
    getSlotViewport: () => ({ width: 100, height: 100 }),
    previewScale: shallowRef(previewScale),
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

  it("places all dropped browser files into consecutive visible slots", () => {
    const originalCreateObjectURL = URL.createObjectURL;
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: vi.fn((file: File) => `blob:${file.name}`) });
    try {
      const composable = createSlotImages(null, 1, 4);
      const files = ["one.jpg", "two.jpg", "three.jpg"].map((name) => new File([name], name, { type: "image/jpeg" }));
      composable.handleSlotDrop({
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
        dataTransfer: { files },
      } as unknown as DragEvent, 2);

      expect(composable.slotImages.value.slice(0, 4).map((image) => image?.name ?? null)).toEqual([
        "one.jpg",
        "two.jpg",
        "three.jpg",
        null,
      ]);
    } finally {
      if (originalCreateObjectURL) Object.defineProperty(URL, "createObjectURL", { configurable: true, value: originalCreateObjectURL });
      else Reflect.deleteProperty(URL, "createObjectURL");
    }
  });

  it("places all dropped Tauri paths into consecutive visible slots", async () => {
    const originalCreateObjectURL = URL.createObjectURL;
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: vi.fn((file: File) => `blob:${file.name}`) });
    try {
      const readDroppedImageFile = vi.fn(async (filePath: string) => new TextEncoder().encode(filePath));
      const composable = createSlotImages(null, 1, 3, { readDroppedImageFile });

      await composable.acceptDroppedPaths(["D:\\covers\\one.jpg", "D:\\covers\\two.jpg", "D:\\covers\\three.jpg"], 2);

      expect(readDroppedImageFile).toHaveBeenCalledTimes(3);
      expect(composable.slotImages.value.slice(0, 3).map((image) => image?.name)).toEqual(["one.jpg", "two.jpg", "three.jpg"]);
    } finally {
      if (originalCreateObjectURL) Object.defineProperty(URL, "createObjectURL", { configurable: true, value: originalCreateObjectURL });
      else Reflect.deleteProperty(URL, "createObjectURL");
    }
  });

  it("does not let an older Tauri drop overwrite a newer drop", async () => {
    const originalCreateObjectURL = URL.createObjectURL;
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: vi.fn((file: File) => `blob:${file.name}`) });
    let resolveOlder!: (bytes: Uint8Array) => void;
    try {
      const readDroppedImageFile = vi.fn((filePath: string) =>
        filePath.endsWith("older.jpg")
          ? new Promise<Uint8Array>((resolve) => { resolveOlder = resolve; })
          : Promise.resolve(new TextEncoder().encode(filePath)),
      );
      const composable = createSlotImages(null, 1, 1, { readDroppedImageFile });

      const olderDrop = composable.acceptDroppedPaths(["D:\\covers\\older.jpg"], 0);
      await composable.acceptDroppedPaths(["D:\\covers\\newer.jpg"], 0);
      resolveOlder(new TextEncoder().encode("older"));
      await olderDrop;

      expect(composable.slotImages.value[0]?.name).toBe("newer.jpg");
    } finally {
      if (originalCreateObjectURL) Object.defineProperty(URL, "createObjectURL", { configurable: true, value: originalCreateObjectURL });
      else Reflect.deleteProperty(URL, "createObjectURL");
    }
  });

  it("does not show an error when an older Tauri drop fails after a newer drop", async () => {
    let rejectOlder!: (reason?: unknown) => void;
    const showNotice = vi.fn();
    const readDroppedImageFile = vi.fn((filePath: string) =>
      filePath.endsWith("older.jpg")
        ? new Promise<Uint8Array>((_, reject) => { rejectOlder = reject; })
        : Promise.resolve(new TextEncoder().encode(filePath)),
    );
    const composable = createSlotImages(null, 1, 1, { readDroppedImageFile }, showNotice);

    const olderDrop = composable.acceptDroppedPaths(["D:\\covers\\older.jpg"], 0);
    await composable.acceptDroppedPaths(["D:\\covers\\newer.jpg"], 0);
    rejectOlder(new Error("旧请求读取失败"));
    await olderDrop;

    expect(showNotice).not.toHaveBeenCalled();
  });

  it("ignores a pending Tauri drop after cleanup without creating an object URL", async () => {
    const originalCreateObjectURL = URL.createObjectURL;
    const createObjectURL = vi.fn((file: File) => `blob:${file.name}`);
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: createObjectURL });
    let resolveRead!: (bytes: Uint8Array) => void;
    try {
      const composable = createSlotImages(null, 1, 1, {
        readDroppedImageFile: () => new Promise<Uint8Array>((resolve) => { resolveRead = resolve; }),
      });

      const pendingDrop = composable.acceptDroppedPaths(["D:\\covers\\pending.jpg"], 0);
      composable.cleanupSlotImages();
      resolveRead(new TextEncoder().encode("pending"));
      await pendingDrop;

      expect(composable.slotImages.value[0]).toBeNull();
      expect(createObjectURL).not.toHaveBeenCalled();
    } finally {
      if (originalCreateObjectURL) Object.defineProperty(URL, "createObjectURL", { configurable: true, value: originalCreateObjectURL });
      else Reflect.deleteProperty(URL, "createObjectURL");
    }
  });

  it("does not show an error when a pending Tauri drop fails after cleanup", async () => {
    let rejectRead!: (reason?: unknown) => void;
    const showNotice = vi.fn();
    const composable = createSlotImages(null, 1, 1, {
      readDroppedImageFile: () => new Promise<Uint8Array>((_, reject) => { rejectRead = reject; }),
    }, showNotice);

    const pendingDrop = composable.acceptDroppedPaths(["D:\\covers\\pending.jpg"], 0);
    composable.cleanupSlotImages();
    rejectRead(new Error("弹窗关闭后读取失败"));
    await pendingDrop;

    expect(showNotice).not.toHaveBeenCalled();
  });

  it("normalizes quarter-turn rotations and swaps effective dimensions", () => {
    expect(normalizeImageRotation(-90)).toBe(270);
    expect(normalizeImageRotation(450)).toBe(90);
    expect(normalizeImageRotation(45)).toBe(0);
    expect(getRotatedImageDimensions(400, 200, 90)).toEqual({ width: 200, height: 400 });
    expect(getRotatedImageDimensions(400, 200, 180)).toEqual({ width: 400, height: 200 });
  });

  it("centers the rotated bitmap box around its placement", () => {
    const placement = getSlotImagePlacement({ imageWidth: 100, imageHeight: 200, viewportWidth: 300, viewportHeight: 300, scale: 1, offsetX: 0, offsetY: 0 });
    const box = getRotatedImageDrawBox(placement, 90);
    expect(box).toEqual({
      x: placement.x + placement.width / 2 - placement.height / 2,
      y: placement.y + placement.height / 2 - placement.width / 2,
      width: placement.height,
      height: placement.width,
    });
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

  it("starts panning only for the selected image with an overflowing axis", () => {
    const selected = createSlotImages(0);
    selected.slotImages.value[0] = createSlotImage({ scale: 2 });
    const pointerDown = new PointerEvent("pointerdown", { pointerId: 1, clientX: 10, clientY: 10 });

    expect(selected.startSlotImagePan(pointerDown, 0)).toBe(true);
    selected.cancelSlotImagePan();

    const unselected = createSlotImages(null);
    unselected.slotImages.value[0] = createSlotImage({ scale: 2 });
    expect(unselected.startSlotImagePan(pointerDown, 0)).toBe(false);

    selected.slotImages.value[0] = createSlotImage({ scale: 1 });
    expect(selected.startSlotImagePan(pointerDown, 0)).toBe(true);
    selected.cancelSlotImagePan();

    selected.slotImages.value[0] = createSlotImage({ naturalWidth: 100, naturalHeight: 100, scale: 1 });
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

  it("converts pointer movement by the preview scale", () => {
    const composable = createSlotImages(0, 0.5);
    composable.slotImages.value[0] = createSlotImage({ scale: 1 });

    composable.startSlotImagePan(new PointerEvent("pointerdown", { pointerId: 1, clientX: 10, clientY: 10 }), 0);
    window.dispatchEvent(new PointerEvent("pointermove", { pointerId: 1, clientX: 35, clientY: 10 }));

    expect(composable.slotImages.value[0]?.offsetX).toBe(1);
    window.dispatchEvent(new PointerEvent("pointerup", { pointerId: 1 }));
  });

  it("maps a visually scaled pointer position to the logical slot", () => {
    expect(getSlotIndexFromClientPosition({
      clientX: 137.5,
      clientY: 125,
      boardLeft: 100,
      boardTop: 100,
      boardWidth: 100,
      boardHeight: 100,
      previewScale: 0.5,
      borderTop: 0,
      borderRight: 0,
      borderBottom: 0,
      borderLeft: 0,
      cells: [
        { x: 0, y: 0, w: 50, h: 100 },
        { x: 50, y: 0, w: 50, h: 100 },
      ],
    })).toBe(1);
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

  it("rotates the selected foreground image while preserving scale and recentering", () => {
    const composable = createSlotImages();
    composable.slotImages.value[0] = createSlotImage({ scale: 1.5, offsetX: 0.8, offsetY: -0.4 });
    composable.rotateSlot(0, -90);
    expect(composable.slotImages.value[0]).toMatchObject({ rotation: 270, scale: 1.5, offsetX: 0, offsetY: 0 });
    composable.resetSlotZoom(0);
    expect(composable.slotImages.value[0]).toMatchObject({ rotation: 0, scale: 1, offsetX: 0, offsetY: 0 });
  });
});
