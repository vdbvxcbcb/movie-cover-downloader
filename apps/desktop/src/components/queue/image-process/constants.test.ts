import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { layoutPresets, ratios, strokeWidths } from "./constants";

describe("image process constants", () => {
  it("keeps layout preset ids unique and cell bounds valid", () => {
    const ids = new Set<string>();

    for (const layout of layoutPresets) {
      assert.equal(ids.has(layout.id), false);
      ids.add(layout.id);
      assert.equal(layout.cells.length, layout.count);

      for (const cell of layout.cells) {
        assert.ok(cell.x >= 0 && cell.y >= 0);
        assert.ok(cell.w > 0 && cell.h > 0);
        assert.ok(cell.x + cell.w <= 100.001);
        assert.ok(cell.y + cell.h <= 100.001);
      }
    }
  });

  it("exposes the ratio and stroke options used by the editor controls", () => {
    assert.deepEqual(ratios, ["1:1", "16:9", "9:16", "16:10", "4:3", "3:4"]);
    assert.deepEqual(strokeWidths, [1, 3, 5, 7, 10, 15]);
  });
});
