<script setup lang="ts">
// 气泡确认组件：用于删除、清空等危险操作的二次确认。
import { nextTick, onBeforeUnmount, onMounted, ref } from "vue";
import ActionButton from "./ActionButton.vue";

const props = withDefaults(
  defineProps<{
    label: string;
    title: string;
    description?: string;
    confirmLabel?: string;
    cancelLabel?: string;
    variant?: "primary" | "ghost";
    size?: "md" | "sm";
    bubbleSize?: "compact" | "normal";
    disabled?: boolean;
    beforeOpen?: () => boolean | Promise<boolean>;
  }>(),
  {
    description: "",
    confirmLabel: "确认",
    cancelLabel: "取消",
    variant: "ghost",
    size: "md",
    bubbleSize: "compact",
    disabled: false,
  },
);

const emit = defineEmits<{
  confirm: [];
  cancel: [];
}>();

const isOpen = ref(false);
const rootRef = ref<HTMLElement | null>(null);
const bubbleRef = ref<HTMLElement | null>(null);
const bubbleStyle = ref<Record<string, string>>({});

// 气泡定位按触发按钮计算，并限制在视口内，防止确认按钮溢出屏幕。
// 根据触发按钮和视口宽度计算气泡位置，避免确认按钮溢出屏幕。
function updateBubblePosition() {
  const root = rootRef.value;
  if (!root) {
    return;
  }

  const rect = root.getBoundingClientRect();
  const width = 210;
  const gap = 8;
  const bubbleHeight = bubbleRef.value?.offsetHeight ?? 88;
  const triggerCenterX = rect.left + rect.width / 2;
  const bubbleWidth = bubbleRef.value?.offsetWidth ?? width;
  const left = Math.min(Math.max(triggerCenterX - bubbleWidth / 2, 12), window.innerWidth - bubbleWidth - 12);
  const top = Math.max(rect.top - bubbleHeight - gap, 12);
  const arrowLeft = Math.min(Math.max(triggerCenterX - left, 18), bubbleWidth - 18);
  const isAbove = top < rect.top;

  bubbleStyle.value = {
    left: `${left}px`,
    top: `${top}px`,
    "--pop-confirm-arrow-left": `${arrowLeft}px`,
    "--pop-confirm-arrow-display": isAbove ? "block" : "none",
  };
}

// 打开气泡确认框，并在下一轮渲染后计算定位。
async function open() {
  if (props.beforeOpen && !(await props.beforeOpen())) {
    return;
  }

  isOpen.value = true;
  void nextTick(updateBubblePosition);
}

// 关闭气泡确认框，供取消、确认和外部点击复用。
function close() {
  isOpen.value = false;
}

// 用户点击确认时先关闭气泡，再向父组件发出 confirm 事件。
function confirm() {
  close();
  emit("confirm");
}

// 用户点击取消时关闭气泡，并向父组件发出 cancel 事件。
function cancel() {
  close();
  emit("cancel");
}

// 全局点击监听：点击气泡和触发按钮之外的位置时自动关闭确认框。
function handleDocumentPointerDown(event: PointerEvent) {
  const target = event.target as Node;
  if (
    !isOpen.value ||
    rootRef.value?.contains(target) ||
    bubbleRef.value?.contains(target)
  ) {
    return;
  }

  close();
}

// 键盘 Esc 关闭气泡，符合弹出层的常规交互习惯。
function handleDocumentKeydown(event: KeyboardEvent) {
  if (event.key === "Escape") {
    close();
  }
}

// 窗口尺寸或滚动变化时重新计算气泡位置，避免定位漂移。
function handleViewportChange() {
  if (isOpen.value) {
    updateBubblePosition();
  }
}

onMounted(() => {
  document.addEventListener("pointerdown", handleDocumentPointerDown);
  document.addEventListener("keydown", handleDocumentKeydown);
  window.addEventListener("resize", handleViewportChange);
  window.addEventListener("scroll", handleViewportChange, true);
});

onBeforeUnmount(() => {
  document.removeEventListener("pointerdown", handleDocumentPointerDown);
  document.removeEventListener("keydown", handleDocumentKeydown);
  window.removeEventListener("resize", handleViewportChange);
  window.removeEventListener("scroll", handleViewportChange, true);
});
</script>

<template>
  <span ref="rootRef" class="pop-confirm-action">
    <ActionButton :label="label" :variant="variant" :size="size" :disabled="disabled" @click="void open()" />
    <Teleport to="body">
      <span
        v-if="isOpen"
        ref="bubbleRef"
        class="pop-confirm-action__bubble"
        :class="{ 'pop-confirm-action__bubble--normal': bubbleSize === 'normal' }"
        :style="bubbleStyle"
        role="dialog"
        aria-modal="false"
      >
        <strong>{{ title }}</strong>
        <span v-if="description">{{ description }}</span>
        <span class="pop-confirm-action__actions">
          <button type="button" class="pop-confirm-action__cancel" @click="cancel">{{ cancelLabel }}</button>
          <button type="button" class="pop-confirm-action__confirm" @click="confirm">{{ confirmLabel }}</button>
        </span>
      </span>
    </Teleport>
  </span>
</template>

<style scoped>
.pop-confirm-action {
  position: relative;
  display: inline-flex;
}

.pop-confirm-action__bubble {
  position: fixed;
  z-index: 1000;
  display: grid;
  width: 210px;
  gap: 7px;
  padding: 9px 10px;
  border: 1px solid var(--line-strong);
  border-radius: 10px;
  background: rgba(9, 22, 25, 0.98);
  box-shadow: 0 18px 42px rgba(0, 0, 0, 0.38);
  color: var(--text);
  text-align: left;
}

.pop-confirm-action__bubble--normal {
  width: 232px;
  gap: 8px;
  padding: 10px 11px;
}

.pop-confirm-action__bubble::before {
  content: "";
  display: var(--pop-confirm-arrow-display, block);
  position: absolute;
  bottom: -6px;
  left: var(--pop-confirm-arrow-left, 50%);
  width: 10px;
  height: 10px;
  border-right: 1px solid var(--line-strong);
  border-bottom: 1px solid var(--line-strong);
  background: rgba(9, 22, 25, 0.98);
  transform: translateX(-50%) rotate(45deg);
}

.pop-confirm-action__bubble strong {
  font-size: 0.82rem;
  line-height: 1.25;
  white-space: pre-line;
  overflow-wrap: anywhere;
}

.pop-confirm-action__bubble span {
  color: var(--muted);
  font-size: 0.74rem;
  line-height: 1.35;
  white-space: nowrap;
}

.pop-confirm-action__bubble--normal span {
  white-space: normal;
}

.pop-confirm-action__bubble--normal .pop-confirm-action__actions {
  justify-content: flex-end;
  padding-left: 0;
}

.pop-confirm-action__actions {
  display: flex;
  justify-content: flex-end;
  gap: 6px;
  padding-right: 8px;
  min-width: 0;
}

.pop-confirm-action__cancel,
.pop-confirm-action__confirm {
  min-width: 44px;
  padding: 5px 7px;
  border-radius: 8px;
  border: 1px solid var(--line);
  font-size: 0.74rem;
}

.pop-confirm-action__cancel {
  background: transparent;
  color: var(--muted);
}

.pop-confirm-action__confirm {
  border-color: rgba(255, 123, 114, 0.52);
  background: rgba(255, 123, 114, 0.16);
  color: #ffd1cd;
}
</style>
