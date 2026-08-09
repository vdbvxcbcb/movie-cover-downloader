import { computed, ref, watch } from "vue";
import type { Ref } from "vue";
import { layoutPresets } from "./constants";

export function getImageProcessExportSize(ratio: number, scale: number) {
  const longEdge = Math.round(1800 * Math.min(1, Math.max(0.3, scale)));
  if (ratio >= 1) {
    return { width: longEdge, height: Math.round(longEdge / ratio) };
  }

  return { width: Math.round(longEdge * ratio), height: longEdge };
}

export function useImageProcessLayoutState(options: {
  activeSlotIndex: Ref<number>;
  selectedSlotIndex: Ref<number | null>;
}) {
  const selectedLayoutId = ref("q1-full");
  const selectedLayout = computed(() => layoutPresets.find((layout) => layout.id === selectedLayoutId.value) ?? layoutPresets[0]);
  const visibleCells = computed(() => selectedLayout.value.cells);
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
    groupedLayouts,
  };
}
