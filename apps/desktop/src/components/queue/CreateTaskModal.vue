<script setup lang="ts">
import { computed, reactive, ref } from "vue";
import ActionButton from "../common/ActionButton.vue";
import type {
  DoubanAssetType,
  ImageCountMode,
  OutputImageFormat,
  RequestIntervalSeconds,
  TaskDraft,
} from "../../types/app";
import { normalizeDetailUrlsInput, validateTaskDraftInput } from "../../lib/task-draft-input";
import { runtimeBridge } from "../../lib/runtime-bridge";

const emit = defineEmits<{
  close: [];
  submit: [drafts: TaskDraft[]];
}>();

const form = reactive({
  detailUrls: "",
  outputRootDir: "D:/cover",
  sourceHint: "auto" as const,
  doubanAssetType: "still" as DoubanAssetType,
  imageCountMode: "limited" as ImageCountMode,
  maxImagesInput: "10",
  outputImageFormat: "jpg" as OutputImageFormat,
  requestIntervalSeconds: "1" as "1" | "2" | "3" | "4" | "5",
});
const alertMessage = ref("");

const strategySummary = computed(() => {
  const assetTypeLabel =
    form.doubanAssetType === "poster" ? "海报" : form.doubanAssetType === "wallpaper" ? "壁纸" : "剧照";
  const countSummary =
    form.imageCountMode === "unlimited" ? "不限制抓取数量" : `最多下载 ${form.maxImagesInput || 10} 张图片`;

  return `豆瓣抓图类型为${assetTypeLabel}，请求间隔 ${form.requestIntervalSeconds} 秒；${countSummary}，并按当前表单配置加入队列`;
});

function showAlert(message: string) {
  alertMessage.value = message;
}

function clearAlert() {
  alertMessage.value = "";
}

async function browseOutputDirectory() {
  const selected = await runtimeBridge.pickOutputDirectory(form.outputRootDir);
  if (!selected) return;
  form.outputRootDir = selected;
  clearAlert();
}

function clampMaxImages(value: number) {
  return Math.min(100, Math.max(1, value));
}

function handleMaxImagesKeydown(event: KeyboardEvent) {
  if (["e", "E", "+", "-", ".", ","].includes(event.key)) {
    event.preventDefault();
  }
}

function handleMaxImagesInput(event: Event) {
  const input = event.target as HTMLInputElement;
  form.maxImagesInput = input.value;

  if (input.value && !/^\d+$/.test(input.value)) {
    showAlert("不能加入队列：数量限制填入文本类型错误，非数值类型。");
  } else {
    clearAlert();
  }
}

function handleMaxImagesBlur(event: Event) {
  const input = event.target as HTMLInputElement;
  if (!form.maxImagesInput || !/^\d+$/.test(form.maxImagesInput)) {
    return;
  }

  const normalized = clampMaxImages(Number(form.maxImagesInput));
  form.maxImagesInput = String(normalized);
  input.value = String(normalized);
}

function handleDetailUrlsInput(event: Event) {
  const input = event.target as HTMLTextAreaElement;
  const protocolMatches = input.value.match(/https?:\/\//g) ?? [];
  if (protocolMatches.length < 2 && !/\shttps?:\/\//.test(input.value)) {
    form.detailUrls = input.value;
    clearAlert();
    return;
  }

  const normalized = normalizeDetailUrlsInput(input.value);
  form.detailUrls = normalized;
  input.value = normalized;
  clearAlert();
}

function handleDetailUrlsBlur(event: Event) {
  const input = event.target as HTMLTextAreaElement;
  const normalized = normalizeDetailUrlsInput(input.value);
  form.detailUrls = normalized;
  input.value = normalized;
}

function submit() {
  const validation = validateTaskDraftInput({
    detailUrls: form.detailUrls,
    outputRootDir: form.outputRootDir,
    imageCountMode: form.imageCountMode,
    maxImagesInput: form.maxImagesInput,
  });

  if (!validation.ok) {
    if (validation.message) {
      showAlert(validation.message);
    }
    return;
  }

  const drafts: TaskDraft[] = [];
  for (const detailUrl of validation.detailUrls) {
    drafts.push({
      detailUrl,
      outputRootDir: form.outputRootDir.trim(),
      sourceHint: form.sourceHint,
      doubanAssetType: form.doubanAssetType,
      imageCountMode: form.imageCountMode,
      maxImages: validation.maxImages,
      outputImageFormat: form.outputImageFormat,
      requestIntervalSeconds: Number(form.requestIntervalSeconds) as RequestIntervalSeconds,
    });
  }

  clearAlert();
  emit("submit", drafts);
}
</script>

<template>
  <div class="modal-backdrop">
    <section class="modal-card create-task-modal">
      <div class="panel__head modal-card__head">
        <div>
          <p class="eyebrow">New URL Task</p>
          <h3>新增链接抓图任务</h3>
        </div>
        <button type="button" class="modal-close" aria-label="关闭弹窗" @click="emit('close')">
          ×
        </button>
      </div>

      <div v-if="alertMessage" class="modal-alert" role="alert">
        <strong>提示</strong>
        <span>{{ alertMessage }}</span>
      </div>

      <div class="create-task-modal__grid">
        <label class="field field--wide">
          <span>详情页链接（批量）</span>
          <textarea
            v-model="form.detailUrls"
            rows="5"
            placeholder="链接可自动换行，每行一个链接，例如：&#10;https://movie.douban.com/subject/35010610/&#10;http://www.impawards.com/2024/joker_folie_a_deux.html"
            @blur="handleDetailUrlsBlur"
            @input="handleDetailUrlsInput"
          />
        </label>

        <label class="field field--wide">
          <span>输出目录</span>
          <div class="field-inline">
            <input v-model="form.outputRootDir" placeholder="例如：D:/cover" />
            <ActionButton label="浏览" @click="void browseOutputDirectory()" />
          </div>
        </label>

        <label class="field">
          <span>站点提示</span>
          <select v-model="form.sourceHint">
            <option value="auto">自动识别</option>
            <option value="douban">强制按豆瓣处理</option>
            <option value="impawards">强制按 ImpAwards 处理</option>
          </select>
        </label>

        <label class="field">
          <span>输出格式</span>
          <select v-model="form.outputImageFormat">
            <option value="jpg">JPG</option>
            <option value="png">PNG</option>
          </select>
        </label>

        <label class="field">
          <span>请求间隔</span>
          <select v-model="form.requestIntervalSeconds">
            <option value="1">1 秒</option>
            <option value="2">2 秒</option>
            <option value="3">3 秒</option>
            <option value="4">4 秒</option>
            <option value="5">5 秒</option>
          </select>
        </label>

        <section class="strategy-card field--wide">
          <div class="strategy-grid">
            <div class="strategy-panel">
              <span class="create-task-modal__field-label">豆瓣抓图类型</span>
              <div class="segmented-control">
                <button
                  type="button"
                  class="segmented-control__item"
                  :class="{ 'segmented-control__item--active': form.doubanAssetType === 'still' }"
                  @click="form.doubanAssetType = 'still'"
                >
                  剧照
                </button>
                <button
                  type="button"
                  class="segmented-control__item"
                  :class="{ 'segmented-control__item--active': form.doubanAssetType === 'poster' }"
                  @click="form.doubanAssetType = 'poster'"
                >
                  海报
                </button>
                <button
                  type="button"
                  class="segmented-control__item"
                  :class="{ 'segmented-control__item--active': form.doubanAssetType === 'wallpaper' }"
                  @click="form.doubanAssetType = 'wallpaper'"
                >
                  壁纸
                </button>
              </div>
              <p class="field-hint">
                仅对豆瓣 subject / all_photos / photos 链接生效，ImpAwards 会忽略此项。
              </p>
            </div>

            <div class="strategy-panel">
              <span class="create-task-modal__field-label">数量（张）</span>
              <div class="segmented-control">
                <button
                  type="button"
                  class="segmented-control__item"
                  :class="{ 'segmented-control__item--active': form.imageCountMode === 'limited' }"
                  @click="form.imageCountMode = 'limited'"
                >
                  限制
                </button>
                <button
                  type="button"
                  class="segmented-control__item"
                  :class="{ 'segmented-control__item--active': form.imageCountMode === 'unlimited' }"
                  @click="form.imageCountMode = 'unlimited'"
                >
                  无限制
                </button>
              </div>
              <label v-if="form.imageCountMode === 'limited'" class="field quantity-field">
                <input
                  :value="form.maxImagesInput"
                  type="text"
                  min="1"
                  max="100"
                  step="1"
                  inputmode="numeric"
                  placeholder="默认 10"
                  @blur="handleMaxImagesBlur"
                  @input="handleMaxImagesInput"
                  @keydown="handleMaxImagesKeydown"
                />
              </label>
              <p v-else class="field-hint">将抓取当前分类页可发现的全部图片，不再显示数量输入。</p>
            </div>
          </div>
        </section>

        <label class="field field--wide">
          <span>任务说明</span>
          <input :value="strategySummary" disabled />
        </label>
      </div>

      <div class="topbar__actions">
        <ActionButton label="取消" @click="emit('close')" />
        <ActionButton label="加入队列" variant="primary" @click="submit" />
      </div>
    </section>
  </div>
</template>

<style scoped>
.create-task-modal {
  width: min(900px, 100%);
  max-height: calc(100vh - 48px);
  overflow: auto;
}

.create-task-modal__grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
  margin-bottom: 18px;
}

.modal-alert {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  margin: 0 auto 16px;
  padding: 12px 16px;
  border-radius: 16px;
  border: 1px solid rgba(255, 212, 121, 0.34);
  background: linear-gradient(180deg, rgba(255, 212, 121, 0.14), rgba(255, 212, 121, 0.06));
  color: #ffe2a8;
  text-align: center;
}

.create-task-modal__field-label {
  color: var(--muted);
  font-size: 0.84rem;
}

.strategy-card {
  display: grid;
  gap: 14px;
  padding: 16px;
  border: 1px solid var(--line);
  border-radius: 20px;
  background:
    linear-gradient(180deg, rgba(77, 212, 198, 0.05), transparent 100%),
    rgba(255, 255, 255, 0.03);
}

.strategy-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
}

.strategy-panel {
  display: grid;
  gap: 12px;
  min-width: 0;
  padding: 14px;
  border-radius: 18px;
  border: 1px solid rgba(255, 255, 255, 0.05);
  background: rgba(4, 16, 19, 0.44);
}

.field-hint {
  color: var(--muted);
  font-size: 0.84rem;
  line-height: 1.65;
}

.segmented-control {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
}

.segmented-control__item {
  min-width: 88px;
  padding: 11px 16px;
  border-radius: 14px;
  border: 1px solid var(--line);
  background: rgba(255, 255, 255, 0.03);
  color: var(--muted);
  transition: border-color 160ms ease, background 160ms ease, color 160ms ease, transform 160ms ease;
}

.segmented-control__item:hover {
  border-color: var(--line-strong);
  color: var(--text);
  transform: translateY(-1px);
}

.segmented-control__item--active {
  color: #031113;
  border-color: transparent;
  background: linear-gradient(135deg, var(--accent), #7ce5c9);
  box-shadow: 0 10px 24px rgba(77, 212, 198, 0.2);
}

.quantity-field {
  gap: 10px;
}

.create-task-modal textarea {
  min-height: 108px;
}

@media (max-width: 1480px) {
  .create-task-modal__grid {
    grid-template-columns: 1fr;
  }

  .strategy-grid {
    grid-template-columns: 1fr;
  }
}
</style>
