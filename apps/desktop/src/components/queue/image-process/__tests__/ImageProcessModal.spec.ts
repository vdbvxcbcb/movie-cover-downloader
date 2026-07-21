import { mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ImageProcessModal from "../../ImageProcessModal.vue";

const createObjectUrlDescriptor = Object.getOwnPropertyDescriptor(URL, "createObjectURL");
const revokeObjectUrlDescriptor = Object.getOwnPropertyDescriptor(URL, "revokeObjectURL");

describe("ImageProcessModal image viewport", () => {
  beforeEach(() => {
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: vi.fn(() => "blob:image-1"),
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: vi.fn(),
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (createObjectUrlDescriptor) {
      Object.defineProperty(URL, "createObjectURL", createObjectUrlDescriptor);
    } else {
      Reflect.deleteProperty(URL, "createObjectURL");
    }
    if (revokeObjectUrlDescriptor) {
      Object.defineProperty(URL, "revokeObjectURL", revokeObjectUrlDescriptor);
    } else {
      Reflect.deleteProperty(URL, "revokeObjectURL");
    }
  });

  it("moves the selected zoomed image inside its fixed viewport", async () => {
    const wrapper = mount(ImageProcessModal, {
      props: { outputRootDir: "D:/covers" },
    });
    const input = wrapper.find<HTMLInputElement>('input[type="file"][multiple]');
    Object.defineProperty(input.element, "files", {
      configurable: true,
      value: [new File(["image"], "poster.jpg", { type: "image/jpeg" })],
    });
    await input.trigger("change");

    const surface = wrapper.find<HTMLElement>(".preview-cell__surface");
    Object.defineProperty(surface.element, "clientWidth", { configurable: true, value: 100 });
    Object.defineProperty(surface.element, "clientHeight", { configurable: true, value: 100 });
    const image = wrapper.find<HTMLImageElement>(".preview-cell img");
    Object.defineProperty(image.element, "naturalWidth", { configurable: true, value: 400 });
    Object.defineProperty(image.element, "naturalHeight", { configurable: true, value: 200 });
    await image.trigger("load");
    await wrapper.find<HTMLButtonElement>('[aria-label="放大"]').trigger("click");

    const centeredStyle = image.attributes("style");
    await surface.trigger("pointerdown", { button: 0, pointerId: 1, clientX: 10, clientY: 10 });
    window.dispatchEvent(new PointerEvent("pointermove", { pointerId: 1, clientX: 40, clientY: 10 }));
    await wrapper.vm.$nextTick();

    expect(image.attributes("style")).not.toBe(centeredStyle);
    window.dispatchEvent(new PointerEvent("pointerup", { pointerId: 1 }));
    wrapper.unmount();
  });
});
