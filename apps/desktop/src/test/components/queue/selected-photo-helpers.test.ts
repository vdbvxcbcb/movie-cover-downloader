import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createSelectedPhotoDiscoveryState,
  formatSelectedPhotoCategory,
  pickMoreCompleteTitle,
  selectedPhotoAssetTypes,
} from "../../../components/composables/selected-photo-helpers";
import type { SelectableDoubanPhoto } from "../../../types/app";

describe("selected photo helpers", () => {
  it("prefers a more complete resolved title", () => {
    assert.equal(pickMoreCompleteTitle("消失的人", "消失的人 / The Missing"), "消失的人 / The Missing");
    assert.equal(pickMoreCompleteTitle("消失的人", ""), "消失的人");
  });

  it("creates discovery state for each supported asset type", () => {
    const state = createSelectedPhotoDiscoveryState();
    assert.deepEqual(Object.keys(state), selectedPhotoAssetTypes);
    assert.equal(state.still.done, false);
    assert.equal(state.poster.cursor, null);
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

    assert.equal(formatSelectedPhotoCategory({ ...basePhoto, doubanAssetType: "still" }), "剧照");
    assert.equal(formatSelectedPhotoCategory({ ...basePhoto, doubanAssetType: "poster" }), "海报");
    assert.equal(formatSelectedPhotoCategory({ ...basePhoto, doubanAssetType: "wallpaper" }), "壁纸");
  });
});
