import { nextTick, ref } from "vue";
import { describe, expect, it } from "vitest";
import { useImageProcessLayoutState } from "../../../composables/useImageProcessLayoutState";

describe("image process layout state", () => {
  it("starts with the single-image layout", () => {
    const layoutState = useImageProcessLayoutState({
      activeSlotIndex: ref(0),
      selectedSlotIndex: ref<number | null>(null),
    });

    expect(layoutState.selectedLayoutId.value).toBe("q1-full");
    expect(layoutState.visibleCells.value).toHaveLength(1);
  });

  it("resets active slot and clears out-of-range selected slot after layout changes", async () => {
    const activeSlotIndex = ref(3);
    const selectedSlotIndex = ref<number | null>(4);
    const layoutState = useImageProcessLayoutState({ activeSlotIndex, selectedSlotIndex });

    layoutState.selectedLayoutId.value = "q4-grid";
    await nextTick();
    layoutState.selectedLayoutId.value = "q1-full";
    await nextTick();

    expect(activeSlotIndex.value).toBe(0);
    expect(selectedSlotIndex.value).toBeNull();
    expect(layoutState.visibleCells.value).toHaveLength(1);
  });
});
