import { ref } from "vue";
import { describe, expect, it } from "vitest";
import type { Annotation } from "../../../composables/types";
import {
  arrowEndpoints,
  getCenteredTextPosition,
  getTextAnnotationLines,
  getTextLineOffsets,
  measureTextAnnotationBounds,
  normalizeArrowAnnotation,
  useImageProcessAnnotations,
} from "../../../composables/useImageProcessAnnotations";

function baseArrow(): Annotation {
  return {
    id: "arrow-1",
    kind: "arrow",
    x: 0.2,
    y: 0.3,
    w: 0.4,
    h: 0.2,
    text: "",
    color: "#ff3b30",
    fontSize: 48,
    strokeWidth: 5,
    rotation: 0,
  };
}

function createAnnotations() {
  const board = document.createElement("div");
  Object.defineProperty(board, "clientWidth", { configurable: true, value: 1000 });
  Object.defineProperty(board, "clientHeight", { configurable: true, value: 600 });
  board.getBoundingClientRect = () => ({ x: 0, y: 0, left: 0, top: 0, right: 1000, bottom: 600, width: 1000, height: 600, toJSON: () => ({}) });
  let id = 0;
  return useImageProcessAnnotations({ previewBoard: ref(board), createId: (prefix) => `${prefix}-${++id}` });
}

describe("image process annotations", () => {
  it("preserves explicit and empty text lines", () => {
    expect(getTextAnnotationLines("第一行\n\n第三行")).toEqual(["第一行", "", "第三行"]);
    expect(getTextAnnotationLines("")).toEqual([""]);
  });

  it("measures width by the longest line and height by line count", () => {
    const measureLine = (line: string) => line.length * 20;

    expect(measureTextAnnotationBounds("长文字\n短", 30, measureLine)).toEqual({
      width: 64,
      height: 73,
    });
  });

  it("returns one canvas offset per text line", () => {
    expect(getTextLineOffsets("第一行\n\n第三行", 34.5)).toEqual([0, 34.5, 69]);
  });

  it("creates text with the requested default style", () => {
    const board = document.createElement("div");
    Object.defineProperty(board, "clientWidth", { configurable: true, value: 1000 });
    Object.defineProperty(board, "clientHeight", { configurable: true, value: 600 });
    const composable = useImageProcessAnnotations({ previewBoard: ref(board), createId: () => "text-1" });

    composable.addAnnotation("text");

    expect(composable.annotations.value[0]).toMatchObject({
      fontSize: 30,
      color: "#fef730",
      textAlign: "left",
    });
  });

  it("snaps a text box center independently to the visual board axes", () => {
    expect(getCenteredTextPosition({ x: 0.395, y: 0.2, w: 0.2, h: 0.1, boardWidth: 1000, boardHeight: 600, threshold: 6 }))
      .toEqual({ x: 0.4, y: 0.2, guideX: true, guideY: false });
    expect(getCenteredTextPosition({ x: 0.1, y: 0.445, w: 0.2, h: 0.1, boardWidth: 1000, boardHeight: 600, threshold: 6 }))
      .toEqual({ x: 0.1, y: 0.45, guideX: false, guideY: true });
  });

  it("derives legacy arrow endpoints from bounds and reverse flags", () => {
    const endpoints = arrowEndpoints(baseArrow());
    expect(endpoints.startX).toBeCloseTo(0.2);
    expect(endpoints.startY).toBeCloseTo(0.3);
    expect(endpoints.endX).toBeCloseTo(0.6);
    expect(endpoints.endY).toBeCloseTo(0.5);

    const reversedEndpoints = arrowEndpoints({ ...baseArrow(), arrowReverseX: true, arrowReverseY: true });
    expect(reversedEndpoints.startX).toBeCloseTo(0.6);
    expect(reversedEndpoints.startY).toBeCloseTo(0.5);
    expect(reversedEndpoints.endX).toBeCloseTo(0.2);
    expect(reversedEndpoints.endY).toBeCloseTo(0.3);
  });

  it("normalizes arrow endpoints and keeps explicit endpoint coordinates", () => {
    const annotation = normalizeArrowAnnotation(baseArrow(), 0.8, -0.2, 0.1, 1.2);

    expect(annotation.x).toBeCloseTo(0.1);
    expect(annotation.y).toBeCloseTo(0);
    expect(annotation.w).toBeCloseTo(0.7);
    expect(annotation.h).toBeCloseTo(1);
    expect(annotation.arrowReverseX).toBe(true);
    expect(annotation.arrowReverseY).toBe(false);
    expect(annotation.arrowStartX).toBeCloseTo(0.8);
    expect(annotation.arrowStartY).toBeCloseTo(0);
    expect(annotation.arrowEndX).toBeCloseTo(0.1);
    expect(annotation.arrowEndY).toBeCloseTo(1);
    expect(arrowEndpoints(annotation)).toEqual({
      startX: 0.8,
      startY: 0,
      endX: 0.1,
      endY: 1,
    });
  });

  it("undoes annotation creation and groups one focused text edit", () => {
    const composable = createAnnotations();
    const id = composable.addAnnotation("text");
    expect(composable.canUndo.value).toBe(true);
    composable.beginTextAnnotationEdit(id);
    composable.updateAnnotation(id, { text: "第一行" });
    composable.updateAnnotation(id, { text: "第一行\n第二行" });
    composable.undoAnnotations();
    expect(composable.annotations.value[0]?.text).toBe("");
    composable.undoAnnotations();
    expect(composable.annotations.value).toEqual([]);
  });

  it("keeps only the latest fifty annotation snapshots", () => {
    const composable = createAnnotations();
    for (let index = 0; index < 55; index += 1) composable.addAnnotation("text");
    for (let index = 0; index < 50; index += 1) composable.undoAnnotations();
    expect(composable.annotations.value).toHaveLength(5);
    expect(composable.canUndo.value).toBe(false);
  });

  it("restores a cancelled drag and removes its active listeners", () => {
    const composable = createAnnotations();
    const id = composable.addAnnotation("text");
    const before = { ...composable.annotations.value[0]! };
    composable.startAnnotationDrag(new PointerEvent("pointerdown", { pointerId: 1, clientX: 0, clientY: 0 }), before);
    window.dispatchEvent(new PointerEvent("pointermove", { pointerId: 1, clientX: 100, clientY: 60 }));
    expect(composable.annotations.value[0]).not.toMatchObject({ x: before.x, y: before.y });

    composable.undoAnnotations();
    window.dispatchEvent(new PointerEvent("pointermove", { pointerId: 1, clientX: 200, clientY: 120 }));

    expect(composable.annotations.value[0]).toMatchObject({ id, x: before.x, y: before.y });
  });

  it("stores one completed drag as one undo step", () => {
    const composable = createAnnotations();
    const id = composable.addAnnotation("text");
    const before = { ...composable.annotations.value[0]! };
    composable.startAnnotationDrag(new PointerEvent("pointerdown", { pointerId: 1, clientX: 0, clientY: 0 }), before);
    window.dispatchEvent(new PointerEvent("pointermove", { pointerId: 1, clientX: 50, clientY: 30 }));
    window.dispatchEvent(new PointerEvent("pointermove", { pointerId: 1, clientX: 100, clientY: 60 }));
    window.dispatchEvent(new PointerEvent("pointerup", { pointerId: 1 }));

    composable.undoAnnotations();
    expect(composable.annotations.value[0]).toMatchObject({ id, x: before.x, y: before.y });
    composable.undoAnnotations();
    expect(composable.annotations.value).toEqual([]);
  });

  it("stores a sub-threshold drag when it changes the annotation position", () => {
    const composable = createAnnotations();
    const id = composable.addAnnotation("text");
    const before = { ...composable.annotations.value[0]! };
    composable.startAnnotationDrag(new PointerEvent("pointerdown", { pointerId: 1, clientX: 0, clientY: 0 }), before);
    window.dispatchEvent(new PointerEvent("pointermove", { pointerId: 1, clientX: 2, clientY: 0 }));
    window.dispatchEvent(new PointerEvent("pointerup", { pointerId: 1 }));

    expect(composable.annotations.value[0]?.x).not.toBe(before.x);
    composable.undoAnnotations();
    expect(composable.annotations.value[0]).toMatchObject({ id, x: before.x, y: before.y });
  });

  it("does not add an undo step when a finished text preview is only selected", () => {
    const composable = createAnnotations();
    composable.addAnnotation("text");
    composable.finishAnnotationEditing();
    const annotation = composable.annotations.value[0]!;
    composable.startAnnotationDrag(new PointerEvent("pointerdown", { pointerId: 1, clientX: 0, clientY: 0 }), annotation);
    window.dispatchEvent(new PointerEvent("pointerup", { pointerId: 1 }));

    composable.undoAnnotations();

    expect(composable.annotations.value).toEqual([]);
  });
});
