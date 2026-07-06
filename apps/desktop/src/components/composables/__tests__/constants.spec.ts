import { describe, it, expect } from "vitest";
import { layoutPresets, ratios, strokeWidths } from "../constants";

describe("image process constants", () => {
  it("keeps layout preset ids unique and cell bounds valid", () => {
    const ids = new Set<string>();

    for (const layout of layoutPresets) {
      expect(ids.has(layout.id)).toBe(false);
      ids.add(layout.id);
      expect(layout.cells.length).toBe(layout.count);

      for (const cell of layout.cells) {
        expect(cell.x).toBeGreaterThanOrEqual(0);
        expect(cell.y).toBeGreaterThanOrEqual(0);
        expect(cell.w).toBeGreaterThan(0);
        expect(cell.h).toBeGreaterThan(0);
        expect(cell.x + cell.w).toBeLessThanOrEqual(100.001);
        expect(cell.y + cell.h).toBeLessThanOrEqual(100.001);
      }
    }
  });

  it("exposes the ratio and stroke options used by the editor controls", () => {
    expect(ratios).toEqual(["1:1", "16:9", "9:16", "16:10", "4:3", "3:4"]);
    expect(strokeWidths).toEqual([1, 3, 5, 7, 10, 15]);
  });
});
