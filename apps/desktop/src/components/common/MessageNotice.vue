<script setup lang="ts">
// 顶部全局 Message：用于弹窗外的轻量反馈，默认 3 秒自动关闭。
import { onBeforeUnmount, onMounted, watch } from "vue";

const props = withDefaults(
  defineProps<{
    message: string;
    tone?: "success" | "error" | "warn";
    duration?: number;
  }>(),
  {
    tone: "warn",
    duration: 3000,
  },
);

const emit = defineEmits<{
  close: [];
}>();

let closeTimer: number | null = null;

function clearCloseTimer() {
  if (closeTimer !== null) {
    window.clearTimeout(closeTimer);
    closeTimer = null;
  }
}

function scheduleClose() {
  clearCloseTimer();
  closeTimer = window.setTimeout(() => {
    closeTimer = null;
    emit("close");
  }, props.duration);
}

onMounted(scheduleClose);
onBeforeUnmount(clearCloseTimer);

watch(
  () => props.message,
  () => scheduleClose(),
);
</script>

<template>
  <div class="message-notice" :class="`message-notice--${tone}`" :role="tone === 'error' ? 'alert' : 'status'">
    <span class="message-notice__icon" aria-hidden="true">
      {{ tone === "success" ? "✓" : tone === "error" ? "×" : "!" }}
    </span>
    <p>{{ message }}</p>
  </div>
</template>

<style scoped>
.message-notice {
  position: fixed;
  top: 18px;
  left: 50%;
  z-index: 90;
  display: inline-flex;
  align-items: center;
  gap: 10px;
  width: max-content;
  max-width: min(620px, calc(100vw - 32px));
  min-height: 44px;
  padding: 10px 17px;
  border: 1px solid var(--line-strong);
  border-radius: 12px;
  color: var(--text);
  background:
    linear-gradient(135deg, rgba(77, 212, 198, 0.1), rgba(255, 255, 255, 0.025)),
    rgba(7, 21, 25, 0.96);
  box-shadow: 0 18px 60px rgba(0, 0, 0, 0.34);
  backdrop-filter: blur(18px);
  transform: translateX(-50%);
  animation: message-in 180ms ease-out;
}

.message-notice p {
  margin: 0;
  overflow-wrap: anywhere;
  color: var(--text);
  text-shadow: 0 1px 0 rgba(0, 0, 0, 0.18);
}

.message-notice__icon {
  display: inline-grid;
  place-items: center;
  flex: 0 0 auto;
  width: 18px;
  height: 18px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 700;
  line-height: 1;
}

.message-notice--success {
  border-color: rgba(142, 229, 156, 0.42);
  background:
    linear-gradient(135deg, rgba(142, 229, 156, 0.16), rgba(77, 212, 198, 0.06)),
    rgba(7, 21, 25, 0.96);
}

.message-notice--success .message-notice__icon {
  color: #06230d;
  background: var(--success);
  box-shadow: 0 0 18px rgba(142, 229, 156, 0.42);
}

.message-notice--error {
  border-color: rgba(255, 123, 114, 0.45);
  background:
    linear-gradient(135deg, rgba(255, 123, 114, 0.15), rgba(255, 255, 255, 0.025)),
    rgba(7, 21, 25, 0.96);
}

.message-notice--error .message-notice__icon {
  color: #330806;
  background: var(--danger);
  box-shadow: 0 0 18px rgba(255, 123, 114, 0.42);
}

.message-notice--warn {
  border-color: rgba(255, 212, 121, 0.45);
  background:
    linear-gradient(135deg, rgba(255, 212, 121, 0.16), rgba(255, 255, 255, 0.025)),
    rgba(7, 21, 25, 0.96);
}

.message-notice--warn .message-notice__icon {
  color: #2c1a03;
  background: var(--warn);
  box-shadow: 0 0 18px rgba(255, 212, 121, 0.42);
}

@keyframes message-in {
  from {
    opacity: 0;
    transform: translate(-50%, -8px);
  }

  to {
    opacity: 1;
    transform: translate(-50%, 0);
  }
}
</style>
