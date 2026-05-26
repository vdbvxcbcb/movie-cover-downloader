export type AspectRatio = "1:1" | "16:9" | "9:16" | "16:10" | "4:3" | "3:4";
export type OutputFormat = "jpg" | "png";
export type AnnotationKind = "text" | "arrow" | "rect" | "circle";
export type DrawingKind = Exclude<AnnotationKind, "text">;
export type AnnotationDragMode =
  | "move"
  | "resize-n"
  | "resize-e"
  | "resize-s"
  | "resize-w"
  | "resize-se"
  | "resize-sw"
  | "resize-ne"
  | "resize-nw"
  | "arrow-start"
  | "arrow-end"
  | "rotate";
export type NoticeTone = "success" | "error" | "warn";

export interface LayoutCell {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface LayoutPreset {
  id: string;
  count: number;
  name: string;
  cells: LayoutCell[];
}

export interface SlotImage {
  id: string;
  url: string;
  name: string;
  scale: number;
  opacity: number;
}

export interface Annotation {
  id: string;
  kind: AnnotationKind;
  x: number;
  y: number;
  w: number;
  h: number;
  text: string;
  color: string;
  fontSize: number;
  strokeWidth: number;
  rotation: number;
  arrowReverseX?: boolean;
  arrowReverseY?: boolean;
  arrowStartX?: number;
  arrowStartY?: number;
  arrowEndX?: number;
  arrowEndY?: number;
}
