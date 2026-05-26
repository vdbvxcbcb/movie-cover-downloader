import { describe, expect, it } from "vitest";
import { fileNameFromPath, imageMimeType } from "../../../../components/composables/useImageProcessSlotImages";

describe("image process slot images", () => {
  it("normalizes dropped file names and image mime types", () => {
    expect(fileNameFromPath("D:\\covers\\poster.webp")).toBe("poster.webp");
    expect(fileNameFromPath("/tmp/still.jpg")).toBe("still.jpg");
    expect(fileNameFromPath("")).toBe("dropped-image");
    expect(imageMimeType("poster.webp")).toBe("image/webp");
    expect(imageMimeType("still.jpeg")).toBe("image/jpeg");
    expect(imageMimeType("notes.txt")).toBe("application/octet-stream");
  });
});
