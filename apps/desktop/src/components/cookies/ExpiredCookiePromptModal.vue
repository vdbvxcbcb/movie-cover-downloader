<script setup lang="ts">
// 过期 Cookie 提示弹窗：启动时检测到过期 Cookie 后显示，引导用户重新登录。
import ActionButton from "../common/ActionButton.vue";

defineProps<{
  count: number;
  latestExpiresAt?: string;
}>();

const emit = defineEmits<{
  close: [];
  openLogin: [];
}>();

// 格式化过期时间为本地可读格式
function formatExpiresAt(isoString?: string): string {
  if (!isoString) return "未知";
  try {
    const date = new Date(isoString);
    if (isNaN(date.getTime())) return "未知";
    return date.toLocaleString("zh-CN", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  } catch {
    return "未知";
  }
}
</script>

<template>
  <div class="modal-backdrop">
    <section class="modal-card expired-cookie-modal" role="alertdialog" aria-labelledby="expired-cookie-title" aria-describedby="expired-cookie-desc">
      <div class="panel__head modal-card__head">
        <div>
          <p class="eyebrow eyebrow--warn">Cookie Expired</p>
          <h3 id="expired-cookie-title">Cookie 已过期</h3>
        </div>
        <button type="button" class="modal-close" aria-label="关闭弹窗" @click="emit('close')">
          ×
        </button>
      </div>

      <div class="expired-cookie-content">
        <div class="expired-cookie-icon">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
            <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
            <line x1="12" y1="9" x2="12" y2="13" />
            <line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
        </div>

        <div id="expired-cookie-desc" class="expired-cookie-message">
          <p class="message-primary">
            检测到 <strong>{{ count }}</strong> 个豆瓣 Cookie 已过期
          </p>
          <p v-if="latestExpiresAt" class="message-detail">
            过期时间：{{ formatExpiresAt(latestExpiresAt) }}
          </p>
          <p class="message-impact">
            过期的 Cookie 无法用于搜索影视和下载图片，建议立即重新登录。
          </p>
        </div>
      </div>

      <div class="topbar__actions modal-actions">
        <ActionButton label="取消" @click="emit('close')" />
        <ActionButton label="打开登录窗口" variant="primary" @click="emit('openLogin')" />
      </div>
    </section>
  </div>
</template>

<style scoped>
.expired-cookie-modal {
  max-width: 540px;
}

.eyebrow--warn {
  color: var(--warn);
}

.expired-cookie-content {
  display: grid;
  gap: 20px;
  padding: 24px 0;
  text-align: center;
}

.expired-cookie-icon {
  display: flex;
  justify-content: center;
  color: var(--warn);
  opacity: 0.9;
}

.expired-cookie-message {
  display: grid;
  gap: 12px;
}

.message-primary {
  font-size: 1.05rem;
  color: var(--text);
  line-height: 1.6;
}

.message-primary strong {
  color: var(--warn);
  font-weight: 600;
}

.message-detail {
  font-size: 0.92rem;
  color: var(--muted);
}

.message-impact {
  font-size: 0.92rem;
  color: var(--muted);
  line-height: 1.6;
}
</style>
