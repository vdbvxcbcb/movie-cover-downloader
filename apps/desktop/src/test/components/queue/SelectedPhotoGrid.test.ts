import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import SelectedPhotoGrid from "../../../components/queue/create-task/SelectedPhotoGrid.vue";
import type { SelectableDoubanPhoto } from "../../../types/app";

const photo: SelectableDoubanPhoto = {
  id: "photo-1",
  source: "douban",
  title: "剧照",
  imageUrl: "https://img.example.com/large.jpg",
  previewUrl: "https://img.example.com/preview.jpg",
  category: "still",
  doubanAssetType: "still",
  orientation: "horizontal",
  selected: false,
};

function mountGrid(overrides: Partial<InstanceType<typeof SelectedPhotoGrid>["$props"]> = {}) {
  return mount(SelectedPhotoGrid, {
    props: {
      photos: [photo],
      visiblePhotos: [photo],
      showLoading: false,
      emptyText: "暂无图片",
      isPhotoLoaded: () => true,
      isPhotoFailed: () => false,
      getPreviewUrl: (item) => item.previewUrl,
      ...overrides,
    },
  });
}

describe("selected photo grid", () => {
  it("renders photos and emits preview/load events", async () => {
    const wrapper = mountGrid();

    expect(wrapper.text()).toContain("剧照");
    await wrapper.find(".selected-photo-card").trigger("dblclick");
    await wrapper.find("img").trigger("load");

    expect(wrapper.emitted("openPreview")).toEqual([["photo-1"]]);
    expect(wrapper.emitted("photoLoad")).toEqual([[photo]]);
  });

  it("emits request when scrolled near the bottom", async () => {
    const wrapper = mountGrid();
    const grid = wrapper.find(".selected-photo-grid");
    Object.defineProperties(grid.element, {
      scrollHeight: { value: 200, configurable: true },
      scrollTop: { value: 120, configurable: true },
      clientHeight: { value: 80, configurable: true },
    });

    await grid.trigger("scroll");

    expect(wrapper.emitted("requestNextBatch")).toHaveLength(1);
  });

  it("renders the empty state without photos", () => {
    const wrapper = mountGrid({ photos: [], visiblePhotos: [] });

    expect(wrapper.text()).toContain("暂无图片");
  });
});
