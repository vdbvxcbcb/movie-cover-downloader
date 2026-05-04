<script setup lang="ts">
// 新增链接任务弹窗：收集豆瓣链接、输出目录、抓取类型、数量和图片尺寸。
import { computed, reactive, ref } from "vue";
import ActionButton from "../common/ActionButton.vue";
import type {
  DoubanAssetType,
  ImageCountMode,
  ImageAspectRatio,
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

// 表单状态保持字符串输入，提交前再统一校验和转换，便于给出明确的用户错误提示。
const form = reactive({
  detailUrls: "",
  outputRootDir: "D:/cover",
  doubanAssetType: "still" as DoubanAssetType,
  imageCountMode: "limited" as ImageCountMode,
  maxImagesInput: "10",
  outputImageFormat: "jpg" as OutputImageFormat,
  imageAspectRatio: "original" as ImageAspectRatio,
  requestIntervalSeconds: "1" as "1" | "2" | "3" | "4" | "5",
});
const alertMessage = ref("");

// 任务说明随表单实时计算，让用户在加入队列前确认抓取类型、数量和尺寸策略。
const strategySummary = computed(() => {
  const assetTypeLabel =
    form.doubanAssetType === "poster" ? "海报" : form.doubanAssetType === "wallpaper" ? "壁纸" : "剧照";
  const countSummary =
    form.imageCountMode === "unlimited" ? "不限制抓取数量" : `最多下载 ${form.maxImagesInput || 10} 张图片`;

  const ratioLabel = form.imageAspectRatio === "original" ? "原图尺寸" : form.imageAspectRatio;

  return `豆瓣抓图类型为${assetTypeLabel}，图片尺寸 ${ratioLabel}，请求间隔 ${form.requestIntervalSeconds} 秒；${countSummary}，并按当前表单配置加入队列`;
});

// 显示表单错误提示，阻止用户在校验失败时加入队列。
function showAlert(message: string) {
  alertMessage.value = message;
}

// 清除表单提示，通常在用户重新输入或操作成功后调用。
function clearAlert() {
  alertMessage.value = "";
}

// 打开系统目录选择器，并把选择结果写回输出目录输入框。
async function browseOutputDirectory() {
  const selected = await runtimeBridge.pickOutputDirectory(form.outputRootDir);
  if (!selected) return;
  form.outputRootDir = selected;
  clearAlert();
}

// 把限制数量固定在 1 到 100 之间，避免输入过小或过大。
function clampMaxImages(value: number) {
  return Math.min(100, Math.max(1, value));
}

// 将数量输入框的字符串转换成可用于加减按钮的安全数字。
const currentMaxImagesValue = computed(() => {
  if (!/^\d+$/.test(form.maxImagesInput)) {
    return 10;
  }

  return clampMaxImages(Number(form.maxImagesInput));
});

// 数量拨轮减号是否可用，最小值为 1。
const canDecreaseMaxImages = computed(() => currentMaxImagesValue.value > 1);
// 数量拨轮加号是否可用，最大值为 100。
const canIncreaseMaxImages = computed(() => currentMaxImagesValue.value < 100);

// 数字拨轮点击一次只增加或减少 1，并同步清除旧错误提示。
function stepMaxImages(delta: -1 | 1) {
  form.maxImagesInput = String(clampMaxImages(currentMaxImagesValue.value + delta));
  clearAlert();
}

// 阻止 e、正负号、小数点等非整数输入进入数量输入框。
function handleMaxImagesKeydown(event: KeyboardEvent) {
  if (["e", "E", "+", "-", ".", ","].includes(event.key)) {
    event.preventDefault();
  }
}

// 实时记录数量输入内容，并在非数字时立即提示不能加入队列。
function handleMaxImagesInput(event: Event) {
  const input = event.target as HTMLInputElement;
  form.maxImagesInput = input.value;

  if (input.value && !/^\d+$/.test(input.value)) {
    showAlert("不能加入队列：数量限制填入文本类型错误，非数值类型。");
  } else {
    clearAlert();
  }
}

// 数量输入框失焦时把合法数字归一化到允许范围内。
function handleMaxImagesBlur(event: Event) {
  const input = event.target as HTMLInputElement;
  if (!form.maxImagesInput || !/^\d+$/.test(form.maxImagesInput)) {
    return;
  }

  const normalized = clampMaxImages(Number(form.maxImagesInput));
  form.maxImagesInput = String(normalized);
  input.value = String(normalized);
}

// 粘贴多条链接时自动拆行，减少用户手工整理批量豆瓣链接的成本。
// 输入详情页链接时自动拆分连续 URL，并在用户继续输入时清理旧提示。
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

// 链接文本框失焦后统一规范化换行，保证提交时每行一个链接。
function handleDetailUrlsBlur(event: Event) {
  const input = event.target as HTMLTextAreaElement;
  const normalized = normalizeDetailUrlsInput(input.value);
  form.detailUrls = normalized;
  input.value = normalized;
}

// 提交时只接收通过校验的豆瓣 subject 链接，任何错误都会阻止加入队列并展示原因。
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
      sourceHint: "auto",
      doubanAssetType: form.doubanAssetType,
      imageCountMode: form.imageCountMode,
      maxImages: validation.maxImages,
      outputImageFormat: form.outputImageFormat,
      imageAspectRatio: form.imageAspectRatio,
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
            placeholder="链接可自动换行，每行一个链接，例如：&#10;https://movie.douban.com/subject/35010610/&#10;https://movie.douban.com/subject/1292064/"
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
              <p class="field-hint field-hint--spacer" aria-hidden="true">&nbsp;</p>
            </div>

            <div class="strategy-panel">
              <span class="create-task-modal__field-label">数量（张）</span>
              <div class="quantity-control-row">
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
                <div v-if="form.imageCountMode === 'limited'" class="quantity-field">
                  <div class="number-stepper">
                    <button
                      type="button"
                      class="number-stepper__control"
                      :disabled="!canDecreaseMaxImages"
                      aria-label="减少下载数量"
                      @click="stepMaxImages(-1)"
                    >
                      -
                    </button>
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
                    <button
                      type="button"
                      class="number-stepper__control"
                      :disabled="!canIncreaseMaxImages"
                      aria-label="增加下载数量"
                      @click="stepMaxImages(1)"
                    >
                      +
                    </button>
                  </div>
                </div>
              </div>
              <p v-if="form.imageCountMode === 'unlimited'" class="field-hint">将抓取当前分类页可发现的全部图片，不再显示数量输入。</p>
              <p v-else class="field-hint field-hint--spacer" aria-hidden="true">&nbsp;</p>
            </div>
            <div class="strategy-panel">
              <span class="create-task-modal__field-label">图片尺寸</span>
              <div class="segmented-control">
                <button
                  type="button"
                  class="segmented-control__item"
                  :class="{ 'segmented-control__item--active': form.imageAspectRatio === 'original' }"
                  @click="form.imageAspectRatio = 'original'"
                >
                  原图尺寸
                </button>
                <button
                  type="button"
                  class="segmented-control__item"
                  :class="{ 'segmented-control__item--active': form.imageAspectRatio === '9:16' }"
                  @click="form.imageAspectRatio = '9:16'"
                >
                  9:16
                </button>
                <button
                  type="button"
                  class="segmented-control__item"
                  :class="{ 'segmented-control__item--active': form.imageAspectRatio === '3:4' }"
                  @click="form.imageAspectRatio = '3:4'"
                >
                  3:4
                </button>
              </div>
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
  align-content: start;
  gap: 12px;
  min-width: 0;
  padding: 14px;
  border-radius: 18px;
  border: 1px solid rgba(255, 255, 255, 0.05);
  background: rgba(4, 16, 19, 0.44);
}

.strategy-panel:first-child .segmented-control {
  align-self: start;
}

.field-hint {
  min-height: 1.65em;
  margin: 0;
  color: var(--muted);
  font-size: 0.84rem;
  line-height: 1.65;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.field-hint--spacer {
  visibility: hidden;
}

/* 数量输入与限制/无限制按钮同排，宽度受控以避免挤压右侧策略区域。 */
.quantity-control-row {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  min-width: 0;
}

.quantity-control-row .segmented-control {
  flex: 0 0 auto;
}

.segmented-control {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
  align-items: flex-start;
}

.segmented-control__item {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 48px;
  min-width: 88px;
  padding: 0 16px;
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
  flex: 1 1 180px;
  min-width: 176px;
  max-width: 186px;
}
.number-stepper {
  display: grid;
  grid-template-columns: 44px minmax(0, 1fr) 44px;
  align-items: stretch;
  width: 100%;
  min-height: 50px;
  overflow: hidden;
  border: 1px solid var(--line);
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.04);
}

.number-stepper:focus-within {
  border-color: var(--line-strong);
  box-shadow: 0 0 0 3px rgba(77, 212, 198, 0.12);
}

.number-stepper__control {
  display: grid;
  place-items: center;
  color: var(--muted);
  background: rgba(255, 255, 255, 0.03);
  border: 0;
  border-right: 1px solid var(--line);
  font-size: 1.05rem;
  line-height: 1;
  transition: background 160ms ease, color 160ms ease;
}

.number-stepper__control:last-child {
  border-right: 0;
  border-left: 1px solid var(--line);
}

.number-stepper__control:hover:not(:disabled) {
  color: var(--text);
  background: rgba(77, 212, 198, 0.1);
}

.number-stepper__control:disabled {
  cursor: not-allowed;
  opacity: 0.42;
}

.quantity-field .number-stepper input {
  min-width: 0;
  padding: 0 14px;
  border: 0;
  border-radius: 0;
  background: transparent;
  box-shadow: none;
  text-align: center;
}

.quantity-field .number-stepper input:focus {
  box-shadow: none;
  text-align: center;
}

.create-task-modal textarea {
  height: 124px;
  min-height: 124px;
  line-height: 1.25;
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

