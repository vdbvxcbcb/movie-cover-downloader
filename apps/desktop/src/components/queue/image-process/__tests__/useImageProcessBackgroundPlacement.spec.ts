import { describe, expect, it } from "vitest";
import {
  getBackgroundImagePlacement,
  getNextBackgroundImageOffset,
} from "../../../composables/useImageProcessBackgroundPlacement";

describe("image process background placement", () => {
  it("contains a landscape background at 100 percent", () => {
    expect(getBackgroundImagePlacement({
      imageWidth: 400,
      imageHeight: 200,
      viewportWidth: 100,
      viewportHeight: 100,
      scale: 1,
      offsetX: 0,
      offsetY: 0,
    })).toEqual({ x: 0, y: 25, width: 100, height: 50, maxOffsetX: 0, maxOffsetY: 25 });
  });

  it("keeps a 30 percent background fully inside the viewport at every edge", () => {
    const topLeft = getBackgroundImagePlacement({
      imageWidth: 200,
      imageHeight: 400,
      viewportWidth: 120,
      viewportHeight: 90,
      scale: 0.3,
      offsetX: -1,
      offsetY: -1,
    });
    const bottomRight = getBackgroundImagePlacement({
      imageWidth: 200,
      imageHeight: 400,
      viewportWidth: 120,
      viewportHeight: 90,
      scale: 0.3,
      offsetX: 1,
      offsetY: 1,
    });

    expect(topLeft.x).toBe(0);
    expect(topLeft.y).toBe(0);
    expect(bottomRight.x + bottomRight.width).toBeCloseTo(120);
    expect(bottomRight.y + bottomRight.height).toBeCloseTo(90);
  });

  it("converts visual pointer movement by preview scale and clamps it", () => {
    expect(getNextBackgroundImageOffset(0, 10, 20, 0.5)).toBe(1);
    expect(getNextBackgroundImageOffset(0, -20, 20, 1)).toBe(-1);
    expect(getNextBackgroundImageOffset(0.4, 20, 0, 1)).toBe(0);
  });
});
