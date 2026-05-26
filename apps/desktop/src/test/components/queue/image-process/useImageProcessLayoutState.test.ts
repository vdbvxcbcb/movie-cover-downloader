import { nextTick, ref } from "vue";
import { describe, expect, it } from "vitest";
import { useImageProcessLayoutState } from "../../../../components/composables/useImageProcessLayoutState";

describe("image process layout state", () => {
  it("resets active slot and clears out-of-range selected slot after layout changes", async () => {
    const activeSlotIndex = ref(3);
    const selectedSlotIndex = ref<number | null>(4);
    const layoutState = useImageProcessLayoutState({ activeSlotIndex, selectedSlotIndex });

    layoutState.selectedLayoutId.value = "q1-full";
    await nextTick();

    expect(activeSlotIndex.value).toBe(0);
    expect(selectedSlotIndex.value).toBeNull();
    expect(layoutState.visibleCells.value).toHaveLength(1);
  });
});
