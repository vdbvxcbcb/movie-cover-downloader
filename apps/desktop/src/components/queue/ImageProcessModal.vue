<script setup lang="ts">
// 图片拼版处理弹窗：固定预设布局、轻量标注和 canvas 导出。
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from "vue";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import type { UnlistenFn } from "@tauri-apps/api/event";
import ActionButton from "../common/ActionButton.vue";
import MessageNotice from "../common/MessageNotice.vue";
import { runtimeBridge } from "../../lib/runtime-bridge";

type AspectRatio = "1:1" | "16:9" | "9:16" | "16:10" | "4:3" | "3:4";
type OutputFormat = "jpg" | "png";
type AnnotationKind = "text" | "arrow" | "rect" | "circle";
type DrawingKind = Exclude<AnnotationKind, "text">;
type AnnotationDragMode =
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
type NoticeTone = "success" | "error" | "warn";

interface LayoutCell {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface LayoutPreset {
  id: string;
  count: number;
  name: string;
  cells: LayoutCell[];
}

interface SlotImage {
  id: string;
  url: string;
  name: string;
  scale: number;
}

interface Annotation {
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
}

type ProcessBridge = typeof runtimeBridge & {
  saveProcessedImage?: (
    outputRootDir: string,
    fileName: string,
    imageBytes: Uint8Array,
    format: OutputFormat,
  ) => Promise<string>;
  readDroppedImageFile?: (filePath: string) => Promise<Uint8Array>;
};

const props = defineProps<{
  outputRootDir: string;
}>();

const emit = defineEmits<{
  close: [];
  updateOutputRootDir: [value: string];
}>();

const defaultBackgroundColor = "#0d252a";

function rowCells(count: number): LayoutCell[] {
  return Array.from({ length: count }, (_, index) => ({ x: 0, y: (100 / count) * index, w: 100, h: 100 / count }));
}

function columnCells(count: number): LayoutCell[] {
  return Array.from({ length: count }, (_, index) => ({ x: (100 / count) * index, y: 0, w: 100 / count, h: 100 }));
}

function gridCells(columns: number, rows: number, count = columns * rows): LayoutCell[] {
  return Array.from({ length: count }, (_, index) => ({
    x: (100 / columns) * (index % columns),
    y: (100 / rows) * Math.floor(index / columns),
    w: 100 / columns,
    h: 100 / rows,
  }));
}

function featureLeftCells(count: number): LayoutCell[] {
  const rest = count - 1;
  const columns = rest > 3 ? 2 : 1;
  const rows = Math.ceil(rest / columns);
  return [
    { x: 0, y: 0, w: 50, h: 100 },
    ...Array.from({ length: rest }, (_, index) => ({
      x: 50 + (50 / columns) * (index % columns),
      y: (100 / rows) * Math.floor(index / columns),
      w: 50 / columns,
      h: 100 / rows,
    })),
  ];
}

function featureTopCells(count: number): LayoutCell[] {
  const rest = count - 1;
  const columns = Math.min(3, rest);
  const rows = Math.ceil(rest / columns);
  return [
    { x: 0, y: 0, w: 100, h: 40 },
    ...Array.from({ length: rest }, (_, index) => ({
      x: (100 / columns) * (index % columns),
      y: 40 + (60 / rows) * Math.floor(index / columns),
      w: 100 / columns,
      h: 60 / rows,
    })),
  ];
}

function featureRightCells(count: number): LayoutCell[] {
  return featureLeftCells(count).map((cell) => ({ ...cell, x: 100 - cell.x - cell.w }));
}

function featureBottomCells(count: number): LayoutCell[] {
  return featureTopCells(count).map((cell) => ({ ...cell, y: 100 - cell.y - cell.h }));
}

const layoutPresets: LayoutPreset[] = [
  { id: "q1-full", count: 1, name: "单图", cells: [{ x: 0, y: 0, w: 100, h: 100 }] },
  {
    id: "q2-side",
    count: 2,
    name: "左右",
    cells: [
      { x: 0, y: 0, w: 50, h: 100 },
      { x: 50, y: 0, w: 50, h: 100 },
    ],
  },
  {
    id: "q2-stack",
    count: 2,
    name: "上下",
    cells: [
      { x: 0, y: 0, w: 100, h: 50 },
      { x: 0, y: 50, w: 100, h: 50 },
    ],
  },
  { id: "q3-cols", count: 3, name: "三列", cells: columnCells(3) },
  {
    id: "q3-feature",
    count: 3,
    name: "左主图",
    cells: [
      { x: 0, y: 0, w: 66.666, h: 100 },
      { x: 66.666, y: 0, w: 33.334, h: 50 },
      { x: 66.666, y: 50, w: 33.334, h: 50 },
    ],
  },
  {
    id: "q3-rows",
    count: 3,
    name: "三行",
    cells: [
      { x: 0, y: 0, w: 100, h: 33.333 },
      { x: 0, y: 33.333, w: 100, h: 33.334 },
      { x: 0, y: 66.667, w: 100, h: 33.333 },
    ],
  },
  {
    id: "q3-top",
    count: 3,
    name: "上主图",
    cells: [
      { x: 0, y: 0, w: 100, h: 50 },
      { x: 0, y: 50, w: 50, h: 50 },
      { x: 50, y: 50, w: 50, h: 50 },
    ],
  },
  {
    id: "q3-right",
    count: 3,
    name: "右主图",
    cells: [
      { x: 0, y: 0, w: 33.333, h: 50 },
      { x: 0, y: 50, w: 33.333, h: 50 },
      { x: 33.333, y: 0, w: 66.667, h: 100 },
    ],
  },
  {
    id: "q3-bottom",
    count: 3,
    name: "下主图",
    cells: [
      { x: 0, y: 0, w: 50, h: 50 },
      { x: 50, y: 0, w: 50, h: 50 },
      { x: 0, y: 50, w: 100, h: 50 },
    ],
  },
  {
    id: "q3-left-split",
    count: 3,
    name: "左分栏",
    cells: [
      { x: 0, y: 0, w: 70, h: 100 },
      { x: 70, y: 0, w: 30, h: 45 },
      { x: 70, y: 45, w: 30, h: 55 },
    ],
  },
  {
    id: "q3-stacked-main",
    count: 3,
    name: "错落",
    cells: [
      { x: 0, y: 0, w: 55, h: 60 },
      { x: 55, y: 0, w: 45, h: 100 },
      { x: 0, y: 60, w: 55, h: 40 },
    ],
  },
  {
    id: "q4-grid",
    count: 4,
    name: "四宫格",
    cells: [
      { x: 0, y: 0, w: 50, h: 50 },
      { x: 50, y: 0, w: 50, h: 50 },
      { x: 0, y: 50, w: 50, h: 50 },
      { x: 50, y: 50, w: 50, h: 50 },
    ],
  },
  { id: "q4-cols", count: 4, name: "四列", cells: columnCells(4) },
  { id: "q4-rows", count: 4, name: "四行", cells: rowCells(4) },
  { id: "q4-top", count: 4, name: "上主图", cells: featureTopCells(4) },
  { id: "q4-left", count: 4, name: "左主图", cells: featureLeftCells(4) },
  { id: "q4-right", count: 4, name: "右主图", cells: featureRightCells(4) },
  { id: "q4-bottom", count: 4, name: "下主图", cells: featureBottomCells(4) },
  {
    id: "q4-top-strip",
    count: 4,
    name: "上两图",
    cells: [
      { x: 0, y: 0, w: 50, h: 35 },
      { x: 50, y: 0, w: 50, h: 35 },
      { x: 0, y: 35, w: 50, h: 65 },
      { x: 50, y: 35, w: 50, h: 65 },
    ],
  },
  {
    id: "q4-side-strip",
    count: 4,
    name: "侧栏",
    cells: [
      { x: 0, y: 0, w: 62, h: 100 },
      { x: 62, y: 0, w: 38, h: 33.333 },
      { x: 62, y: 33.333, w: 38, h: 33.334 },
      { x: 62, y: 66.667, w: 38, h: 33.333 },
    ],
  },
  {
    id: "q4-mosaic",
    count: 4,
    name: "拼块",
    cells: [
      { x: 0, y: 0, w: 45, h: 50 },
      { x: 45, y: 0, w: 55, h: 50 },
      { x: 0, y: 50, w: 60, h: 50 },
      { x: 60, y: 50, w: 40, h: 50 },
    ],
  },
  {
    id: "q4-ladder",
    count: 4,
    name: "阶梯",
    cells: [
      { x: 0, y: 0, w: 55, h: 45 },
      { x: 55, y: 0, w: 45, h: 30 },
      { x: 0, y: 45, w: 55, h: 55 },
      { x: 55, y: 30, w: 45, h: 70 },
    ],
  },
  {
    id: "q5-feature",
    count: 5,
    name: "一大四小",
    cells: [
      { x: 0, y: 0, w: 50, h: 100 },
      { x: 50, y: 0, w: 25, h: 50 },
      { x: 75, y: 0, w: 25, h: 50 },
      { x: 50, y: 50, w: 25, h: 50 },
      { x: 75, y: 50, w: 25, h: 50 },
    ],
  },
  { id: "q5-left", count: 5, name: "左主图", cells: featureLeftCells(5) },
  { id: "q5-top", count: 5, name: "上主图", cells: featureTopCells(5) },
  { id: "q5-rows", count: 5, name: "五行", cells: rowCells(5) },
  {
    id: "q5-tiles",
    count: 5,
    name: "错落",
    cells: [
      { x: 0, y: 0, w: 40, h: 50 },
      { x: 40, y: 0, w: 30, h: 25 },
      { x: 70, y: 0, w: 30, h: 50 },
      { x: 40, y: 25, w: 30, h: 25 },
      { x: 0, y: 50, w: 100, h: 50 },
    ],
  },
  {
    id: "q6-grid",
    count: 6,
    name: "六格",
    cells: [
      { x: 0, y: 0, w: 33.333, h: 50 },
      { x: 33.333, y: 0, w: 33.334, h: 50 },
      { x: 66.667, y: 0, w: 33.333, h: 50 },
      { x: 0, y: 50, w: 33.333, h: 50 },
      { x: 33.333, y: 50, w: 33.334, h: 50 },
      { x: 66.667, y: 50, w: 33.333, h: 50 },
    ],
  },
  { id: "q6-cols", count: 6, name: "六列", cells: columnCells(6) },
  { id: "q6-rows", count: 6, name: "六行", cells: rowCells(6) },
  { id: "q6-vertical", count: 6, name: "二列三行", cells: gridCells(2, 3) },
  { id: "q6-left", count: 6, name: "左主图", cells: featureLeftCells(6) },
  { id: "q6-top", count: 6, name: "上主图", cells: featureTopCells(6) },
  {
    id: "q7-feature",
    count: 7,
    name: "一大六小",
    cells: [
      { x: 0, y: 0, w: 50, h: 66.667 },
      { x: 50, y: 0, w: 25, h: 33.333 },
      { x: 75, y: 0, w: 25, h: 33.333 },
      { x: 50, y: 33.333, w: 25, h: 33.334 },
      { x: 75, y: 33.333, w: 25, h: 33.334 },
      { x: 0, y: 66.667, w: 50, h: 33.333 },
      { x: 50, y: 66.667, w: 50, h: 33.333 },
    ],
  },
  { id: "q7-grid", count: 7, name: "三列流", cells: gridCells(3, 3, 7) },
  { id: "q7-left", count: 7, name: "左主图", cells: featureLeftCells(7) },
  { id: "q7-top", count: 7, name: "上主图", cells: featureTopCells(7) },
  {
    id: "q7-center",
    count: 7,
    name: "中主图",
    cells: [
      { x: 0, y: 0, w: 25, h: 33.333 },
      { x: 0, y: 33.333, w: 25, h: 33.334 },
      { x: 0, y: 66.667, w: 25, h: 33.333 },
      { x: 25, y: 0, w: 50, h: 100 },
      { x: 75, y: 0, w: 25, h: 33.333 },
      { x: 75, y: 33.333, w: 25, h: 33.334 },
      { x: 75, y: 66.667, w: 25, h: 33.333 },
    ],
  },
  {
    id: "q8-grid",
    count: 8,
    name: "八格",
    cells: [
      { x: 0, y: 0, w: 25, h: 50 },
      { x: 25, y: 0, w: 25, h: 50 },
      { x: 50, y: 0, w: 25, h: 50 },
      { x: 75, y: 0, w: 25, h: 50 },
      { x: 0, y: 50, w: 25, h: 50 },
      { x: 25, y: 50, w: 25, h: 50 },
      { x: 50, y: 50, w: 25, h: 50 },
      { x: 75, y: 50, w: 25, h: 50 },
    ],
  },
  { id: "q8-vertical", count: 8, name: "二列四行", cells: gridCells(2, 4) },
  { id: "q8-cols", count: 8, name: "八列", cells: columnCells(8) },
  { id: "q8-left", count: 8, name: "左主图", cells: featureLeftCells(8) },
  { id: "q8-top", count: 8, name: "上主图", cells: featureTopCells(8) },
  {
    id: "q8-frame",
    count: 8,
    name: "环绕",
    cells: [
      { x: 0, y: 0, w: 25, h: 25 },
      { x: 25, y: 0, w: 25, h: 25 },
      { x: 50, y: 0, w: 25, h: 25 },
      { x: 75, y: 0, w: 25, h: 25 },
      { x: 0, y: 25, w: 25, h: 50 },
      { x: 75, y: 25, w: 25, h: 50 },
      { x: 0, y: 75, w: 50, h: 25 },
      { x: 50, y: 75, w: 50, h: 25 },
    ],
  },
  {
    id: "q9-grid",
    count: 9,
    name: "九宫格",
    cells: [
      { x: 0, y: 0, w: 33.333, h: 33.333 },
      { x: 33.333, y: 0, w: 33.334, h: 33.333 },
      { x: 66.667, y: 0, w: 33.333, h: 33.333 },
      { x: 0, y: 33.333, w: 33.333, h: 33.334 },
      { x: 33.333, y: 33.333, w: 33.334, h: 33.334 },
      { x: 66.667, y: 33.333, w: 33.333, h: 33.334 },
      { x: 0, y: 66.667, w: 33.333, h: 33.333 },
      { x: 33.333, y: 66.667, w: 33.334, h: 33.333 },
      { x: 66.667, y: 66.667, w: 33.333, h: 33.333 },
    ],
  },
  { id: "q9-rows", count: 9, name: "九行", cells: rowCells(9) },
  { id: "q9-cols", count: 9, name: "九列", cells: columnCells(9) },
  { id: "q9-left", count: 9, name: "左主图", cells: featureLeftCells(9) },
  { id: "q9-top", count: 9, name: "上主图", cells: featureTopCells(9) },
  {
    id: "q9-frame",
    count: 9,
    name: "中心",
    cells: [
      ...gridCells(3, 3, 4),
      { x: 33.333, y: 33.333, w: 33.334, h: 33.334 },
      { x: 66.667, y: 33.333, w: 33.333, h: 33.334 },
      { x: 0, y: 66.667, w: 33.333, h: 33.333 },
      { x: 33.333, y: 66.667, w: 33.334, h: 33.333 },
      { x: 66.667, y: 66.667, w: 33.333, h: 33.333 },
    ],
  },
  { id: "q9-four-cols", count: 9, name: "四列流", cells: gridCells(4, 3, 9) },
  { id: "q9-four-rows", count: 9, name: "四行流", cells: gridCells(3, 4, 9) },
  {
    id: "q9-middle-band",
    count: 9,
    name: "中横幅",
    cells: [
      { x: 0, y: 0, w: 25, h: 25 },
      { x: 25, y: 0, w: 25, h: 25 },
      { x: 50, y: 0, w: 25, h: 25 },
      { x: 75, y: 0, w: 25, h: 25 },
      { x: 0, y: 25, w: 100, h: 50 },
      { x: 0, y: 75, w: 25, h: 25 },
      { x: 25, y: 75, w: 25, h: 25 },
      { x: 50, y: 75, w: 25, h: 25 },
      { x: 75, y: 75, w: 25, h: 25 },
    ],
  },
  {
    id: "q9-side-band",
    count: 9,
    name: "中竖幅",
    cells: [
      { x: 0, y: 0, w: 25, h: 25 },
      { x: 0, y: 25, w: 25, h: 25 },
      { x: 0, y: 50, w: 25, h: 25 },
      { x: 0, y: 75, w: 25, h: 25 },
      { x: 25, y: 0, w: 50, h: 100 },
      { x: 75, y: 0, w: 25, h: 25 },
      { x: 75, y: 25, w: 25, h: 25 },
      { x: 75, y: 50, w: 25, h: 25 },
      { x: 75, y: 75, w: 25, h: 25 },
    ],
  },
  {
    id: "q9-large-left",
    count: 9,
    name: "左大图",
    cells: [
      { x: 0, y: 0, w: 50, h: 100 },
      { x: 50, y: 0, w: 25, h: 25 },
      { x: 75, y: 0, w: 25, h: 25 },
      { x: 50, y: 25, w: 25, h: 25 },
      { x: 75, y: 25, w: 25, h: 25 },
      { x: 50, y: 50, w: 25, h: 25 },
      { x: 75, y: 50, w: 25, h: 25 },
      { x: 50, y: 75, w: 25, h: 25 },
      { x: 75, y: 75, w: 25, h: 25 },
    ],
  },
  {
    id: "q9-large-right",
    count: 9,
    name: "右大图",
    cells: [
      { x: 0, y: 0, w: 25, h: 25 },
      { x: 25, y: 0, w: 25, h: 25 },
      { x: 0, y: 25, w: 25, h: 25 },
      { x: 25, y: 25, w: 25, h: 25 },
      { x: 0, y: 50, w: 25, h: 25 },
      { x: 25, y: 50, w: 25, h: 25 },
      { x: 0, y: 75, w: 25, h: 25 },
      { x: 25, y: 75, w: 25, h: 25 },
      { x: 50, y: 0, w: 50, h: 100 },
    ],
  },
  {
    id: "q9-large-top",
    count: 9,
    name: "上大图",
    cells: [
      { x: 0, y: 0, w: 100, h: 50 },
      { x: 0, y: 50, w: 25, h: 25 },
      { x: 25, y: 50, w: 25, h: 25 },
      { x: 50, y: 50, w: 25, h: 25 },
      { x: 75, y: 50, w: 25, h: 25 },
      { x: 0, y: 75, w: 25, h: 25 },
      { x: 25, y: 75, w: 25, h: 25 },
      { x: 50, y: 75, w: 25, h: 25 },
      { x: 75, y: 75, w: 25, h: 25 },
    ],
  },
  {
    id: "q9-large-bottom",
    count: 9,
    name: "下大图",
    cells: [
      { x: 0, y: 0, w: 25, h: 25 },
      { x: 25, y: 0, w: 25, h: 25 },
      { x: 50, y: 0, w: 25, h: 25 },
      { x: 75, y: 0, w: 25, h: 25 },
      { x: 0, y: 25, w: 25, h: 25 },
      { x: 25, y: 25, w: 25, h: 25 },
      { x: 50, y: 25, w: 25, h: 25 },
      { x: 75, y: 25, w: 25, h: 25 },
      { x: 0, y: 50, w: 100, h: 50 },
    ],
  },
  {
    id: "q9-cross",
    count: 9,
    name: "十字",
    cells: [
      { x: 0, y: 0, w: 25, h: 25 },
      { x: 25, y: 0, w: 50, h: 25 },
      { x: 75, y: 0, w: 25, h: 25 },
      { x: 0, y: 25, w: 25, h: 50 },
      { x: 25, y: 25, w: 50, h: 50 },
      { x: 75, y: 25, w: 25, h: 50 },
      { x: 0, y: 75, w: 25, h: 25 },
      { x: 25, y: 75, w: 50, h: 25 },
      { x: 75, y: 75, w: 25, h: 25 },
    ],
  },
  {
    id: "q9-offset",
    count: 9,
    name: "错位",
    cells: [
      { x: 0, y: 0, w: 35, h: 33.333 },
      { x: 35, y: 0, w: 30, h: 33.333 },
      { x: 65, y: 0, w: 35, h: 33.333 },
      { x: 0, y: 33.333, w: 25, h: 33.334 },
      { x: 25, y: 33.333, w: 50, h: 33.334 },
      { x: 75, y: 33.333, w: 25, h: 33.334 },
      { x: 0, y: 66.667, w: 35, h: 33.333 },
      { x: 35, y: 66.667, w: 30, h: 33.333 },
      { x: 65, y: 66.667, w: 35, h: 33.333 },
    ],
  },
  {
    id: "q9-magazine",
    count: 9,
    name: "杂志",
    cells: [
      { x: 0, y: 0, w: 45, h: 45 },
      { x: 45, y: 0, w: 25, h: 22.5 },
      { x: 70, y: 0, w: 30, h: 22.5 },
      { x: 45, y: 22.5, w: 55, h: 22.5 },
      { x: 0, y: 45, w: 25, h: 27.5 },
      { x: 25, y: 45, w: 35, h: 27.5 },
      { x: 60, y: 45, w: 40, h: 27.5 },
      { x: 0, y: 72.5, w: 50, h: 27.5 },
      { x: 50, y: 72.5, w: 50, h: 27.5 },
    ],
  },
  {
    id: "q9-tiles",
    count: 9,
    name: "拼贴",
    cells: [
      { x: 0, y: 0, w: 33.333, h: 25 },
      { x: 33.333, y: 0, w: 33.334, h: 25 },
      { x: 66.667, y: 0, w: 33.333, h: 25 },
      { x: 0, y: 25, w: 50, h: 25 },
      { x: 50, y: 25, w: 50, h: 25 },
      { x: 0, y: 50, w: 25, h: 50 },
      { x: 25, y: 50, w: 25, h: 50 },
      { x: 50, y: 50, w: 25, h: 50 },
      { x: 75, y: 50, w: 25, h: 50 },
    ],
  },
  {
    id: "q9-bricks",
    count: 9,
    name: "砖块",
    cells: [
      { x: 0, y: 0, w: 50, h: 20 },
      { x: 50, y: 0, w: 50, h: 20 },
      { x: 0, y: 20, w: 33.333, h: 20 },
      { x: 33.333, y: 20, w: 33.334, h: 20 },
      { x: 66.667, y: 20, w: 33.333, h: 20 },
      { x: 0, y: 40, w: 50, h: 30 },
      { x: 50, y: 40, w: 50, h: 30 },
      { x: 0, y: 70, w: 50, h: 30 },
      { x: 50, y: 70, w: 50, h: 30 },
    ],
  },
];

const ratios: AspectRatio[] = ["1:1", "16:9", "9:16", "16:10", "4:3", "3:4"];
const strokeWidths = [1, 3, 5, 7, 10, 15];
const shapeResizeHandles = ["nw", "n", "ne", "e", "se", "s", "sw", "w"] as const;
const textResizeHandles = ["nw", "ne", "e", "se", "sw", "w"] as const;
const defaultAnnotationFontSize = 48;
let unlistenDragDrop: UnlistenFn | null = null;
let exportDebounceTimer: number | null = null;
const fileInput = ref<HTMLInputElement | null>(null);
const backgroundInput = ref<HTMLInputElement | null>(null);
const previewBoard = ref<HTMLElement | null>(null);
const selectedLayoutId = ref("q4-grid");
const activeSlotIndex = ref(0);
const draggedSlotIndex = ref<number | null>(null);
const hoveredSlotIndex = ref<number | null>(null);
const selectedAnnotationId = ref("");
const draggingAnnotationId = ref("");
const annotationDragMode = ref<AnnotationDragMode>("move");
const activeDrawingKind = ref<DrawingKind | null>(null);
const creatingAnnotationId = ref("");
const suppressNextBoardClick = ref(false);
const saving = ref(false);
const exportDebouncing = ref(false);
const browsingOutputDirectory = ref(false);
const noticeMessage = ref("");
const noticeTone = ref<NoticeTone>("warn");
const noticeRevision = ref(0);
const savedOutputPath = ref("");
const viewportHeight = ref(window.innerHeight);
const localOutputRootDir = ref(props.outputRootDir);
const leftSidebarCollapsed = ref(false);
const rightSidebarCollapsed = ref(false);

const settings = reactive({
  ratio: "1:1" as AspectRatio,
  borderTop: 0,
  borderRight: 0,
  borderBottom: 0,
  borderLeft: 0,
  gap: 0,
  radius: 0,
  backgroundColor: defaultBackgroundColor,
  backgroundUrl: "",
  backgroundName: "",
  imageOpacity: 100,
});

const slotImages = ref<(SlotImage | null)[]>(Array.from({ length: 9 }, () => null));
const annotations = ref<Annotation[]>([]);
const annotationDrag = reactive({
  startX: 0,
  startY: 0,
  originX: 0,
  originY: 0,
  originW: 0,
  originH: 0,
  originFontSize: 0,
  originRotation: 0,
  startAngle: 0,
});
const creationDrag = reactive({
  startX: 0,
  startY: 0,
});

const selectedLayout = computed(() => layoutPresets.find((layout) => layout.id === selectedLayoutId.value) ?? layoutPresets[0]);
const visibleCells = computed(() => selectedLayout.value.cells);
const groupedLayouts = computed(() =>
  Array.from({ length: 9 }, (_, index) => ({
    count: index + 1,
    layouts: layoutPresets.filter((layout) => layout.count === index + 1),
  })),
);
const aspectRatioValue = computed(() => {
  const [width, height] = settings.ratio.split(":").map(Number);
  return width / height;
});
const boardStyle = computed(() => ({
  aspectRatio: settings.ratio.replace(":", " / "),
  "--board-fit-width": `min(100%, ${Math.round(Math.max(320, Math.min(1240, (viewportHeight.value - 210) * aspectRatioValue.value)))}px)`,
  backgroundColor: settings.backgroundColor,
  backgroundImage: settings.backgroundUrl ? `url(${settings.backgroundUrl})` : "none",
  "--border-top": `${settings.borderTop}px`,
  "--border-right": `${settings.borderRight}px`,
  "--border-bottom": `${settings.borderBottom}px`,
  "--border-left": `${settings.borderLeft}px`,
  "--gap": `${settings.gap}px`,
  "--cell-radius": `${settings.radius}px`,
} as Record<string, string>));
const imageFilterStyle = computed(() => ({
  opacity: String(settings.imageOpacity / 100),
}));
const displaySavedOutputPath = computed(() => normalizeDisplayPath(savedOutputPath.value));
const hasImages = computed(() => slotImages.value.some(Boolean));
const layoutShellClass = computed(() => ({
  "image-process-layout--left-collapsed": leftSidebarCollapsed.value,
  "image-process-layout--right-collapsed": rightSidebarCollapsed.value,
}));
const drawingBoardClass = computed(() => ({
  "preview-board--drawing": Boolean(activeDrawingKind.value),
  "preview-board--draw-arrow": activeDrawingKind.value === "arrow",
  "preview-board--draw-rect": activeDrawingKind.value === "rect",
  "preview-board--draw-circle": activeDrawingKind.value === "circle",
}));

watch(
  () => props.outputRootDir,
  (value) => {
    if (value !== localOutputRootDir.value) {
      localOutputRootDir.value = value;
    }
  },
);

watch(selectedLayoutId, () => {
  activeSlotIndex.value = 0;
});

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
  const boardWidth = Math.max(1, previewBoard.value?.clientWidth ?? 980);
  const boardHeight = Math.max(1, previewBoard.value?.clientHeight ?? 640);
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

function revokeSlotImage(image: SlotImage | null) {
  if (image?.url) {
    URL.revokeObjectURL(image.url);
  }
}

function setSlotImage(index: number, file: File) {
  if (!file.type.startsWith("image/")) {
    showNotice("请选择图片文件。", "warn");
    return;
  }

  const nextImages = [...slotImages.value];
  revokeSlotImage(nextImages[index] ?? null);
  nextImages[index] = {
    id: createId("image"),
    url: URL.createObjectURL(file),
    name: file.name,
    scale: 1,
  };
  slotImages.value = nextImages;
  clearNotice();
}

function fileNameFromPath(filePath: string) {
  return filePath.split(/[\\/]/).pop() || "dropped-image";
}

function imageMimeType(fileName: string) {
  const extension = fileName.split(".").pop()?.toLowerCase();
  if (extension === "jpg" || extension === "jpeg") return "image/jpeg";
  if (extension === "png") return "image/png";
  if (extension === "webp") return "image/webp";
  if (extension === "gif") return "image/gif";
  if (extension === "bmp") return "image/bmp";
  return "application/octet-stream";
}

async function acceptDroppedPath(filePath: string, index: number) {
  try {
  const bridge = runtimeBridge as ProcessBridge;
    if (!bridge.readDroppedImageFile) {
      throw new Error("runtimeBridge.readDroppedImageFile 尚未实现。");
    }

    const fileName = fileNameFromPath(filePath);
    const bytes = await bridge.readDroppedImageFile(filePath);
    const file = new File([bytes], fileName, { type: imageMimeType(fileName) });
    setSlotImage(index, file);
  } catch (error) {
    showNotice(error instanceof Error ? error.message : String(error), "error");
  }
}

function openSlotFilePicker(index: number) {
  activeSlotIndex.value = index;
  fileInput.value?.click();
}

function handleSlotFileChange(event: Event) {
  const input = event.target as HTMLInputElement;
  const files = Array.from(input.files ?? []);
  if (files.length === 0) return;

  let targetIndex = activeSlotIndex.value;
  for (const file of files) {
    if (targetIndex >= visibleCells.value.length) break;
    setSlotImage(targetIndex, file);
    targetIndex += 1;
  }
  input.value = "";
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

function swapSlotImages(source: number, target: number) {
  if (source === target || source < 0 || target < 0) return;
  const nextImages = [...slotImages.value];
  [nextImages[source], nextImages[target]] = [nextImages[target] ?? null, nextImages[source] ?? null];
  slotImages.value = nextImages;
}

function slotIndexFromClientPosition(clientX: number, clientY: number) {
  if (!previewBoard.value) return -1;
  const rect = previewBoard.value.getBoundingClientRect();
  const x = clientX - rect.left;
  const y = clientY - rect.top;
  if (x < 0 || y < 0 || x > rect.width || y > rect.height) return -1;

  const style = getComputedStyle(previewBoard.value);
  const left = Number.parseFloat(style.getPropertyValue("--border-left")) || 0;
  const top = Number.parseFloat(style.getPropertyValue("--border-top")) || 0;
  const right = Number.parseFloat(style.getPropertyValue("--border-right")) || 0;
  const bottom = Number.parseFloat(style.getPropertyValue("--border-bottom")) || 0;
  const innerWidth = Math.max(1, rect.width - left - right);
  const innerHeight = Math.max(1, rect.height - top - bottom);
  const innerX = x - left;
  const innerY = y - top;
  if (innerX < 0 || innerY < 0 || innerX > innerWidth || innerY > innerHeight) return -1;

  return visibleCells.value.findIndex((cell) => {
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
  const boardWidth = Math.max(1, previewBoard.value?.clientWidth ?? 980);
  const boardHeight = Math.max(1, previewBoard.value?.clientHeight ?? 640);
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
  const startX = annotation.arrowReverseX ? annotationDrag.originX + annotationDrag.originW : annotationDrag.originX;
  const startY = annotation.arrowReverseY ? annotationDrag.originY + annotationDrag.originH : annotationDrag.originY;
  const endX = annotation.arrowReverseX ? annotationDrag.originX : annotationDrag.originX + annotationDrag.originW;
  const endY = annotation.arrowReverseY ? annotationDrag.originY : annotationDrag.originY + annotationDrag.originH;
  const movedX = clamp((point === "start" ? startX : endX) + deltaX, 0, 1);
  const movedY = clamp((point === "start" ? startY : endY) + deltaY, 0, 1);
  const nextStartX = point === "start" ? movedX : startX;
  const nextStartY = point === "start" ? movedY : startY;
  const nextEndX = point === "end" ? movedX : endX;
  const nextEndY = point === "end" ? movedY : endY;
  const minSize = 0.04;
  const w = Math.max(minSize, Math.abs(nextEndX - nextStartX));
  const h = Math.max(minSize, Math.abs(nextEndY - nextStartY));

  return {
    ...annotation,
    x: clamp(Math.min(nextStartX, nextEndX), 0, 1 - w),
    y: clamp(Math.min(nextStartY, nextEndY), 0, 1 - h),
    w,
    h,
    arrowReverseX: nextEndX < nextStartX,
    arrowReverseY: nextEndY < nextStartY,
  };
}

function removeSlotImage(index: number) {
  const nextImages = [...slotImages.value];
  revokeSlotImage(nextImages[index] ?? null);
  nextImages[index] = null;
  slotImages.value = nextImages;
}

function zoomSlot(index: number, delta: number) {
  const current = slotImages.value[index];
  if (!current) return;
  const nextImages = [...slotImages.value];
  nextImages[index] = {
    ...current,
    scale: clamp(Number((current.scale + delta).toFixed(2)), 0.5, 3),
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
  const visibleIndexes = visibleCells.value.map((_, index) => index);
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
}

function clearImagesAndAnnotations() {
  for (const image of slotImages.value) {
    revokeSlotImage(image);
  }
  slotImages.value = Array.from({ length: 9 }, () => null);
  annotations.value = [];
  activeDrawingKind.value = null;
}

function addAnnotation(kind: AnnotationKind) {
  const base = annotations.value.length * 0.035;
  let annotation: Annotation = {
    id: createId(kind),
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
}

function selectDrawingTool(kind: DrawingKind) {
  activeDrawingKind.value = activeDrawingKind.value === kind ? null : kind;
  selectedAnnotationId.value = "";
}

function annotationStyle(annotation: Annotation) {
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
  const isStart = point === "start";
  const atRight = isStart ? annotation.arrowReverseX : !annotation.arrowReverseX;
  const atBottom = isStart ? annotation.arrowReverseY : !annotation.arrowReverseY;
  return {
    left: atRight ? "auto" : "-7px",
    right: atRight ? "-7px" : "auto",
    top: atBottom ? "auto" : "-7px",
    bottom: atBottom ? "-7px" : "auto",
  };
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
    id: createId(annotation.kind),
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
  annotationDrag.originX = annotation.x;
  annotationDrag.originY = annotation.y;
  annotationDrag.originW = annotation.w;
  annotationDrag.originH = annotation.h;
  annotationDrag.originFontSize = annotation.fontSize;
  annotationDrag.originRotation = annotation.rotation;

  if (mode === "rotate" && previewBoard.value) {
    const rect = previewBoard.value.getBoundingClientRect();
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
  annotationDrag.originX = annotation.x;
  annotationDrag.originY = annotation.y;
  annotationDrag.originW = annotation.w;
  annotationDrag.originH = annotation.h;
  annotationDrag.originFontSize = annotation.fontSize;
  annotationDrag.originRotation = annotation.rotation;
  window.addEventListener("pointermove", handleAnnotationDrag);
  window.addEventListener("pointerup", stopAnnotationDrag, { once: true });
}

function handleAnnotationDrag(event: PointerEvent) {
  if (!draggingAnnotationId.value || !previewBoard.value) return;

  const rect = previewBoard.value.getBoundingClientRect();
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
    return {
      ...annotation,
      x: clamp(annotationDrag.originX + deltaX, 0, 1 - annotation.w),
      y: clamp(annotationDrag.originY + deltaY, 0, 1 - annotation.h),
    };
  });
}

function stopAnnotationDrag() {
  draggingAnnotationId.value = "";
  annotationDragMode.value = "move";
  window.removeEventListener("pointermove", handleAnnotationDrag);
}

function editTextAnnotation(annotation: Annotation) {
  if (annotation.kind !== "text") return;
  selectedAnnotationId.value = annotation.id;
}

function pointFromBoardEvent(event: PointerEvent) {
  if (!previewBoard.value) return null;
  const rect = previewBoard.value.getBoundingClientRect();
  return {
    x: clamp((event.clientX - rect.left) / rect.width, 0, 1),
    y: clamp((event.clientY - rect.top) / rect.height, 0, 1),
  };
}

function buildDrawnAnnotation(kind: DrawingKind, startX: number, startY: number, endX: number, endY: number): Annotation {
  const minSize = 0.025;
  const x = Math.min(startX, endX);
  const y = Math.min(startY, endY);
  const w = Math.max(minSize, Math.abs(endX - startX));
  const h = Math.max(minSize, Math.abs(endY - startY));
  return {
    id: createId(kind),
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
    arrowReverseX: kind === "arrow" ? endX < startX : undefined,
    arrowReverseY: kind === "arrow" ? endY < startY : undefined,
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
    ...imageFilterStyle.value,
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

async function renderCanvas(format: OutputFormat) {
  const { width, height } = getExportSize();
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("无法创建导出画布。");

  context.fillStyle = settings.backgroundColor;
  context.fillRect(0, 0, width, height);

  if (settings.backgroundUrl) {
    const background = await loadImage(settings.backgroundUrl);
    drawCoverImage(context, background, 0, 0, width, height);
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
      context.globalAlpha = settings.imageOpacity / 100;
      drawCoverImage(context, image, x, y, cellWidth, cellHeight, slotImage.scale);
      context.globalAlpha = 1;
    } else {
      context.fillStyle = "rgba(255, 255, 255, 0.05)";
      context.fillRect(x, y, cellWidth, cellHeight);
    }
    context.restore();
  }

  drawAnnotations(context, width, height);

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error("生成导出图片失败。"));
      },
      format === "jpg" ? "image/jpeg" : "image/png",
      0.92,
    );
  });
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
      const startX = annotation.arrowReverseX ? x + w : x;
      const startY = annotation.arrowReverseY ? y + h : y;
      const endX = annotation.arrowReverseX ? x : x + w;
      const endY = annotation.arrowReverseY ? y : y + h;
      context.beginPath();
      context.moveTo(startX, startY);
      context.lineTo(endX, endY);
      context.stroke();
      const angle = Math.atan2(endY - startY, endX - startX);
      const headLength = Math.max(lineWidth * 5, width / 54);
      context.beginPath();
      context.moveTo(endX, endY);
      context.lineTo(endX - headLength * Math.cos(angle - Math.PI / 6), endY - headLength * Math.sin(angle - Math.PI / 6));
      context.lineTo(endX - headLength * Math.cos(angle + Math.PI / 6), endY - headLength * Math.sin(angle + Math.PI / 6));
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
    const blob = await renderCanvas(format);
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const bridge = runtimeBridge as ProcessBridge;
    if (!bridge.saveProcessedImage) {
      throw new Error("runtimeBridge.saveProcessedImage 尚未实现。");
    }

    const outputPath = await bridge.saveProcessedImage(localOutputRootDir.value.trim(), buildFileName(format), bytes, format);
    savedOutputPath.value = outputPath;
    showNotice(`已导出 ${format.toUpperCase()} 图片。`, "success");
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
  for (const image of slotImages.value) {
    revokeSlotImage(image);
  }
  removeBackgroundImage();
  window.removeEventListener("pointermove", handleAnnotationDrag);
  window.removeEventListener("resize", updateViewportHeight);
  clearExportDebounce();
  cancelAnnotationCreate();
  cancelSlotSwapDrag();
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
            <div class="layout-groups">
              <section v-for="group in groupedLayouts" :key="group.count" class="layout-group">
                <p>{{ group.count }} 张图片</p>
                <div class="preset-list">
                  <button
                    v-for="layout in group.layouts"
                    :key="layout.id"
                    type="button"
                    class="preset-card"
                    :class="{ 'preset-card--active': selectedLayoutId === layout.id }"
                    :title="layout.name"
                    @click="selectedLayoutId = layout.id"
                  >
                    <span class="preset-thumb">
                      <i v-for="(cell, index) in layout.cells" :key="index" :style="cellStyle(cell)"></i>
                    </span>
                    <small>{{ layout.name }}</small>
                  </button>
                </div>
              </section>
            </div>
          </div>
        </aside>

        <main class="canvas-panel">
          <div class="tool-strip">
            <button type="button" title="添加文字" @click="addAnnotation('text')">文字</button>
            <button
              type="button"
              class="tool-strip__icon"
              :class="{ 'tool-strip__icon--active': activeDrawingKind === 'arrow' }"
              title="绘制箭头"
              @click="selectDrawingTool('arrow')"
            >
              ↗
            </button>
            <button
              type="button"
              class="tool-strip__icon"
              :class="{ 'tool-strip__icon--active': activeDrawingKind === 'rect' }"
              title="绘制方框"
              @click="selectDrawingTool('rect')"
            >
              □
            </button>
            <button
              type="button"
              class="tool-strip__icon tool-strip-circle"
              :class="{ 'tool-strip__icon--active': activeDrawingKind === 'circle' }"
              title="绘制圆圈"
              @click="selectDrawingTool('circle')"
            >
              ○
            </button>
            <button type="button" title="随机图片位置" :disabled="!hasImages" @click="shuffleImages">随机</button>
            <button type="button" title="清空图片和标注" :disabled="!hasImages && annotations.length === 0" @click="clearImagesAndAnnotations">
              清除
            </button>
          </div>

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
                  :role="slotImages[index] ? undefined : 'button'"
                  :tabindex="slotImages[index] ? undefined : 0"
                  :aria-label="slotImages[index] ? undefined : '上传图片'"
                  class="preview-cell"
                  :class="{
                    'preview-cell--empty': !slotImages[index],
                    'preview-cell--drag-over': hoveredSlotIndex === index,
                    'preview-cell--swap-source': draggedSlotIndex === index,
                  }"
                  :style="cellStyle(cell)"
                  @click="!slotImages[index] && openSlotFilePicker(index)"
                  @keydown.enter.prevent="!slotImages[index] && openSlotFilePicker(index)"
                  @keydown.space.prevent="!slotImages[index] && openSlotFilePicker(index)"
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
                    <button type="button" title="替换图片" aria-label="替换图片" @click="openSlotFilePicker(index)">替</button>
                    <button type="button" title="删除图片" aria-label="删除图片" @click="removeSlotImage(index)">×</button>
                    <button type="button" title="放大" aria-label="放大" @click="zoomSlot(index, 0.12)">＋</button>
                    <button type="button" title="缩小" aria-label="缩小" @click="zoomSlot(index, -0.12)">－</button>
                    <button type="button" title="还原" aria-label="还原" @click="resetSlotZoom(index)">1</button>
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
                  <svg v-else-if="annotation.kind === 'arrow'" class="annotation-arrow" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
                    <defs>
                      <marker :id="`${annotation.id}-arrow`" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto" markerUnits="strokeWidth">
                        <path d="M 0 0 L 8 4 L 0 8 z" fill="currentColor" />
                      </marker>
                    </defs>
                    <line
                      :x1="annotation.arrowReverseX ? 98 : 2"
                      :y1="annotation.arrowReverseY ? 98 : 2"
                      :x2="annotation.arrowReverseX ? 2 : 98"
                      :y2="annotation.arrowReverseY ? 2 : 98"
                      :stroke-width="annotation.strokeWidth"
                      stroke="currentColor"
                      :marker-end="`url(#${annotation.id}-arrow)`"
                    />
                  </svg>
                  <span v-else class="annotation-shape"></span>

                  <div v-if="selectedAnnotationId === annotation.id" class="annotation-toolbar" @pointerdown.stop @click.stop>
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
                    v-if="annotation.kind === 'arrow'"
                    type="button"
                    class="annotation-handle annotation-handle--arrow-start"
                    :style="arrowHandleStyle(annotation, 'start')"
                    aria-label="调整箭头起点"
                    @pointerdown.stop.prevent="startAnnotationDrag($event, annotation, 'arrow-start')"
                  ></button>
                  <button
                    v-if="annotation.kind === 'arrow'"
                    type="button"
                    class="annotation-handle annotation-handle--arrow-end"
                    :style="arrowHandleStyle(annotation, 'end')"
                    aria-label="调整箭头终点"
                    @pointerdown.stop.prevent="startAnnotationDrag($event, annotation, 'arrow-end')"
                  ></button>
                  <template v-if="annotation.kind === 'rect' || annotation.kind === 'circle' || annotation.kind === 'text'">
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
          <div class="sidebar-content settings-sidebar__content">
            <section class="settings-section">
            <h4>画布</h4>
            <label class="field compact-field">
              <span>比例</span>
              <select v-model="settings.ratio">
                <option v-for="ratio in ratios" :key="ratio" :value="ratio">{{ ratio }}</option>
              </select>
            </label>
          </section>

          <section class="settings-section">
            <h4>边框</h4>
            <div class="number-grid">
              <label><span>上</span><input v-model.number="settings.borderTop" type="number" min="0" max="220" /></label>
              <label><span>右</span><input v-model.number="settings.borderRight" type="number" min="0" max="220" /></label>
              <label><span>下</span><input v-model.number="settings.borderBottom" type="number" min="0" max="220" /></label>
              <label><span>左</span><input v-model.number="settings.borderLeft" type="number" min="0" max="220" /></label>
            </div>
            <label class="range-field">
              <span>间距 {{ settings.gap }}px</span>
              <input v-model.number="settings.gap" type="range" min="0" max="60" />
            </label>
            <label class="range-field">
              <span>圆角 {{ settings.radius }}px</span>
              <input v-model.number="settings.radius" type="range" min="0" max="80" />
            </label>
          </section>

          <section class="settings-section">
            <h4>背景</h4>
            <div class="color-field">
              <span>背景色</span>
              <div class="color-field__actions">
                <input v-model="settings.backgroundColor" type="color" aria-label="背景色" />
                <ActionButton label="重置背景" size="sm" @click="resetBackgroundColor" />
              </div>
            </div>
            <div class="setting-actions">
              <ActionButton label="上传背景图" size="sm" @click="backgroundInput?.click()" />
              <ActionButton label="移除" size="sm" :disabled="!settings.backgroundUrl" @click="removeBackgroundImage" />
            </div>
            <p v-if="settings.backgroundName" class="setting-meta">{{ settings.backgroundName }}</p>
          </section>

          <section class="settings-section">
            <h4>图片</h4>
            <label class="range-field">
              <span>图片透明度 {{ settings.imageOpacity }}%</span>
              <input v-model.number="settings.imageOpacity" type="range" min="20" max="100" />
            </label>
          </section>

          <section class="settings-section">
            <h4>导出</h4>
            <label class="field compact-field">
              <span>图片输出目录</span>
              <div class="field-inline">
                <input :value="localOutputRootDir" placeholder="例如：D:\cover" @input="syncOutputRootDir(($event.target as HTMLInputElement).value)" />
                <ActionButton label="浏览" size="sm" :disabled="browsingOutputDirectory" @click="void browseOutputDirectory()" />
              </div>
            </label>
            <div class="export-actions">
              <ActionButton label="导出 JPG" variant="primary" :disabled="saving || exportDebouncing" @click="scheduleExportImage('jpg')" />
              <ActionButton label="导出 PNG" :disabled="saving || exportDebouncing" @click="scheduleExportImage('png')" />
            </div>
            </section>
          </div>
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
  height: min(980px, calc(100vh - 16px));
  padding: 18px;
  overflow: hidden;
}

.image-process-modal__head {
  margin-bottom: 14px;
}

.image-process-layout {
  display: grid;
  grid-template-columns: 250px minmax(420px, 1fr) 320px;
  gap: 14px;
  height: calc(100% - 64px);
  min-height: 0;
  transition: grid-template-columns 1s ease;
}

.image-process-layout--left-collapsed {
  grid-template-columns: 44px minmax(420px, 1fr) 320px;
}

.image-process-layout--right-collapsed {
  grid-template-columns: 250px minmax(420px, 1fr) 44px;
}

.image-process-layout--left-collapsed.image-process-layout--right-collapsed {
  grid-template-columns: 44px minmax(420px, 1fr) 44px;
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

.layout-groups {
  display: grid;
  gap: 12px;
}

.layout-group {
  display: grid;
  gap: 8px;
}

.layout-group p,
.settings-section h4 {
  color: var(--muted);
  font-size: 0.84rem;
  font-weight: 500;
}

.preset-list {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
}

.preset-card {
  display: grid;
  gap: 6px;
  min-width: 0;
  padding: 8px;
  border: 1px solid var(--line);
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.03);
  color: var(--muted);
  transition: border-color 160ms ease, background 160ms ease, color 160ms ease;
}

.preset-card:hover,
.preset-card--active {
  color: var(--text);
  border-color: var(--line-strong);
  background: rgba(77, 212, 198, 0.1);
}

.preset-thumb {
  position: relative;
  aspect-ratio: 1 / 0.72;
  overflow: hidden;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.04);
}

.preset-thumb i {
  position: absolute;
  padding: 2px;
}

.preset-thumb i::after {
  content: "";
  display: block;
  width: 100%;
  height: 100%;
  border-radius: 4px;
  background: rgba(77, 212, 198, 0.32);
}

.preset-card small {
  overflow: hidden;
  font-size: 0.76rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.canvas-panel {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  gap: 12px;
  padding: 14px;
}

.tool-strip {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  justify-self: center;
  width: max-content;
  max-width: 100%;
  padding: 6px;
  border: 1px solid var(--line);
  border-radius: 14px;
  background: rgba(4, 16, 19, 0.72);
  box-shadow: 0 14px 34px rgba(0, 0, 0, 0.28);
  backdrop-filter: blur(14px);
}

.tool-strip button,
.slot-actions button {
  min-width: 38px;
  height: 34px;
  border: 1px solid var(--line);
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.04);
  color: var(--text);
  transition: border-color 160ms ease, background 160ms ease, transform 160ms ease;
}

.tool-strip button {
  padding: 0 12px;
}

.tool-strip__icon {
  font-size: 1.3rem;
  font-weight: 700;
}

.tool-strip button:hover:not(:disabled),
.tool-strip__icon--active,
.slot-actions button:hover {
  border-color: var(--line-strong);
  background: rgba(77, 212, 198, 0.1);
  transform: translateY(-1px);
}

.tool-strip button:disabled {
  cursor: not-allowed;
  opacity: 0.46;
}

.preview-shell {
  display: grid;
  place-items: center;
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
  width: var(--board-fit-width);
  overflow: hidden;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 12px;
  background-position: center;
  background-size: cover;
  box-shadow: 0 26px 80px rgba(0, 0, 0, 0.28);
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
}

.preview-cell {
  position: absolute;
  padding: calc(var(--gap) / 2);
  border: 0;
  background: transparent;
  color: var(--muted);
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
  cursor: move;
}

.annotation-handle--arrow-end {
  cursor: move;
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

.settings-sidebar__content {
  display: grid;
  align-content: start;
  gap: 12px;
}

.settings-section {
  display: grid;
  gap: 12px;
  padding: 12px;
  border: 1px solid rgba(255, 255, 255, 0.055);
  border-radius: 14px;
  background: rgba(2, 10, 12, 0.24);
}

.compact-field {
  margin: 0;
}

.number-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}

.number-grid label,
.range-field,
.color-field {
  display: grid;
  gap: 6px;
  color: var(--muted);
  font-size: 0.82rem;
}

.number-grid input,
.compact-field input,
.compact-field select {
  min-width: 0;
}

.number-grid input {
  width: 100%;
  padding: 8px 9px;
  border: 1px solid var(--line);
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.04);
  color: var(--text);
  outline: none;
}

.range-field input {
  width: 100%;
  accent-color: var(--accent);
}

.color-field {
  grid-template-columns: minmax(0, 1fr);
  align-items: center;
}

.color-field__actions {
  display: flex;
  align-items: center;
  justify-content: stretch;
  gap: 8px;
  min-width: 0;
}

.color-field input {
  flex: 0 0 52px;
  width: 52px;
  height: 38px;
  padding: 2px;
  border: 1px solid var(--line);
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.04);
}

.color-field__actions :deep(.action-btn) {
  flex: 1 1 auto;
  min-height: 38px;
  padding-top: 0;
  padding-bottom: 0;
  white-space: nowrap;
}

.setting-actions,
.export-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.setting-meta {
  overflow: hidden;
  color: var(--muted);
  font-size: 0.8rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.export-actions :deep(.action-btn) {
  flex: 1 1 120px;
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
    overflow: auto;
  }

  .image-process-layout {
    grid-template-columns: 220px minmax(420px, 1fr);
    height: auto;
  }

  .settings-sidebar {
    grid-column: 1 / -1;
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 900px) {
  .image-process-layout,
  .settings-sidebar {
    grid-template-columns: 1fr;
  }

  .canvas-panel {
    min-height: 520px;
  }
}
</style>
