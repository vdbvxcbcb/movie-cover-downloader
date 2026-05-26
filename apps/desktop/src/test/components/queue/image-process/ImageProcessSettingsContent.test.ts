import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import ImageProcessSettingsContent from "../../../../components/queue/image-process/ImageProcessSettingsContent.vue";

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
      },
    });

    await wrapper.find("select").setValue("3:4");
    await wrapper.find("input[type='color']").setValue("#ffffff");
    await wrapper.find("button").trigger("click");
    await wrapper.findAll("button").at(-2)!.trigger("click");

    expect(wrapper.emitted("updateSetting")).toEqual([
      ["ratio", "3:4"],
      ["backgroundColor", "#ffffff"],
    ]);
    expect(wrapper.emitted("resetBackgroundColor")).toHaveLength(1);
    expect(wrapper.emitted("exportImage")).toEqual([["jpg"]]);
  });
});
