import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import SelectedPhotoPreviewModal from "../SelectedPhotoPreviewModal.vue";
import type { SelectableDoubanPhoto } from "../../../../types/app";

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

  it("displays metadata dimensions with the nearest common ratio", () => {
    const wrapper = mount(SelectedPhotoPreviewModal, {
      props: {
        photo: { ...photo, width: 1920, height: 1080 },
        imageUrl: photo.imageUrl,
        currentIndex: 0,
        total: 1,
      },
      global: {
        stubs: {
          Teleport: true,
        },
      },
    });

    expect(wrapper.find(".selected-photo-preview__meta").text()).toBe("1920x1080 16:9");
  });

  it("uses loaded image dimensions when metadata is missing", async () => {
    const wrapper = mount(SelectedPhotoPreviewModal, {
      props: {
        photo,
        imageUrl: photo.imageUrl,
        currentIndex: 0,
        total: 1,
      },
      global: {
        stubs: {
          Teleport: true,
        },
      },
    });
    const image = wrapper.find<HTMLImageElement>(".selected-photo-preview__image");
    Object.defineProperty(image.element, "naturalWidth", { configurable: true, value: 1000 });
    Object.defineProperty(image.element, "naturalHeight", { configurable: true, value: 760 });

    await image.trigger("load");

    expect(wrapper.find(".selected-photo-preview__meta").text()).toBe("1000x760 4:3");
  });

  it("ignores non-finite metadata dimensions", () => {
    const wrapper = mount(SelectedPhotoPreviewModal, {
      props: {
        photo: { ...photo, width: Number.POSITIVE_INFINITY, height: 1080 },
        imageUrl: photo.imageUrl,
        currentIndex: 0,
        total: 1,
      },
      global: {
        stubs: {
          Teleport: true,
        },
      },
    });

    expect(wrapper.find(".selected-photo-preview__meta").exists()).toBe(false);
  });

  it("does not retain loaded dimensions after switching images", async () => {
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
    const image = wrapper.find<HTMLImageElement>(".selected-photo-preview__image");
    Object.defineProperty(image.element, "naturalWidth", { configurable: true, value: 1920 });
    Object.defineProperty(image.element, "naturalHeight", { configurable: true, value: 1080 });
    await image.trigger("load");

    await wrapper.setProps({
      photo: { ...photo, id: "photo-2", imageUrl: "https://img.example.com/second.jpg" },
      imageUrl: "https://img.example.com/second.jpg",
      currentIndex: 1,
    });

    expect(wrapper.find(".selected-photo-preview__meta").exists()).toBe(false);
  });
});
