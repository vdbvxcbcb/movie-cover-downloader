<script setup lang="ts">
import { reactive, ref } from "vue";
import ActionButton from "../common/ActionButton.vue";
import type { CookieDraft, CookieImportMode } from "../../types/app";

const emit = defineEmits<{
  close: [];
  submitManual: [draft: CookieDraft];
  startLoginImport: [];
}>();

const mode = ref<CookieImportMode>("login");
const form = reactive({
  value: "",
  note: "豆瓣 Cookie",
});

function submitManual() {
  const value = form.value.trim();
  const note = form.note.trim() || "豆瓣 Cookie";
  if (!value) return;

  emit("submitManual", {
    value,
    note,
  });
}
</script>

<template>
  <div class="modal-backdrop">
    <section class="modal-card">
      <div class="panel__head modal-card__head">
        <div>
          <p class="eyebrow">Cookie Import</p>
          <h3>导入豆瓣 Cookie</h3>
        </div>
        <button type="button" class="modal-close" aria-label="关闭弹窗" @click="emit('close')">
          ×
        </button>
      </div>

      <div class="cookie-import-mode">
        <button
          class="chip"
          :class="{ 'chip--active': mode === 'login' }"
          type="button"
          @click="mode = 'login'"
        >
          豆瓣登录自动导入
        </button>
        <button
          class="chip"
          :class="{ 'chip--active': mode === 'manual' }"
          type="button"
          @click="mode = 'manual'"
        >
          Cookie字符串导入
        </button>
      </div>

      <div class="form-grid">
        <template v-if="mode === 'login'">
          <div class="field field--wide cookie-import-note">
            <span>说明</span>
            <div class="note-box">
              <strong>豆瓣登录自动导入</strong>
              <p>打开独立豆瓣登录窗口后，你可以使用密码、二维码或短信完成登录。</p>
              <p>登录成功后，应用会自动读取 Cookie；如果中途关闭窗口，则不会导入无效数据。</p>
              <p>导入成功后的 Cookie 默认保留 30 天，到期或手动删除后都需要重新登录。</p>
            </div>
          </div>
        </template>

        <template v-else>
          <label class="field field--wide">
            <span>Cookie 字符串</span>
            <textarea
              v-model="form.value"
              rows="8"
              placeholder="把浏览器请求头中的 Cookie 整段粘贴到这里"
            />
          </label>

          <label class="field field--wide">
            <span>备注</span>
            <input v-model="form.note" placeholder="例如：豆瓣主账号" />
          </label>

          <label class="field field--wide">
            <span>说明</span>
            <input value="导入后默认保留 30 天，并优先用于豆瓣真实下载验证" disabled />
          </label>
        </template>
      </div>

      <div class="topbar__actions modal-actions">
        <ActionButton label="取消" @click="emit('close')" />
        <ActionButton
          v-if="mode === 'login'"
          label="打开豆瓣登录窗口"
          variant="primary"
          @click="emit('startLoginImport')"
        />
        <ActionButton
          v-else
          label="导入Cookie"
          variant="primary"
          :disabled="!form.value.trim()"
          @click="submitManual"
        />
      </div>
    </section>
  </div>
</template>
