import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import SelectedPhotoCategoryTabs from "../../../components/queue/create-task/SelectedPhotoCategoryTabs.vue";

describe("selected photo category tabs", () => {
  it("renders counts and emits the selected category", async () => {
    const wrapper = mount(SelectedPhotoCategoryTabs, {
      props: {
        activeType: "still",
        counts: {
          still: 3,
          poster: 2,
          wallpaper: 1,
        },
      },
    });

    expect(wrapper.text()).toContain("剧照 3");
    expect(wrapper.text()).toContain("海报 2");

    await wrapper.findAll("button")[1]!.trigger("click");
    expect(wrapper.emitted("select")).toEqual([["poster"]]);
  });
});
