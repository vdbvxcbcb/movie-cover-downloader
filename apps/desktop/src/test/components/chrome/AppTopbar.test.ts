import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import AppTopbar from "../../../components/chrome/AppTopbar.vue";

describe("app topbar", () => {
  it("renders actions by id and emits the selected action", async () => {
    const wrapper = mount(AppTopbar, {
      props: {
        eyebrow: "Control",
        title: "控制中心",
        description: "队列操作",
        pendingActionIds: ["search"],
        actions: [
          { id: "create", label: "执行" },
          { id: "search", label: "执行", variant: "primary" },
        ],
      },
    });

    const buttons = wrapper.findAll("button");
    expect(buttons).toHaveLength(2);
    expect(buttons[1]!.attributes("disabled")).toBeDefined();

    await buttons[0]!.trigger("click");
    expect(wrapper.emitted("action")).toEqual([["create"]]);
  });
});
