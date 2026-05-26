import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import ImageProcessLayoutPicker from "../../../../components/queue/image-process/ImageProcessLayoutPicker.vue";
import type { LayoutPreset } from "../../../../components/composables/types";

describe("image process layout picker", () => {
  it("renders grouped layouts and emits selected layout id", async () => {
    const layouts: LayoutPreset[] = [
      { id: "one", count: 1, name: "单图", cells: [{ x: 0, y: 0, w: 100, h: 100 }] },
      {
        id: "two",
        count: 2,
        name: "左右",
        cells: [
          { x: 0, y: 0, w: 50, h: 100 },
          { x: 50, y: 0, w: 50, h: 100 },
        ],
      },
    ];

    const wrapper = mount(ImageProcessLayoutPicker, {
      props: {
        selectedLayoutId: "one",
        groups: [
          { count: 1, layouts: [layouts[0]!] },
          { count: 2, layouts: [layouts[1]!] },
        ],
      },
    });

    expect(wrapper.text()).toContain("1 张图片");
    expect(wrapper.text()).toContain("左右");

    await wrapper.findAll("button")[1]!.trigger("click");
    expect(wrapper.emitted("select")).toEqual([["two"]]);
  });
});
