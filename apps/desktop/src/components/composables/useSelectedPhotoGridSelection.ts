import { computed, onBeforeUnmount, ref } from "vue";
import type { Ref } from "vue";
import type { SelectableDoubanPhoto } from "../../types/app";

interface UseSelectedPhotoGridSelectionOptions {
  photos: Readonly<Ref<SelectableDoubanPhoto[]>>;
  gridRef: Readonly<Ref<HTMLElement | null>>;
  updatePhotos: (photos: SelectableDoubanPhoto[]) => void;
  openPreview: (photoId: string) => void;
}

const selectedPhotoDragThreshold = 6;

export function useSelectedPhotoGridSelection(options: UseSelectedPhotoGridSelectionOptions) {
  let selectedPhotoClickTimer: number | null = null;
  let selectedPhotoClickPhotoId: string | null = null;
  let selectedPhotoDragFrame: number | null = null;
  let selectedPhotoDragFrameEvent: PointerEvent | null = null;

  const selectedPhotoDragState = ref<{
    pointerId: number;
    startClientX: number;
    startClientY: number;
    startPhotoId: string | null;
    initialSelectedIds: Set<string>;
    selecting: boolean;
  } | null>(null);
  const selectedPhotoDragBox = ref<{ left: number; top: number; width: number; height: number } | null>(null);

  const isSelectedPhotoDragSelecting = computed(() => Boolean(selectedPhotoDragState.value?.selecting));
  const selectedPhotoDragBoxStyle = computed(() => {
    const box = selectedPhotoDragBox.value;
    if (!box) return {};
    return {
      left: `${box.left}px`,
      top: `${box.top}px`,
      width: `${box.width}px`,
      height: `${box.height}px`,
    };
  });

  function toggleSelectedPhoto(photoId: string) {
    const index = options.photos.value.findIndex((photo) => photo.id === photoId);
    if (index < 0) return;
    const photo = options.photos.value[index]!;
    const nextPhotos = options.photos.value.slice();
    nextPhotos[index] = { ...photo, selected: !photo.selected };
    options.updatePhotos(nextPhotos);
  }

  function clearSelectedPhotoClickTimer() {
    if (selectedPhotoClickTimer === null) return;
    window.clearTimeout(selectedPhotoClickTimer);
    selectedPhotoClickTimer = null;
    selectedPhotoClickPhotoId = null;
  }

  function getSelectedPhotoDragBox(event: PointerEvent, grid: HTMLElement) {
    const gridRect = grid.getBoundingClientRect();
    const left = Math.min(selectedPhotoDragState.value!.startClientX, event.clientX);
    const top = Math.min(selectedPhotoDragState.value!.startClientY, event.clientY);
    const right = Math.max(selectedPhotoDragState.value!.startClientX, event.clientX);
    const bottom = Math.max(selectedPhotoDragState.value!.startClientY, event.clientY);

    selectedPhotoDragBox.value = {
      left: left - gridRect.left + grid.scrollLeft,
      top: top - gridRect.top + grid.scrollTop,
      width: right - left,
      height: bottom - top,
    };

    return { left, top, right, bottom };
  }

  function rectsIntersect(a: { left: number; top: number; right: number; bottom: number }, b: DOMRect) {
    return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
  }

  function getSelectedPhotoIdFromEventTarget(target: EventTarget | null) {
    return target instanceof HTMLElement ? (target.closest<HTMLElement>(".selected-photo-card")?.dataset.selectedPhotoId ?? null) : null;
  }

  function getSelectedPhotoIdFromPointer(event: PointerEvent) {
    return getSelectedPhotoIdFromEventTarget(document.elementFromPoint(event.clientX, event.clientY));
  }

  function updateSelectedPhotoDrag(event: PointerEvent) {
    const dragState = selectedPhotoDragState.value;
    const grid = options.gridRef.value;
    if (!dragState || !grid) return;

    const box = getSelectedPhotoDragBox(event, grid);
    const hitIds = new Set<string>();
    grid.querySelectorAll<HTMLElement>(".selected-photo-card[data-selected-photo-id]").forEach((card) => {
      const photoId = card.dataset.selectedPhotoId;
      if (photoId && rectsIntersect(box, card.getBoundingClientRect())) {
        hitIds.add(photoId);
      }
    });

    options.updatePhotos(
      options.photos.value.map((photo) => {
        const selected = dragState.initialSelectedIds.has(photo.id) || hitIds.has(photo.id);
        return photo.selected === selected ? photo : { ...photo, selected };
      }),
    );
  }

  function scheduleSelectedPhotoDragUpdate(event: PointerEvent) {
    selectedPhotoDragFrameEvent = event;
    if (selectedPhotoDragFrame !== null) return;

    selectedPhotoDragFrame = window.requestAnimationFrame(() => {
      selectedPhotoDragFrame = null;
      const frameEvent = selectedPhotoDragFrameEvent;
      selectedPhotoDragFrameEvent = null;
      if (frameEvent) {
        updateSelectedPhotoDrag(frameEvent);
      }
    });
  }

  function handleSelectedPhotoGridPointerDown(event: PointerEvent) {
    if (event.button !== 0 || !event.isPrimary) return;
    const grid = options.gridRef.value;
    if (!grid) return;

    selectedPhotoDragState.value = {
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startPhotoId: getSelectedPhotoIdFromEventTarget(event.target),
      initialSelectedIds: new Set(options.photos.value.flatMap((photo) => (photo.selected ? [photo.id] : []))),
      selecting: false,
    };
    selectedPhotoDragBox.value = null;
    grid.setPointerCapture(event.pointerId);
  }

  function handleSelectedPhotoGridPointerMove(event: PointerEvent) {
    const dragState = selectedPhotoDragState.value;
    if (!dragState || dragState.pointerId !== event.pointerId) return;

    const distance = Math.hypot(event.clientX - dragState.startClientX, event.clientY - dragState.startClientY);
    if (!dragState.selecting && distance < selectedPhotoDragThreshold) return;
    if (!dragState.selecting) {
      clearSelectedPhotoClickTimer();
      dragState.selecting = true;
    }

    event.preventDefault();
    scheduleSelectedPhotoDragUpdate(event);
  }

  function finishSelectedPhotoDrag(event: PointerEvent) {
    const dragState = selectedPhotoDragState.value;
    const grid = options.gridRef.value;
    if (!dragState || dragState.pointerId !== event.pointerId) return;

    if (dragState.selecting) {
      event.preventDefault();
      updateSelectedPhotoDrag(event);
    } else if (dragState.startPhotoId && dragState.startPhotoId === getSelectedPhotoIdFromPointer(event)) {
      handleSelectedPhotoClick(dragState.startPhotoId);
    }

    if (grid?.hasPointerCapture(event.pointerId)) {
      grid.releasePointerCapture(event.pointerId);
    }
    selectedPhotoDragState.value = null;
    selectedPhotoDragBox.value = null;
  }

  function cancelSelectedPhotoDrag(event?: PointerEvent) {
    const dragState = selectedPhotoDragState.value;
    const grid = options.gridRef.value;
    if (event && dragState && dragState.pointerId !== event.pointerId) return;
    if (selectedPhotoDragFrame !== null) {
      window.cancelAnimationFrame(selectedPhotoDragFrame);
      selectedPhotoDragFrame = null;
      selectedPhotoDragFrameEvent = null;
    }
    if (event && grid?.hasPointerCapture(event.pointerId)) {
      grid.releasePointerCapture(event.pointerId);
    }
    selectedPhotoDragState.value = null;
    selectedPhotoDragBox.value = null;
  }

  function handleSelectedPhotoClick(photoId: string) {
    if (selectedPhotoClickTimer !== null) {
      const isDoubleClick = selectedPhotoClickPhotoId === photoId;
      clearSelectedPhotoClickTimer();
      if (isDoubleClick) {
        options.openPreview(photoId);
        return;
      }
    }
    selectedPhotoClickPhotoId = photoId;
    selectedPhotoClickTimer = window.setTimeout(() => {
      selectedPhotoClickTimer = null;
      selectedPhotoClickPhotoId = null;
      toggleSelectedPhoto(photoId);
    }, 180);
  }

  function handleSelectedPhotoDoubleClick(photoId: string) {
    clearSelectedPhotoClickTimer();
    options.openPreview(photoId);
  }

  onBeforeUnmount(() => {
    clearSelectedPhotoClickTimer();
    cancelSelectedPhotoDrag();
  });

  return {
    isSelectedPhotoDragSelecting,
    selectedPhotoDragBox,
    selectedPhotoDragBoxStyle,
    handleSelectedPhotoGridPointerDown,
    handleSelectedPhotoGridPointerMove,
    finishSelectedPhotoDrag,
    cancelSelectedPhotoDrag,
    handleSelectedPhotoDoubleClick,
  };
}
