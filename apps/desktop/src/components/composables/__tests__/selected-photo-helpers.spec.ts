import { describe, it, expect } from "vitest";
import {
  createSelectedPhotoDiscoveryState,
  formatSelectedPhotoCategory,
  pickMoreCompleteTitle,
  selectedPhotoAssetTypes,
} from "../selected-photo-helpers";
import type { SelectableDoubanPhoto } from "../../../types/app";

describe("selected photo helpers", () => {
  it("prefers a more complete resolved title", () => {
    expect(pickMoreCompleteTitle("消失的人", "消失的人 / The Missing")).toBe("消失的人 / The Missing");
    expect(pickMoreCompleteTitle("消失的人", "")).toBe("消失的人");
  });

  it("creates discovery state for each supported asset type", () => {
    const state = createSelectedPhotoDiscoveryState();
    expect(Object.keys(state)).toEqual(selectedPhotoAssetTypes);
    expect(state.still.done).toBe(false);
    expect(state.poster.cursor).toBe(null);
  });

  it("formats selected photo categories for display", () => {
    const basePhoto = {
      id: "photo-1",
      source: "douban",
      title: "",
      imageUrl: "https://example.test/a.jpg",
      category: "still",
      orientation: "horizontal",
      selected: false,
    } satisfies Omit<SelectableDoubanPhoto, "doubanAssetType">;

    expect(formatSelectedPhotoCategory({ ...basePhoto, doubanAssetType: "still" })).toBe("剧照");
    expect(formatSelectedPhotoCategory({ ...basePhoto, doubanAssetType: "poster" })).toBe("海报");
    expect(formatSelectedPhotoCategory({ ...basePhoto, doubanAssetType: "wallpaper" })).toBe("壁纸");
  });
});
