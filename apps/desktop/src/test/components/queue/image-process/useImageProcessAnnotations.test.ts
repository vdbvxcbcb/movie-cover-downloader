import { describe, expect, it } from "vitest";
import type { Annotation } from "../../../../components/composables/types";
import { arrowEndpoints, normalizeArrowAnnotation } from "../../../../components/composables/useImageProcessAnnotations";

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

describe("image process annotations", () => {
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
});
