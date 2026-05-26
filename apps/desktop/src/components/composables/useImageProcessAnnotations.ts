import { reactive, ref, shallowRef } from "vue";
import type { Ref } from "vue";
import type { Annotation, AnnotationDragMode, AnnotationKind, DrawingKind } from "./types";
import { defaultAnnotationFontSize, shapeResizeHandles, textResizeHandles } from "./constants";

interface UseImageProcessAnnotationsOptions {
  previewBoard: Readonly<Ref<HTMLElement | null>>;
  createId: (prefix: string) => string;
}

export function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function arrowEndpoints(annotation: Annotation) {
  if (
    typeof annotation.arrowStartX === "number" &&
    typeof annotation.arrowStartY === "number" &&
    typeof annotation.arrowEndX === "number" &&
    typeof annotation.arrowEndY === "number"
  ) {
    return {
      startX: annotation.arrowStartX,
      startY: annotation.arrowStartY,
      endX: annotation.arrowEndX,
      endY: annotation.arrowEndY,
    };
  }

  return {
    startX: annotation.arrowReverseX ? annotation.x + annotation.w : annotation.x,
    startY: annotation.arrowReverseY ? annotation.y + annotation.h : annotation.y,
    endX: annotation.arrowReverseX ? annotation.x : annotation.x + annotation.w,
    endY: annotation.arrowReverseY ? annotation.y : annotation.y + annotation.h,
  };
}

export function normalizeArrowAnnotation(annotation: Annotation, startX: number, startY: number, endX: number, endY: number): Annotation {
  const nextStartX = clamp(startX, 0, 1);
  const nextStartY = clamp(startY, 0, 1);
  const nextEndX = clamp(endX, 0, 1);
  const nextEndY = clamp(endY, 0, 1);
  const x = Math.min(nextStartX, nextEndX);
  const y = Math.min(nextStartY, nextEndY);
  const w = Math.abs(nextEndX - nextStartX);
  const h = Math.abs(nextEndY - nextStartY);

  return {
    ...annotation,
    x,
    y,
    w,
    h,
    arrowReverseX: nextEndX < nextStartX,
    arrowReverseY: nextEndY < nextStartY,
    arrowStartX: nextStartX,
    arrowStartY: nextStartY,
    arrowEndX: nextEndX,
    arrowEndY: nextEndY,
  };
}

export function useImageProcessAnnotations(options: UseImageProcessAnnotationsOptions) {
  const selectedAnnotationId = shallowRef("");
  const draggingAnnotationId = shallowRef("");
  const annotationDragMode = shallowRef<AnnotationDragMode>("move");
  const activeDrawingKind = ref<DrawingKind | null>(null);
  const creatingAnnotationId = shallowRef("");
  const suppressNextBoardClick = shallowRef(false);
  const annotations = ref<Annotation[]>([]);
  const annotationDrag = reactive({
    startX: 0,
    startY: 0,
    originX: 0,
    originY: 0,
    originW: 0,
    originH: 0,
    originArrowStartX: 0,
    originArrowStartY: 0,
    originArrowEndX: 0,
    originArrowEndY: 0,
    originFontSize: 0,
    originRotation: 0,
    startAngle: 0,
    hasMoved: false,
  });
  const creationDrag = reactive({
    startX: 0,
    startY: 0,
  });

  function measureTextAnnotation(text: string, fontSize: number) {
    const content = text || " ";
    let width = Array.from(content).length * fontSize * 0.9;
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    if (context) {
      context.font = `700 ${fontSize}px "Microsoft YaHei UI", sans-serif`;
      width = context.measureText(content).width;
    }

    return {
      width: Math.max(fontSize * 0.75, width + 4),
      height: Math.max(fontSize * 1.15, fontSize + 4),
    };
  }

  function measuredTextAnnotation(annotation: Annotation, anchorX: "left" | "right" = "left", anchorY: "top" | "bottom" = "top") {
    const boardWidth = Math.max(1, options.previewBoard.value?.clientWidth ?? 980);
    const boardHeight = Math.max(1, options.previewBoard.value?.clientHeight ?? 640);
    const measured = measureTextAnnotation(annotation.text, annotation.fontSize);
    const w = clamp(measured.width / boardWidth, 0.01, 1);
    const h = clamp(measured.height / boardHeight, 0.01, 1);
    const right = annotation.x + annotation.w;
    const bottom = annotation.y + annotation.h;

    return {
      ...annotation,
      x: anchorX === "right" ? clamp(right - w, 0, 1 - w) : clamp(annotation.x, 0, 1 - w),
      y: anchorY === "bottom" ? clamp(bottom - h, 0, 1 - h) : clamp(annotation.y, 0, 1 - h),
      w,
      h,
    };
  }

  function arrowLayout(annotation: Annotation) {
    const boardWidth = Math.max(1, options.previewBoard.value?.clientWidth ?? 980);
    const boardHeight = Math.max(1, options.previewBoard.value?.clientHeight ?? 640);
    const paddingX = Math.max(12, annotation.strokeWidth * 2.4) / boardWidth;
    const paddingY = Math.max(12, annotation.strokeWidth * 2.4) / boardHeight;
    const endpoints = arrowEndpoints(annotation);
    const left = clamp(Math.min(endpoints.startX, endpoints.endX) - paddingX, 0, 1);
    const top = clamp(Math.min(endpoints.startY, endpoints.endY) - paddingY, 0, 1);
    const right = clamp(Math.max(endpoints.startX, endpoints.endX) + paddingX, left + 0.001, 1);
    const bottom = clamp(Math.max(endpoints.startY, endpoints.endY) + paddingY, top + 0.001, 1);
    const w = Math.max(0.001, right - left);
    const h = Math.max(0.001, bottom - top);

    return {
      left,
      top,
      w,
      h,
      startX: ((endpoints.startX - left) / w) * 100,
      startY: ((endpoints.startY - top) / h) * 100,
      endX: ((endpoints.endX - left) / w) * 100,
      endY: ((endpoints.endY - top) / h) * 100,
    };
  }

  function resizeAnnotationFromDrag(annotation: Annotation, deltaX: number, deltaY: number) {
    if (annotation.kind === "text") {
      return resizeTextAnnotationFromDrag(annotation, deltaX, deltaY);
    }

    const minSize = 0.04;
    let x = annotationDrag.originX;
    let y = annotationDrag.originY;
    let w = annotationDrag.originW;
    let h = annotationDrag.originH;

    if (annotationDragMode.value === "resize-se") {
      w = annotationDrag.originW + deltaX;
      h = annotationDrag.originH + deltaY;
    } else if (annotationDragMode.value === "resize-s") {
      h = annotationDrag.originH + deltaY;
    } else if (annotationDragMode.value === "resize-e") {
      w = annotationDrag.originW + deltaX;
    } else if (annotationDragMode.value === "resize-sw") {
      x = annotationDrag.originX + deltaX;
      w = annotationDrag.originW - deltaX;
      h = annotationDrag.originH + deltaY;
    } else if (annotationDragMode.value === "resize-w") {
      x = annotationDrag.originX + deltaX;
      w = annotationDrag.originW - deltaX;
    } else if (annotationDragMode.value === "resize-ne") {
      y = annotationDrag.originY + deltaY;
      w = annotationDrag.originW + deltaX;
      h = annotationDrag.originH - deltaY;
    } else if (annotationDragMode.value === "resize-n") {
      y = annotationDrag.originY + deltaY;
      h = annotationDrag.originH - deltaY;
    } else if (annotationDragMode.value === "resize-nw") {
      x = annotationDrag.originX + deltaX;
      y = annotationDrag.originY + deltaY;
      w = annotationDrag.originW - deltaX;
      h = annotationDrag.originH - deltaY;
    }

    if (annotationDragMode.value.includes("w")) {
      x = clamp(x, 0, annotationDrag.originX + annotationDrag.originW - minSize);
      w = annotationDrag.originX + annotationDrag.originW - x;
    } else {
      w = clamp(w, minSize, 1 - annotation.x);
    }

    if (annotationDragMode.value.includes("n")) {
      y = clamp(y, 0, annotationDrag.originY + annotationDrag.originH - minSize);
      h = annotationDrag.originY + annotationDrag.originH - y;
    } else {
      h = clamp(h, minSize, 1 - annotation.y);
    }

    return {
      ...annotation,
      x,
      y,
      w: clamp(w, minSize, 1 - x),
      h: clamp(h, minSize, 1 - y),
    };
  }

  function resizeTextAnnotationFromDrag(annotation: Annotation, deltaX: number, deltaY: number) {
    const boardWidth = Math.max(1, options.previewBoard.value?.clientWidth ?? 980);
    const boardHeight = Math.max(1, options.previewBoard.value?.clientHeight ?? 640);
    const minPixelSize = 12;
    const originWidth = Math.max(minPixelSize, annotationDrag.originW * boardWidth);
    const originHeight = Math.max(minPixelSize, annotationDrag.originH * boardHeight);
    let targetWidth = originWidth;
    let targetHeight = originHeight;

    if (annotationDragMode.value.includes("e")) {
      targetWidth = originWidth + deltaX * boardWidth;
    } else if (annotationDragMode.value.includes("w")) {
      targetWidth = originWidth - deltaX * boardWidth;
    }

    if (annotationDragMode.value.includes("s")) {
      targetHeight = originHeight + deltaY * boardHeight;
    } else if (annotationDragMode.value.includes("n")) {
      targetHeight = originHeight - deltaY * boardHeight;
    }

    const scale = Math.max(targetWidth / originWidth, targetHeight / originHeight);
    const fontSize = clamp(Math.round(annotationDrag.originFontSize * scale), 12, 180);
    return measuredTextAnnotation(
      { ...annotation, fontSize },
      annotationDragMode.value.includes("w") ? "right" : "left",
      annotationDragMode.value.includes("n") ? "bottom" : "top",
    );
  }

  function updateArrowPointFromDrag(annotation: Annotation, deltaX: number, deltaY: number, point: "start" | "end") {
    const startX = annotationDrag.originArrowStartX;
    const startY = annotationDrag.originArrowStartY;
    const endX = annotationDrag.originArrowEndX;
    const endY = annotationDrag.originArrowEndY;
    const movedX = clamp((point === "start" ? startX : endX) + deltaX, 0, 1);
    const movedY = clamp((point === "start" ? startY : endY) + deltaY, 0, 1);
    const nextStartX = point === "start" ? movedX : startX;
    const nextStartY = point === "start" ? movedY : startY;
    const nextEndX = point === "end" ? movedX : endX;
    const nextEndY = point === "end" ? movedY : endY;

    return normalizeArrowAnnotation(annotation, nextStartX, nextStartY, nextEndX, nextEndY);
  }

  function moveArrowFromDrag(annotation: Annotation, deltaX: number, deltaY: number) {
    const minX = Math.min(annotationDrag.originArrowStartX, annotationDrag.originArrowEndX);
    const maxX = Math.max(annotationDrag.originArrowStartX, annotationDrag.originArrowEndX);
    const minY = Math.min(annotationDrag.originArrowStartY, annotationDrag.originArrowEndY);
    const maxY = Math.max(annotationDrag.originArrowStartY, annotationDrag.originArrowEndY);
    const safeDeltaX = clamp(deltaX, -minX, 1 - maxX);
    const safeDeltaY = clamp(deltaY, -minY, 1 - maxY);

    return normalizeArrowAnnotation(
      annotation,
      annotationDrag.originArrowStartX + safeDeltaX,
      annotationDrag.originArrowStartY + safeDeltaY,
      annotationDrag.originArrowEndX + safeDeltaX,
      annotationDrag.originArrowEndY + safeDeltaY,
    );
  }

  function clearAnnotations() {
    annotations.value = [];
    activeDrawingKind.value = null;
  }

  function addAnnotation(kind: AnnotationKind) {
    const base = annotations.value.length * 0.035;
    let annotation: Annotation = {
      id: options.createId(kind),
      kind,
      x: clamp(0.42 + base, 0.08, 0.82),
      y: clamp(0.42 + base, 0.08, 0.82),
      w: kind === "arrow" ? 0.2 : 0.16,
      h: kind === "arrow" ? 0.12 : 0.16,
      text: "",
      color: kind === "text" ? "#ff3b30" : "#ff3b30",
      fontSize: defaultAnnotationFontSize,
      strokeWidth: kind === "text" ? 2 : 5,
      rotation: 0,
    };
    if (kind === "text") {
      annotation = measuredTextAnnotation(annotation);
    }
    annotations.value = [...annotations.value, annotation];
    selectedAnnotationId.value = annotation.id;
    return annotation.id;
  }

  function selectDrawingTool(kind: DrawingKind) {
    activeDrawingKind.value = activeDrawingKind.value === kind ? null : kind;
    selectedAnnotationId.value = "";
  }

  function annotationStyle(annotation: Annotation) {
    if (annotation.kind === "arrow") {
      const layout = arrowLayout(annotation);
      return {
        left: `${layout.left * 100}%`,
        top: `${layout.top * 100}%`,
        width: `${layout.w * 100}%`,
        height: `${layout.h * 100}%`,
        color: annotation.color,
        fontSize: `${annotation.fontSize}px`,
        "--annotation-line-width": `${annotation.strokeWidth}px`,
        "--annotation-rotation": `${annotation.rotation}deg`,
        "--arrow-start-x": `${layout.startX}%`,
        "--arrow-start-y": `${layout.startY}%`,
        "--arrow-end-x": `${layout.endX}%`,
        "--arrow-end-y": `${layout.endY}%`,
      };
    }

    return {
      left: `${annotation.x * 100}%`,
      top: `${annotation.y * 100}%`,
      width: `${annotation.w * 100}%`,
      height: `${annotation.h * 100}%`,
      color: annotation.color,
      fontSize: `${annotation.fontSize}px`,
      "--annotation-line-width": `${annotation.strokeWidth}px`,
      "--annotation-rotation": `${annotation.rotation}deg`,
    };
  }

  function arrowHandleStyle(annotation: Annotation, point: "start" | "end") {
    const layout = arrowLayout(annotation);
    return {
      left: `${point === "start" ? layout.startX : layout.endX}%`,
      top: `${point === "start" ? layout.startY : layout.endY}%`,
    };
  }

  function arrowPreviewGeometry(annotation: Annotation) {
    const layout = arrowLayout(annotation);
    const boardWidth = Math.max(1, options.previewBoard.value?.clientWidth ?? 980);
    const boardHeight = Math.max(1, options.previewBoard.value?.clientHeight ?? 640);
    const boxWidth = Math.max(1, layout.w * boardWidth);
    const boxHeight = Math.max(1, layout.h * boardHeight);
    const startX = (layout.startX / 100) * boxWidth;
    const startY = (layout.startY / 100) * boxHeight;
    const endX = (layout.endX / 100) * boxWidth;
    const endY = (layout.endY / 100) * boxHeight;
    const angle = Math.atan2(endY - startY, endX - startX);
    const headLength = clamp(annotation.strokeWidth * 2.6, 8, 18);
    const headWidth = clamp(annotation.strokeWidth * 1.9, 6, 14);
    const baseX = endX - headLength * Math.cos(angle);
    const baseY = endY - headLength * Math.sin(angle);
    const normalX = Math.cos(angle + Math.PI / 2);
    const normalY = Math.sin(angle + Math.PI / 2);

    return {
      boxWidth,
      boxHeight,
      startX,
      startY,
      endX,
      endY,
      bodyEndX: baseX,
      bodyEndY: baseY,
      headPoints: [
        [endX, endY],
        [baseX + (headWidth / 2) * normalX, baseY + (headWidth / 2) * normalY],
        [baseX - (headWidth / 2) * normalX, baseY - (headWidth / 2) * normalY],
      ],
    };
  }

  function arrowSvgViewBox(annotation: Annotation) {
    const geometry = arrowPreviewGeometry(annotation);
    return `0 0 ${geometry.boxWidth} ${geometry.boxHeight}`;
  }

  function arrowSvgCoordinate(annotation: Annotation, point: "start" | "end", axis: "x" | "y") {
    const geometry = arrowPreviewGeometry(annotation);
    if (point === "start") return axis === "x" ? geometry.startX : geometry.startY;
    return axis === "x" ? geometry.endX : geometry.endY;
  }

  function arrowBodyEndCoordinate(annotation: Annotation, axis: "x" | "y") {
    const geometry = arrowPreviewGeometry(annotation);
    return axis === "x" ? geometry.bodyEndX : geometry.bodyEndY;
  }

  function arrowHeadPoints(annotation: Annotation) {
    return arrowPreviewGeometry(annotation)
      .headPoints.map(([x, y]) => `${x},${y}`)
      .join(" ");
  }

  function shouldShowAnnotationToolbar(annotation: Annotation) {
    if (selectedAnnotationId.value !== annotation.id) return false;
    return draggingAnnotationId.value !== annotation.id && creatingAnnotationId.value !== annotation.id;
  }

  function shouldShowArrowHandles(annotation: Annotation) {
    return annotation.kind === "arrow" && selectedAnnotationId.value === annotation.id;
  }

  function shouldShowResizeHandles(annotation: Annotation) {
    return annotation.kind !== "arrow" && selectedAnnotationId.value === annotation.id;
  }

  function resizeHandlesFor(kind: AnnotationKind) {
    return kind === "text" ? textResizeHandles : shapeResizeHandles;
  }

  function updateAnnotation(annotationId: string, patch: Partial<Annotation>) {
    annotations.value = annotations.value.map((annotation) => {
      if (annotation.id !== annotationId) return annotation;
      const nextAnnotation = { ...annotation, ...patch };
      return nextAnnotation.kind === "text" && ("text" in patch || "fontSize" in patch) ? measuredTextAnnotation(nextAnnotation) : nextAnnotation;
    });
  }

  function copyAnnotation(annotation: Annotation) {
    const copy: Annotation = {
      ...annotation,
      id: options.createId(annotation.kind),
      x: clamp(annotation.x + 0.03, 0, 1 - annotation.w),
      y: clamp(annotation.y + 0.03, 0, 1 - annotation.h),
    };
    annotations.value = [...annotations.value, copy];
    selectedAnnotationId.value = copy.id;
  }

  function deleteAnnotation(annotationId: string) {
    annotations.value = annotations.value.filter((annotation) => annotation.id !== annotationId);
    if (selectedAnnotationId.value === annotationId) {
      selectedAnnotationId.value = "";
    }
  }

  function startAnnotationDrag(event: PointerEvent, annotation: Annotation, mode: AnnotationDragMode = "move") {
    event.preventDefault();
    event.stopPropagation();
    selectedAnnotationId.value = annotation.id;
    activeDrawingKind.value = null;
    draggingAnnotationId.value = annotation.id;
    annotationDragMode.value = mode;
    annotationDrag.startX = event.clientX;
    annotationDrag.startY = event.clientY;
    annotationDrag.hasMoved = false;
    annotationDrag.originX = annotation.x;
    annotationDrag.originY = annotation.y;
    annotationDrag.originW = annotation.w;
    annotationDrag.originH = annotation.h;
    const endpoints = arrowEndpoints(annotation);
    annotationDrag.originArrowStartX = endpoints.startX;
    annotationDrag.originArrowStartY = endpoints.startY;
    annotationDrag.originArrowEndX = endpoints.endX;
    annotationDrag.originArrowEndY = endpoints.endY;
    annotationDrag.originFontSize = annotation.fontSize;
    annotationDrag.originRotation = annotation.rotation;

    if (mode === "rotate" && options.previewBoard.value) {
      const rect = options.previewBoard.value.getBoundingClientRect();
      const centerX = rect.left + (annotation.x + annotation.w / 2) * rect.width;
      const centerY = rect.top + (annotation.y + annotation.h / 2) * rect.height;
      annotationDrag.startAngle = Math.atan2(event.clientY - centerY, event.clientX - centerX);
    }

    window.addEventListener("pointermove", handleAnnotationDrag);
    window.addEventListener("pointerup", stopAnnotationDrag, { once: true });
  }

  function startTextAnnotationPointer(event: PointerEvent, annotation: Annotation) {
    event.stopPropagation();
    selectedAnnotationId.value = annotation.id;
    activeDrawingKind.value = null;
    draggingAnnotationId.value = annotation.id;
    annotationDragMode.value = "move";
    annotationDrag.startX = event.clientX;
    annotationDrag.startY = event.clientY;
    annotationDrag.hasMoved = false;
    annotationDrag.originX = annotation.x;
    annotationDrag.originY = annotation.y;
    annotationDrag.originW = annotation.w;
    annotationDrag.originH = annotation.h;
    const endpoints = arrowEndpoints(annotation);
    annotationDrag.originArrowStartX = endpoints.startX;
    annotationDrag.originArrowStartY = endpoints.startY;
    annotationDrag.originArrowEndX = endpoints.endX;
    annotationDrag.originArrowEndY = endpoints.endY;
    annotationDrag.originFontSize = annotation.fontSize;
    annotationDrag.originRotation = annotation.rotation;
    window.addEventListener("pointermove", handleAnnotationDrag);
    window.addEventListener("pointerup", stopAnnotationDrag, { once: true });
  }

  function handleAnnotationDrag(event: PointerEvent) {
    if (!draggingAnnotationId.value || !options.previewBoard.value) return;

    const rect = options.previewBoard.value.getBoundingClientRect();
    const movedPixels = Math.hypot(event.clientX - annotationDrag.startX, event.clientY - annotationDrag.startY);
    if (movedPixels > 3) {
      annotationDrag.hasMoved = true;
    }
    const deltaX = (event.clientX - annotationDrag.startX) / rect.width;
    const deltaY = (event.clientY - annotationDrag.startY) / rect.height;
    annotations.value = annotations.value.map((annotation) => {
      if (annotation.id !== draggingAnnotationId.value) return annotation;
      if (annotationDragMode.value === "rotate") {
        const centerX = rect.left + (annotationDrag.originX + annotationDrag.originW / 2) * rect.width;
        const centerY = rect.top + (annotationDrag.originY + annotationDrag.originH / 2) * rect.height;
        const angle = Math.atan2(event.clientY - centerY, event.clientX - centerX);
        return {
          ...annotation,
          rotation: Math.round(annotationDrag.originRotation + ((angle - annotationDrag.startAngle) * 180) / Math.PI),
        };
      }
      if (annotationDragMode.value.startsWith("resize-")) {
        return resizeAnnotationFromDrag(annotation, deltaX, deltaY);
      }
      if (annotationDragMode.value === "arrow-end") {
        return updateArrowPointFromDrag(annotation, deltaX, deltaY, "end");
      }
      if (annotationDragMode.value === "arrow-start") {
        return updateArrowPointFromDrag(annotation, deltaX, deltaY, "start");
      }
      if (annotation.kind === "arrow") {
        return moveArrowFromDrag(annotation, deltaX, deltaY);
      }
      return {
        ...annotation,
        x: clamp(annotationDrag.originX + deltaX, 0, 1 - annotation.w),
        y: clamp(annotationDrag.originY + deltaY, 0, 1 - annotation.h),
      };
    });
  }

  function stopAnnotationDrag() {
    const draggedAnnotation = annotations.value.find((annotation) => annotation.id === draggingAnnotationId.value);
    if (draggedAnnotation && draggedAnnotation.kind !== "text" && annotationDrag.hasMoved) {
      selectedAnnotationId.value = "";
    }
    draggingAnnotationId.value = "";
    annotationDragMode.value = "move";
    annotationDrag.hasMoved = false;
    window.removeEventListener("pointermove", handleAnnotationDrag);
  }

  function editTextAnnotation(annotation: Annotation) {
    if (annotation.kind !== "text") return;
    selectedAnnotationId.value = annotation.id;
  }

  function pointFromBoardEvent(event: PointerEvent) {
    if (!options.previewBoard.value) return null;
    const rect = options.previewBoard.value.getBoundingClientRect();
    return {
      x: clamp((event.clientX - rect.left) / rect.width, 0, 1),
      y: clamp((event.clientY - rect.top) / rect.height, 0, 1),
    };
  }

  function buildDrawnAnnotation(kind: DrawingKind, startX: number, startY: number, endX: number, endY: number): Annotation {
    if (kind === "arrow") {
      return normalizeArrowAnnotation(
        {
          id: options.createId(kind),
          kind,
          x: startX,
          y: startY,
          w: 0,
          h: 0,
          text: "",
          color: "#ff3b30",
          fontSize: defaultAnnotationFontSize,
          strokeWidth: 5,
          rotation: 0,
        },
        startX,
        startY,
        endX,
        endY,
      );
    }

    const minSize = 0.025;
    const x = Math.min(startX, endX);
    const y = Math.min(startY, endY);
    const w = Math.max(minSize, Math.abs(endX - startX));
    const h = Math.max(minSize, Math.abs(endY - startY));
    return {
      id: options.createId(kind),
      kind,
      x: clamp(x, 0, 1 - w),
      y: clamp(y, 0, 1 - h),
      w,
      h,
      text: "",
      color: "#ff3b30",
      fontSize: defaultAnnotationFontSize,
      strokeWidth: 5,
      rotation: 0,
    };
  }

  function startAnnotationCreate(event: PointerEvent) {
    if (!activeDrawingKind.value || event.button !== 0) return;

    const point = pointFromBoardEvent(event);
    if (!point) return;

    event.preventDefault();
    event.stopPropagation();
    suppressNextBoardClick.value = true;
    creationDrag.startX = point.x;
    creationDrag.startY = point.y;
    const annotation = buildDrawnAnnotation(activeDrawingKind.value, point.x, point.y, point.x, point.y);
    annotations.value = [...annotations.value, annotation];
    creatingAnnotationId.value = annotation.id;
    selectedAnnotationId.value = annotation.id;
    window.addEventListener("pointermove", updateAnnotationCreate);
    window.addEventListener("pointerup", finishAnnotationCreate, { once: true });
    window.addEventListener("pointercancel", cancelAnnotationCreate, { once: true });
    window.addEventListener("blur", cancelAnnotationCreate, { once: true });
  }

  function updateAnnotationCreate(event: PointerEvent) {
    if (!creatingAnnotationId.value || !activeDrawingKind.value) return;
    const point = pointFromBoardEvent(event);
    if (!point) return;
    const annotation = buildDrawnAnnotation(activeDrawingKind.value, creationDrag.startX, creationDrag.startY, point.x, point.y);
    annotations.value = annotations.value.map((item) => (item.id === creatingAnnotationId.value ? { ...annotation, id: item.id } : item));
  }

  function finishAnnotationCreate(event: PointerEvent) {
    updateAnnotationCreate(event);
    activeDrawingKind.value = null;
    creatingAnnotationId.value = "";
    selectedAnnotationId.value = "";
    window.setTimeout(() => {
      suppressNextBoardClick.value = false;
    }, 0);
    window.removeEventListener("pointermove", updateAnnotationCreate);
    window.removeEventListener("pointercancel", cancelAnnotationCreate);
    window.removeEventListener("blur", cancelAnnotationCreate);
  }

  function cancelAnnotationCreate() {
    if (creatingAnnotationId.value) {
      annotations.value = annotations.value.filter((annotation) => annotation.id !== creatingAnnotationId.value);
    }
    creatingAnnotationId.value = "";
    window.setTimeout(() => {
      suppressNextBoardClick.value = false;
    }, 0);
    window.removeEventListener("pointermove", updateAnnotationCreate);
    window.removeEventListener("pointerup", finishAnnotationCreate);
    window.removeEventListener("pointercancel", cancelAnnotationCreate);
    window.removeEventListener("blur", cancelAnnotationCreate);
  }

  function blockDrawingClick(event: MouseEvent) {
    if (!activeDrawingKind.value && !suppressNextBoardClick.value) return;
    event.preventDefault();
    event.stopPropagation();
    suppressNextBoardClick.value = false;
  }

  function cleanupAnnotationInteractions() {
    window.removeEventListener("pointermove", handleAnnotationDrag);
    cancelAnnotationCreate();
  }

  return {
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
  };
}
