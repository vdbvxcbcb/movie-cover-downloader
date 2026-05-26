import { computed, ref, watch } from "vue";
import type { Ref } from "vue";
import { layoutPresets } from "./constants";

export function useImageProcessLayoutState(options: {
  activeSlotIndex: Ref<number>;
  selectedSlotIndex: Ref<number | null>;
}) {
  const selectedLayoutId = ref("q4-grid");
  const selectedLayout = computed(() => layoutPresets.find((layout) => layout.id === selectedLayoutId.value) ?? layoutPresets[0]);
  const visibleCells = computed(() => selectedLayout.value.cells);
  const singleImageLayoutSelected = computed(() => selectedLayout.value.count === 1);
  const groupedLayouts = computed(() =>
    Array.from({ length: 9 }, (_, index) => ({
      count: index + 1,
      layouts: layoutPresets.filter((layout) => layout.count === index + 1),
    })),
  );

  watch(selectedLayoutId, () => {
    options.activeSlotIndex.value = 0;
    if (options.selectedSlotIndex.value !== null && options.selectedSlotIndex.value >= visibleCells.value.length) {
      options.selectedSlotIndex.value = null;
    }
  });

  return {
    selectedLayoutId,
    selectedLayout,
    visibleCells,
    singleImageLayoutSelected,
    groupedLayouts,
  };
}
