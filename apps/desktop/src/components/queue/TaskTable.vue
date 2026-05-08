<script setup lang="ts">
// 任务队列表格：负责分页展示任务和触发单任务操作。
import { computed, onBeforeUnmount, ref, watch } from "vue";
import ActionButton from "../common/ActionButton.vue";
import PopConfirmAction from "../common/PopConfirmAction.vue";
import StatusPill from "../common/StatusPill.vue";
import TaskProgressCell from "./TaskProgressCell.vue";
import {
  describeQueueAction,
  describeTaskStatus,
  formatTaskTitle,
  isTaskDownloadComplete,
} from "../../lib/presenters";
import { clampTaskPage, paginateItems } from "../../lib/task-pagination";
import { runtimeBridge } from "../../lib/runtime-bridge";
import { useAppStore } from "../../stores/app";
import type { TaskItem } from "../../types/app";

const props = defineProps<{
  tasks: TaskItem[];
  activeTaskIds?: string[];
}>();

const emit = defineEmits<{
  retry: [taskId: string];
  pause: [taskId: string];
  resume: [taskId: string];
  remove: [taskId: string];
  openOutput: [taskId: string];
}>();

const isNativeRuntime = runtimeBridge.isNativeRuntime();
const appStore = useAppStore();
const nativeBackgroundPhases = new Set(["resolving", "discovering", "downloading"]);
const currentPage = ref(1);
const jumpPageInput = ref("1");
const coverCache = ref<Record<string, string>>({});
const failedCoverSources = ref<Record<string, string>>({});
const copiedTaskId = ref("");
let copiedIconTimer: ReturnType<typeof setTimeout> | undefined;

function retainRecordKeys(record: Record<string, string>, keys: Set<string>) {
  let changed = false;
  const next: Record<string, string> = {};

  for (const [key, value] of Object.entries(record)) {
    if (keys.has(key)) {
      next[key] = value;
    } else {
      changed = true;
    }
  }

  return changed ? next : record;
}

onBeforeUnmount(() => {
  if (copiedIconTimer) {
    clearTimeout(copiedIconTimer);
  }
});

// 表格使用显式渲染依赖，让进度事件推进时即使任务对象引用变化较小也能刷新单元格。
const taskRenderDependencyKey = computed(() =>
  props.tasks
    .map((task) =>
      [
        task.id,
        task.title,
        task.target.doubanAssetType,
        task.lifecycle.phase,
        task.summary,
        task.download?.savedCount ?? -1,
        task.download?.targetCount ?? -1,
      ].join(":"),
    )
    .join("|"),
);

// 分页只负责当前视图切片，任务顺序由父页面传入的排序结果决定。
const pagination = computed(() => {
  taskRenderDependencyKey.value;
  return paginateItems(props.tasks, currentPage.value);
});

watch(
  () => props.tasks,
  () => {
    currentPage.value = pagination.value.currentPage;
    jumpPageInput.value = String(pagination.value.currentPage);
    const taskUrls = new Set(props.tasks.map((task) => task.target.detailUrl));
    coverCache.value = retainRecordKeys(coverCache.value, taskUrls);
    failedCoverSources.value = retainRecordKeys(failedCoverSources.value, taskUrls);
  },
  { deep: true, immediate: true },
);

watch(
  () => pagination.value.pageItems.map((task) => `${task.id}:${task.target.detailUrl}:${task.coverDataUrl ?? ""}:${task.coverUrl ?? ""}`).join("|"),
  () => {
    for (const task of pagination.value.pageItems) {
      void resolveTaskCover(task);
    }
  },
  { immediate: true },
);

function getTaskCoverSource(task: TaskItem) {
  const source = task.coverDataUrl ?? task.coverUrl ?? coverCache.value[task.target.detailUrl] ?? "";
  return failedCoverSources.value[task.target.detailUrl] === source ? "" : source;
}

async function resolveTaskCover(task: TaskItem) {
  if (getTaskCoverSource(task) || !isNativeRuntime) return;

  try {
    const preview = await runtimeBridge.resolveDoubanMoviePreview(task.target.detailUrl);
    const coverSource = preview?.coverDataUrl ?? preview?.coverUrl;
    if (!coverSource) return;
    coverCache.value = {
      ...coverCache.value,
      [task.target.detailUrl]: coverSource,
    };
  } catch {
    // 封面只影响展示，解析失败时保留占位，不影响队列任务。
  }
}

function handleCoverError(task: TaskItem) {
  const source = getTaskCoverSource(task);
  if (!source) return;

  failedCoverSources.value = {
    ...failedCoverSources.value,
    [task.target.detailUrl]: source,
  };
}
// 获取任务状态徽标；桌面后台阶段会额外展示“后台处理中”。
function getStatusDescriptor(task: TaskItem) {
  if (isNativeRuntime && nativeBackgroundPhases.has(task.lifecycle.phase)) {
    return {
      label: "后台处理中",
      tone: "warn" as const,
    };
  }

  return describeTaskStatus(task);
}

// 只有完成且已有输出目录的任务才允许点击打开目录。
function canOpenOutputDirectory(task: TaskItem) {
  return (task.lifecycle.phase === "completed" || isTaskDownloadComplete(task)) && Boolean(task.outputDirectory);
}

// 输出目录列的展示文案，未生成时显示 -。
function getOutputDirectoryLabel(task: TaskItem) {
  return task.outputDirectory ?? task.target.outputRootDir;
}

function getTaskAspectRatioLabel(task: TaskItem) {
  return task.target.imageAspectRatio === "original" ? "原图比例" : `比例${task.target.imageAspectRatio}`;
}

function getTaskResultLabel(task: TaskItem) {
  if (!/^已下载\s+\d+\/\d+\s+张图片/.test(task.summary) || /(?:比例\d+:\d+|原图比例)/.test(task.summary)) {
    return task.summary;
  }

  return `${task.summary}，${getTaskAspectRatioLabel(task)}`;
}
// 操作列根据任务生命周期动态切换暂停、继续、重试、完成等按钮状态。
// 读取当前任务操作按钮文案和动作类型。
function getQueueActionDescriptor(task: TaskItem) {
  return describeQueueAction(task);
}

// 单条删除只受当前任务自身是否仍在执行影响；其他任务下载不应挡住已暂停任务。
function isTaskDeleteDisabled(task: TaskItem) {
  return Boolean(props.activeTaskIds?.includes(task.id) && task.lifecycle.phase !== "paused");
}

// 跳转到指定页，并同步页码输入框。
function goToPage(page: number) {
  const nextPage = clampTaskPage(page, pagination.value.totalPages);
  currentPage.value = nextPage;
  jumpPageInput.value = String(nextPage);
}

// 记录用户输入的页码，只保留纯数字内容。
function handleJumpPageInput(event: Event) {
  const input = event.target as HTMLInputElement;
  const digitsOnly = input.value.replace(/[^\d]/g, "");
  jumpPageInput.value = digitsOnly;
  input.value = digitsOnly;
}

// 提交跳页输入，非法或越界页码会被 clamp 到有效范围。
function submitJumpPage() {
  if (!jumpPageInput.value) {
    jumpPageInput.value = String(currentPage.value);
    return;
  }

  goToPage(Number(jumpPageInput.value));
}

// 操作列按钮分发：根据当前动作触发暂停、继续、重试或打开目录。
function handleQueueAction(taskId: string, action: ReturnType<typeof getQueueActionDescriptor>["action"]) {
  if (action === "retry") {
    emit("retry", taskId);
    return;
  }

  if (action === "pause") {
    emit("pause", taskId);
    return;
  }

  if (action === "resume") {
    emit("resume", taskId);
  }
}

async function copyTaskDetailUrl(task: TaskItem) {
  await navigator.clipboard.writeText(task.target.detailUrl);
  copiedTaskId.value = task.id;
  appStore.showNotice("已复制链接", "success");

  if (copiedIconTimer) {
    clearTimeout(copiedIconTimer);
  }
  copiedIconTimer = setTimeout(() => {
    if (copiedTaskId.value === task.id) {
      copiedTaskId.value = "";
    }
  }, 1600);
}
</script>

<template>
  <div class="table-shell">
    <table class="task-table">
      <thead>
        <tr>
          <th>任务</th>
          <th>豆瓣封面</th>
          <th>状态</th>
          <th>下载进度</th>
          <th>输出目录</th>
          <th>结果</th>
          <th>操作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="task in pagination.pageItems" :key="task.id">
          <td class="task-table__title">
            <div class="title-cell">
              <strong>{{ formatTaskTitle(task) }}</strong>
              <span class="task-url-copy">
                <button
                  type="button"
                  class="task-url-copy__text table-text"
                  title="点击复制链接"
                  @click="void copyTaskDetailUrl(task)"
                >
                  {{ task.target.detailUrl }}
                </button>
                <button
                  type="button"
                  class="task-url-copy__button"
                  title="点击复制链接"
                  :aria-label="`复制 ${formatTaskTitle(task)} 的链接`"
                  @click="void copyTaskDetailUrl(task)"
                >
                  <svg v-if="copiedTaskId === task.id" viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M20 6 9 17l-5-5" />
                  </svg>
                  <svg v-else viewBox="0 0 24 24" aria-hidden="true">
                    <rect x="9" y="9" width="10" height="10" rx="2" />
                    <path d="M5 15V7a2 2 0 0 1 2-2h8" />
                  </svg>
                </button>
              </span>
            </div>
          </td>
          <td class="task-table__cover">
            <div class="cover-cell">
              <img v-if="getTaskCoverSource(task)" :src="getTaskCoverSource(task)" :alt="formatTaskTitle(task)" @error="handleCoverError(task)" />
              <span v-else>暂无封面</span>
            </div>
          </td>
          <td><StatusPill :label="getStatusDescriptor(task).label" :tone="getStatusDescriptor(task).tone" /></td>
          <td class="task-table__progress">
            <TaskProgressCell :task="task" />
          </td>
          <td class="task-table__output">
            <button
              v-if="canOpenOutputDirectory(task)"
              type="button"
              class="output-link table-text"
              @click="emit('openOutput', task.id)"
            >
              {{ getOutputDirectoryLabel(task) }}
            </button>
            <span v-else class="table-text">{{ getOutputDirectoryLabel(task) }}</span>
          </td>
          <td class="task-table__result">
            <span class="table-text">{{ getTaskResultLabel(task) }}</span>
          </td>
          <td class="task-table__actions">
            <div class="row-actions">
              <ActionButton
                :label="getQueueActionDescriptor(task).label"
                size="sm"
                :disabled="getQueueActionDescriptor(task).disabled"
                @click="handleQueueAction(task.id, getQueueActionDescriptor(task).action)"
              />
              <PopConfirmAction
                label="删除"
                size="sm"
                title="删除这条任务？"
                description="任务记录和图片所在目录会一起删除。"
                confirm-label="删除"
                :disabled="isTaskDeleteDisabled(task)"
                @confirm="emit('remove', task.id)"
              />
            </div>
          </td>
        </tr>
      </tbody>
    </table>
  </div>

  <div class="task-pagination">
    <ActionButton
      label="首页"
      size="sm"
      :disabled="pagination.currentPage <= 1"
      @click="goToPage(1)"
    />
    <ActionButton
      label="上一页"
      size="sm"
      :disabled="pagination.currentPage <= 1"
      @click="goToPage(pagination.currentPage - 1)"
    />
    <span class="task-pagination__status">第 {{ pagination.currentPage }} / {{ pagination.totalPages }} 页</span>
    <ActionButton
      label="下一页"
      size="sm"
      :disabled="pagination.currentPage >= pagination.totalPages"
      @click="goToPage(pagination.currentPage + 1)"
    />
    <ActionButton
      label="末页"
      size="sm"
      :disabled="pagination.currentPage >= pagination.totalPages"
      @click="goToPage(pagination.totalPages)"
    />
    <label class="task-pagination__jump">
      <span>跳至</span>
      <input
        :value="jumpPageInput"
        inputmode="numeric"
        @blur="submitJumpPage"
        @input="handleJumpPageInput"
        @keydown.enter="submitJumpPage"
      />
      <span>页</span>
    </label>
  </div>
</template>

<style scoped>
.output-link {
  padding: 0;
  border: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  text-decoration: underline;
  cursor: pointer;
}

.cover-cell {
  width: 62px;
  height: 88px;
  display: grid;
  place-items: center;
  overflow: hidden;
  border-radius: 8px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  background: rgba(255, 255, 255, 0.04);
  color: var(--muted);
  font-size: 0.76rem;
  text-align: center;
}

.cover-cell img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.task-table__cover {
  width: 96px;
  min-width: 96px;
}
.table-text {
  display: block;
  word-break: break-all;
  white-space: normal;
}

.task-url-copy {
  display: inline-flex;
  align-items: flex-start;
  gap: 6px;
  max-width: 100%;
}

.task-url-copy__text {
  margin: 0;
  padding: 1px 4px 2px;
  border-radius: 6px;
  background: transparent;
  color: var(--muted);
  text-align: left;
  text-decoration: underline;
  text-decoration-color: rgba(141, 164, 160, 0.42);
  text-underline-offset: 3px;
  cursor: pointer;
  transition:
    color 160ms ease,
    background-color 160ms ease,
    text-decoration-color 160ms ease;
}

.task-url-copy__text:hover,
.task-url-copy__text:focus-visible {
  background: rgba(77, 212, 198, 0.08);
  color: var(--text);
  text-decoration-color: rgba(77, 212, 198, 0.72);
  outline: none;
}

.task-url-copy__button {
  flex: 0 0 auto;
  width: 22px;
  height: 22px;
  display: inline-grid;
  place-items: center;
  padding: 0;
  border-radius: 7px;
  background: rgba(255, 255, 255, 0.04);
  color: var(--muted);
  cursor: pointer;
  transition:
    color 160ms ease,
    background-color 160ms ease;
}

.task-url-copy__button:hover,
.task-url-copy__button:focus-visible {
  background: rgba(77, 212, 198, 0.12);
  color: var(--text);
  outline: none;
}

.task-url-copy__button svg {
  width: 15px;
  height: 15px;
  fill: none;
  stroke: currentColor;
  stroke-width: 2;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.task-pagination {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  flex-wrap: wrap;
  margin-top: 14px;
}

.task-pagination__status {
  min-width: 96px;
  padding: 10px 14px;
  border-radius: 12px;
  border: 1px solid var(--line);
  background: rgba(255, 255, 255, 0.04);
  color: var(--text);
  text-align: center;
}

.task-pagination__jump {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  color: var(--muted);
}

.task-pagination__jump input {
  width: 72px;
  padding: 10px 12px;
  border-radius: 12px;
  border: 1px solid var(--line);
  background: rgba(255, 255, 255, 0.04);
  color: var(--text);
  text-align: center;
  outline: none;
}

.task-pagination__jump input:focus {
  border-color: var(--line-strong);
  box-shadow: 0 0 0 3px rgba(77, 212, 198, 0.12);
}
</style>


