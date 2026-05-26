import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import AutoDownloadStrategyPanel from "../../../components/queue/AutoDownloadStrategyPanel.vue";

describe("auto download strategy panel", () => {
  it("emits selected strategy changes and max image steps", async () => {
    const wrapper = mount(AutoDownloadStrategyPanel, {
      props: {
        doubanAssetType: "still",
        imageCountMode: "limited",
        maxImagesInput: "10",
        imageAspectRatio: "original",
        canDecreaseMaxImages: true,
        canIncreaseMaxImages: true,
      },
    });

    const buttons = wrapper.findAll("button");

    await buttons[1]!.trigger("click");
    await wrapper.find("button[aria-label='增加下载数量']").trigger("click");
    await buttons.at(-1)!.trigger("click");

    expect(wrapper.emitted("selectAssetType")).toEqual([["poster"]]);
    expect(wrapper.emitted("stepMaxImages")).toEqual([[1]]);
    expect(wrapper.emitted("selectAspectRatio")).toEqual([["3:4"]]);
  });
});
