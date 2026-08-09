import { mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ImageProcessModal from "../../ImageProcessModal.vue";

const createObjectUrlDescriptor = Object.getOwnPropertyDescriptor(URL, "createObjectURL");
const revokeObjectUrlDescriptor = Object.getOwnPropertyDescriptor(URL, "revokeObjectURL");

describe("image process modal image viewport", () => {
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

  it("starts with one fixed image viewport", () => {
    const wrapper = mount(ImageProcessModal, {
      props: { outputRootDir: "D:/covers" },
    });

    expect(wrapper.findAll(".preview-cell")).toHaveLength(1);
    expect(wrapper.find(".preset-card--active").text()).toContain("单图");
    wrapper.unmount();
  });

  it("keeps a selected image draggable and covering its viewport after zooming out", async () => {
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
    await wrapper.find<HTMLButtonElement>('[aria-label="放大"]').trigger("click");
    await wrapper.find<HTMLButtonElement>('[aria-label="缩小"]').trigger("click");

    const centeredStyle = image.attributes("style");
    expect(Number.parseFloat(image.element.style.width)).toBeGreaterThanOrEqual(100);
    expect(Number.parseFloat(image.element.style.height)).toBeGreaterThanOrEqual(100);
    await surface.trigger("pointerdown", { button: 0, pointerId: 1, clientX: 10, clientY: 10 });
    window.dispatchEvent(new PointerEvent("pointermove", { pointerId: 1, clientX: 40, clientY: 10 }));
    await wrapper.vm.$nextTick();

    expect(image.attributes("style")).not.toBe(centeredStyle);
    window.dispatchEvent(new PointerEvent("pointerup", { pointerId: 1 }));
    wrapper.unmount();
  });

  it("switches the current selection with background overlay state", async () => {
    const wrapper = mount(ImageProcessModal, { props: { outputRootDir: "D:/covers" } });
    const backgroundInput = wrapper.find<HTMLInputElement>('input[type="file"]:not([multiple])');
    Object.defineProperty(backgroundInput.element, "files", {
      configurable: true,
      value: [new File(["background"], "background.jpg", { type: "image/jpeg" })],
    });
    await backgroundInput.trigger("change");

    const actionButton = (label: string) => wrapper.findAll("button").find((button) => button.text() === label)!;
    await actionButton("重叠").trigger("click");
    expect(wrapper.find("button[aria-label='选择背景图']").classes()).toContain("selection-segment__button--active");

    await actionButton("取消").trigger("click");
    expect(wrapper.find("button[aria-label='选择前景图']").classes()).toContain("selection-segment__button--active");

    await actionButton("重叠").trigger("click");
    await actionButton("移除").trigger("click");
    expect(wrapper.find("button[aria-label='选择前景图']").classes()).toContain("selection-segment__button--active");
    wrapper.unmount();
  });

  it("resets background opacity and size after removing the background image", async () => {
    const wrapper = mount(ImageProcessModal, { props: { outputRootDir: "D:/covers" } });
    const backgroundInput = wrapper.find<HTMLInputElement>('input[type="file"]:not([multiple])');
    Object.defineProperty(backgroundInput.element, "files", {
      configurable: true,
      value: [new File(["background"], "background.jpg", { type: "image/jpeg" })],
    });
    await backgroundInput.trigger("change");

    const rangeFields = wrapper.findAll("label.range-field");
    const opacityInput = rangeFields.find((field) => field.text().includes("背景图透明度"))!.find<HTMLInputElement>("input");
    const scaleInput = rangeFields.find((field) => field.text().includes("背景图大小"))!.find<HTMLInputElement>("input");
    await opacityInput.setValue("35");
    await scaleInput.setValue("40");

    const removeButton = wrapper.findAll("button").find((button) => button.text() === "移除")!;
    await removeButton.trigger("click");

    expect(opacityInput.element.value).toBe("100");
    expect(scaleInput.element.value).toBe("100");
    wrapper.unmount();
  });

  it("clears annotations separately and clears all images with the existing action", async () => {
    const wrapper = mount(ImageProcessModal, { props: { outputRootDir: "D:/covers" } });
    const input = wrapper.find<HTMLInputElement>('input[type="file"][multiple]');
    Object.defineProperty(input.element, "files", {
      configurable: true,
      value: [new File(["image"], "poster.jpg", { type: "image/jpeg" })],
    });
    await input.trigger("change");
    await wrapper.find("button[title='添加文字']").trigger("click");

    await wrapper.find("button[title='清除标注']").trigger("click");
    expect(wrapper.find(".preview-cell img").exists()).toBe(true);
    expect(wrapper.find(".annotation-item").exists()).toBe(false);

    await wrapper.find("button[title='添加文字']").trigger("click");
    await wrapper.find("button[title='清除全部前景图与标注']").trigger("click");
    expect(wrapper.find(".preview-cell img").exists()).toBe(false);
    expect(wrapper.find(".annotation-item").exists()).toBe(false);
    wrapper.unmount();
  });

  it("edits text annotations with preserved line breaks", async () => {
    const wrapper = mount(ImageProcessModal, { props: { outputRootDir: "D:/covers" } });
    await wrapper.find("button[title='添加文字']").trigger("click");

    const editor = wrapper.find<HTMLTextAreaElement>(".annotation-text-input");
    expect(editor.element.tagName).toBe("TEXTAREA");
    await editor.setValue("第一行\n第二行");

    expect(editor.element.value).toBe("第一行\n第二行");
    expect(editor.attributes("rows")).toBe("1");
    wrapper.unmount();
  });

  it("finishes text editing and keeps a plain-text preview when an image is clicked", async () => {
    const wrapper = mount(ImageProcessModal, { props: { outputRootDir: "D:/covers" } });
    const input = wrapper.find<HTMLInputElement>('input[type="file"][multiple]');
    Object.defineProperty(input.element, "files", {
      configurable: true,
      value: [new File(["image"], "poster.jpg", { type: "image/jpeg" })],
    });
    await input.trigger("change");
    await wrapper.find("button[title='添加文字']").trigger("click");
    await wrapper.find<HTMLTextAreaElement>(".annotation-text-input").setValue("第一行\n第二行");

    await wrapper.find(".preview-cell img").trigger("click");
    await wrapper.vm.$nextTick();

    expect(wrapper.find(".annotation-text-input").exists()).toBe(false);
    expect(wrapper.find(".annotation-text-preview").text()).toBe("第一行\n第二行");
    expect(wrapper.find(".annotation-item").classes()).not.toContain("annotation-item--active");
    wrapper.unmount();
  });

  it("undoes the latest annotation with Ctrl+Z", async () => {
    const wrapper = mount(ImageProcessModal, { props: { outputRootDir: "D:/covers" } });
    await wrapper.find("button[title='添加文字']").trigger("click");
    expect(wrapper.find(".annotation-item").exists()).toBe(true);

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "z", ctrlKey: true }));
    await wrapper.vm.$nextTick();

    expect(wrapper.find(".annotation-item").exists()).toBe(false);
    wrapper.unmount();
  });

  it("keeps native Ctrl+Z behavior for ordinary inputs", async () => {
    const wrapper = mount(ImageProcessModal, { props: { outputRootDir: "D:/covers" } });
    await wrapper.find("button[title='添加文字']").trigger("click");
    const ordinaryInput = wrapper.find<HTMLInputElement>(".field-inline input");
    const event = new KeyboardEvent("keydown", { key: "z", ctrlKey: true, bubbles: true, cancelable: true });

    ordinaryInput.element.dispatchEvent(event);
    await wrapper.vm.$nextTick();

    expect(event.defaultPrevented).toBe(false);
    expect(wrapper.find(".annotation-item").exists()).toBe(true);
    wrapper.unmount();
  });

  it("rotates only the selected foreground image and reset restores zero degrees", async () => {
    const wrapper = mount(ImageProcessModal, { props: { outputRootDir: "D:/covers" } });
    const input = wrapper.find<HTMLInputElement>('input[type="file"][multiple]');
    Object.defineProperty(input.element, "files", {
      configurable: true,
      value: [new File(["image"], "poster.jpg", { type: "image/jpeg" })],
    });
    await input.trigger("change");

    const image = wrapper.find<HTMLImageElement>(".preview-cell img");
    Object.defineProperty(image.element, "naturalWidth", { configurable: true, value: 400 });
    Object.defineProperty(image.element, "naturalHeight", { configurable: true, value: 200 });
    await image.trigger("load");

    expect(wrapper.find("button[aria-label='左旋转90度']").exists()).toBe(true);
    await wrapper.find("button[aria-label='右旋转90度']").trigger("click");
    expect(image.element.style.transform).toContain("rotate(90deg)");
    await wrapper.find("button[aria-label='还原']").trigger("click");
    expect(image.element.style.transform).toContain("rotate(0deg)");
    wrapper.unmount();
  });

  it("shows rotation controls for every image in a multi-image layout", async () => {
    const wrapper = mount(ImageProcessModal, { props: { outputRootDir: "D:/covers" } });
    const twoImageLayout = wrapper.findAll(".preset-card").find((card) => card.text().includes("左右"));
    await twoImageLayout!.trigger("click");
    const input = wrapper.find<HTMLInputElement>('input[type="file"][multiple]');
    Object.defineProperty(input.element, "files", {
      configurable: true,
      value: [
        new File(["one"], "one.jpg", { type: "image/jpeg" }),
        new File(["two"], "two.jpg", { type: "image/jpeg" }),
      ],
    });
    await input.trigger("change");

    const rotateRightButtons = wrapper.findAll("button[aria-label='右旋转90度']");
    expect(rotateRightButtons).toHaveLength(2);
    await rotateRightButtons[0]!.trigger("click");

    expect(wrapper.findAll<HTMLImageElement>(".preview-cell img")[0]!.element.style.transform).toContain("rotate(90deg)");
    expect(wrapper.findAll(".preview-cell")[0]!.classes()).toContain("preview-cell--selected");
    wrapper.unmount();
  });
});
