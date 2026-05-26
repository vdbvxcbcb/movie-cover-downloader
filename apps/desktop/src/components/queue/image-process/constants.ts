import type { AspectRatio, LayoutCell, LayoutPreset } from "./types";

export const defaultBackgroundColor = "#0d252a";

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

export const layoutPresets: LayoutPreset[] = [
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

export const ratios: AspectRatio[] = ["1:1", "16:9", "9:16", "16:10", "4:3", "3:4"];
export const strokeWidths = [1, 3, 5, 7, 10, 15];
export const shapeResizeHandles = ["nw", "n", "ne", "e", "se", "s", "sw", "w"] as const;
export const textResizeHandles = ["nw", "ne", "e", "se", "sw", "w"] as const;
export const defaultAnnotationFontSize = 48;
