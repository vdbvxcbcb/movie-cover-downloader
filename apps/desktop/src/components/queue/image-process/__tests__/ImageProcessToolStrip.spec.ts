import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import ImageProcessToolStrip from "../ImageProcessToolStrip.vue";

describe("image process tool strip", () => {
  it("emits toolbar actions", async () => {
    const wrapper = mount(ImageProcessToolStrip, {
      props: {
        activeDrawingKind: null,
        hasImages: true,
        hasAnnotations: false,
        previewScale: 1,
        canUndo: false,
      },
    });

    await wrapper.find("button[title='添加文字']").trigger("click");
    await wrapper.find("button[title='绘制箭头']").trigger("click");
    await wrapper.find("button[title='随机图片位置']").trigger("click");

    expect(wrapper.emitted("addText")).toHaveLength(1);
    expect(wrapper.emitted("selectDrawing")).toEqual([["arrow"]]);
    expect(wrapper.emitted("shuffle")).toHaveLength(1);
  });

  it("places and emits annotation undo", async () => {
    const wrapper = mount(ImageProcessToolStrip, { props: { activeDrawingKind: null, hasImages: true, hasAnnotations: true, previewScale: 1, canUndo: true } });
    const titles = wrapper.findAll("button").map((button) => button.attributes("title"));
    expect(titles.indexOf("撤销标注")).toBe(titles.indexOf("绘制圆圈") + 1);
    expect(titles.indexOf("撤销标注")).toBe(titles.indexOf("随机图片位置") - 1);
    await wrapper.find("button[aria-label='撤销标注']").trigger("click");
    expect(wrapper.emitted("undo")).toHaveLength(1);
  });

  it("places separate clear-annotations and clear-all actions after shuffle", async () => {
    const wrapper = mount(ImageProcessToolStrip, { props: { activeDrawingKind: null, hasImages: true, hasAnnotations: true, previewScale: 1, canUndo: true } });
    const titles = wrapper.findAll("button").map((button) => button.attributes("title"));

    expect(titles.indexOf("清除标注")).toBe(titles.indexOf("随机图片位置") + 1);
    expect(titles.indexOf("清除全部前景图与标注")).toBe(titles.indexOf("清除标注") + 1);
    await wrapper.find("button[title='清除标注']").trigger("click");
    await wrapper.find("button[title='清除全部前景图与标注']").trigger("click");

    expect(wrapper.emitted("clearAnnotations")).toHaveLength(1);
    expect(wrapper.emitted("clear")).toHaveLength(1);
  });

  it("emits bounded preview zoom actions", async () => {
    const wrapper = mount(ImageProcessToolStrip, {
      props: { activeDrawingKind: null, hasImages: false, hasAnnotations: false, previewScale: 0.3, canUndo: false },
    });

    expect(wrapper.find("button[aria-label='缩小画布预览']").attributes("disabled")).toBeDefined();
    await wrapper.find("button[aria-label='放大画布预览']").trigger("click");
    await wrapper.find("button[aria-label='还原画布预览']").trigger("click");

    expect(wrapper.emitted("updatePreviewScale")).toEqual([[0.4], [1]]);
  });
});
