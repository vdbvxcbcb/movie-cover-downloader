import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import ImageProcessSettingsContent from "../ImageProcessSettingsContent.vue";

function createSettings() {
  return {
    ratio: "1:1" as const,
    borderTop: 0,
    borderRight: 0,
    borderBottom: 0,
    borderLeft: 0,
    gap: 0,
    radius: 0,
    backgroundColor: "#f4f0e8",
    backgroundUrl: "blob:bg",
    backgroundName: "bg.jpg",
    backgroundOpacity: 80,
    backgroundOverlay: false,
    backgroundScale: 1,
  };
}

describe("image process settings content", () => {
  it("emits setting and export actions", async () => {
    const wrapper = mount(ImageProcessSettingsContent, {
      props: {
        settings: createSettings(),
        ratios: ["1:1", "3:4"],
        selectedSlotImage: null,
        selectedImageOpacity: 100,
        outputRootDir: "D:/cover",
        browsingOutputDirectory: false,
        saving: false,
        exportDebouncing: false,
        currentSelection: "foreground" as const,
      },
    });

    await wrapper.find("select").setValue("3:4");
    await wrapper.find("input[type='color']").setValue("#ffffff");
    await wrapper.findAll("button").find((button) => button.text() === "重置背景色")!.trigger("click");
    const buttons = wrapper.findAll("button");
    await buttons[buttons.length - 2]!.trigger("click");

    expect(wrapper.emitted("updateSetting")).toEqual([
      ["ratio", "3:4"],
      ["backgroundColor", "#ffffff"],
    ]);
    expect(wrapper.emitted("resetBackgroundColor")).toHaveLength(1);
    expect(wrapper.emitted("exportImage")).toEqual([["jpg"]]);
  });

  it("exposes foreground and background selection plus background size", async () => {
    const wrapper = mount(ImageProcessSettingsContent, {
      props: {
        settings: createSettings(), ratios: ["1:1"], selectedSlotImage: null, selectedImageOpacity: 100,
        outputRootDir: "D:/cover", browsingOutputDirectory: false, saving: false, exportDebouncing: false,
        currentSelection: "foreground",
      },
    });

    await wrapper.find("button[aria-label='选择背景图']").trigger("click");
    const backgroundScale = wrapper.find<HTMLInputElement>("input[aria-label='背景图大小']");
    await backgroundScale.setValue("30");

    expect(wrapper.emitted("updateCurrentSelection")).toEqual([["background"]]);
    expect(wrapper.emitted("updateSetting")).toContainEqual(["backgroundScale", 0.3]);
  });
});
