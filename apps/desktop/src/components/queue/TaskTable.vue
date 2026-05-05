<script setup lang="ts">
// 任务队列表格：负责分页展示任务和触发单任务操作。
import { computed, ref, watch } from "vue";
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
import type { TaskItem } from "../../types/app";

const props = defineProps<{
  tasks: TaskItem[];
  queueRunning?: boolean;
}>();

const emit = defineEmits<{
  retry: [taskId: string];
  pause: [taskId: string];
  resume: [taskId: string];
  remove: [taskId: string];
  openOutput: [taskId: string];
}>();

const isNativeRuntime = runtimeBridge.isNativeRuntime();
const nativeBackgroundPhases = new Set(["resolving", "discovering", "downloading"]);
const currentPage = ref(1);
const jumpPageInput = ref("1");
const coverCache = ref<Record<string, string>>({});
const failedCoverSources = ref<Record<string, string>>({});

// 表格使用显式渲染依赖，让进度事件推进时即使任务对象引用变化较小也能刷新单元格。
const taskRenderDependencyKey = computed(() =>
  props.tasks
    .map((task) =>
      [
        task.id,
        task.title,
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

// 当前页任务的渲染 key，确保分页和进度变化时表格行稳定刷新。
const visibleTaskRenderKey = computed(() =>
  pagination.value.pageItems
    .map((task) =>
      [
        task.id,
        task.title,
        task.lifecycle.phase,
        task.summary,
        task.download?.savedCount ?? -1,
        task.download?.targetCount ?? -1,
      ].join(":"),
    )
    .join("|"),
);

watch(
  () => props.tasks,
  () => {
    currentPage.value = pagination.value.currentPage;
    jumpPageInput.value = String(pagination.value.currentPage);
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
      <tbody :key="visibleTaskRenderKey">
        <tr v-for="task in pagination.pageItems" :key="task.id">
          <td class="task-table__title">
            <div class="title-cell">
              <strong>{{ formatTaskTitle(task) }}</strong>
              <span class="table-text">{{ task.target.detailUrl }}</span>
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
                description="任务记录和本地输出目录会一起删除。"
                confirm-label="删除"
                :disabled="props.queueRunning"
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


