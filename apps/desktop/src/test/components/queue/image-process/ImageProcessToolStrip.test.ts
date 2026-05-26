import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import ImageProcessToolStrip from "../../../../components/queue/image-process/ImageProcessToolStrip.vue";

describe("image process tool strip", () => {
  it("emits toolbar actions", async () => {
    const wrapper = mount(ImageProcessToolStrip, {
      props: {
        activeDrawingKind: null,
        hasImages: true,
        hasAnnotations: false,
      },
    });

    await wrapper.find("button[title='添加文字']").trigger("click");
    await wrapper.find("button[title='绘制箭头']").trigger("click");
    await wrapper.find("button[title='随机图片位置']").trigger("click");

    expect(wrapper.emitted("addText")).toHaveLength(1);
    expect(wrapper.emitted("selectDrawing")).toEqual([["arrow"]]);
    expect(wrapper.emitted("shuffle")).toHaveLength(1);
  });
});
