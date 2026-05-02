<script setup lang="ts">
import { computed, ref, watch } from "vue";
import ActionButton from "../common/ActionButton.vue";
import PopConfirmAction from "../common/PopConfirmAction.vue";
import StatusPill from "../common/StatusPill.vue";
import TaskProgressCell from "./TaskProgressCell.vue";
import {
  describeQueueAction,
  describeTaskStatus,
  formatTaskOrigin,
  formatTaskTitle,
  isTaskDownloadComplete,
} from "../../lib/presenters";
import { clampTaskPage, paginateItems } from "../../lib/task-pagination";
import { runtimeBridge } from "../../lib/runtime-bridge";
import type { TaskItem } from "../../types/app";

const props = defineProps<{
  tasks: TaskItem[];
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

const pagination = computed(() => {
  taskRenderDependencyKey.value;
  return paginateItems(props.tasks, currentPage.value);
});

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

function getStatusDescriptor(task: TaskItem) {
  if (isNativeRuntime && nativeBackgroundPhases.has(task.lifecycle.phase)) {
    return {
      label: "后台处理中",
      tone: "warn" as const,
    };
  }

  return describeTaskStatus(task);
}

function canOpenOutputDirectory(task: TaskItem) {
  return (task.lifecycle.phase === "completed" || isTaskDownloadComplete(task)) && Boolean(task.outputDirectory);
}

function getOutputDirectoryLabel(task: TaskItem) {
  return task.outputDirectory ?? task.target.outputRootDir;
}

function getQueueActionDescriptor(task: TaskItem) {
  return describeQueueAction(task);
}

function goToPage(page: number) {
  const nextPage = clampTaskPage(page, pagination.value.totalPages);
  currentPage.value = nextPage;
  jumpPageInput.value = String(nextPage);
}

function handleJumpPageInput(event: Event) {
  const input = event.target as HTMLInputElement;
  const digitsOnly = input.value.replace(/[^\d]/g, "");
  jumpPageInput.value = digitsOnly;
  input.value = digitsOnly;
}

function submitJumpPage() {
  if (!jumpPageInput.value) {
    jumpPageInput.value = String(currentPage.value);
    return;
  }

  goToPage(Number(jumpPageInput.value));
}

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
          <th>来源</th>
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
          <td>{{ formatTaskOrigin(task) }}</td>
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
            <span class="table-text">{{ task.summary }}</span>
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
