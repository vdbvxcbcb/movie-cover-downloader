import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import SelectedPhotoPreviewModal from "../../../components/queue/SelectedPhotoPreviewModal.vue";
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
  selected: true,
};

describe("selected photo preview modal", () => {
  it("emits preview controls", async () => {
    const wrapper = mount(SelectedPhotoPreviewModal, {
      props: {
        photo,
        imageUrl: photo.imageUrl,
        currentIndex: 0,
        total: 2,
      },
      global: {
        stubs: {
          Teleport: true,
        },
      },
    });

    await wrapper.find("button[aria-label='关闭预览']").trigger("click");
    await wrapper.find("button[aria-label='上一张']").trigger("click");
    await wrapper.find("button[aria-label='下一张']").trigger("click");

    expect(wrapper.text()).toContain("1 / 2");
    expect(wrapper.emitted("close")).toHaveLength(1);
    expect(wrapper.emitted("step")).toEqual([[-1], [1]]);
  });
});
