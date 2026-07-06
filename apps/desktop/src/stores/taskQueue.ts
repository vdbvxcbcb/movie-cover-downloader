// 任务队列管理 store：处理任务生命周期、队列执行、任务 CRUD。
import { computed, ref, shallowRef } from "vue";
import { defineStore } from "pinia";
import { compareTaskAddedOrder } from "../lib/task-order";
import {
  extractDiscoveredDownloadSnapshotFromLogMessage,
  extractResolvedTitleFromLogMessage,
  extractSavedImagePathFromLogMessage,
  fileNameFromPath,
  inferTaskSource,
  timestampNow,
} from "./app-helpers";
import {
  isSameTaskTarget,
  buildTaskTargetKey,
  buildDraftTargetKey,
} from "../composables/useTaskComparison";
import { directoryFromFilePath } from "../composables/useTaskOutputDirectory";
import type {
  QueueConfig,
  RuntimeDownloadTaskResult,
  RuntimeTaskProgressEvent,
  TaskDraft,
  TaskItem,
  AppSeedState,
} from "../types/app";

// 队列阶段集合按行为能力分组：能运行、能恢复、能暂停、以及进度不应再被覆盖的终态。
const runnablePhases = new Set(["queued", "retrying"]);
const terminalProgressPhases = new Set(["completed", "failed", "paused"]);

export const useTaskQueue = defineStore("taskQueue", () => {
  const queueRunning = shallowRef(false);
  const queueBusy = shallowRef(false);
  const progressTick = shallowRef(0);
  const tasks = ref<TaskItem[]>([]);
  const queueConfig = ref<QueueConfig>({
    concurrency: 1,
    batchSize: 1,
    maxAttempts: 3,
    failureCooldownMs: 300000,
  });
  const activeTaskIds = ref<string[]>([]);
  const queueSortOrder = ref<"desc" | "asc">("desc");
  const queueSearchQuery = ref("");

  let taskIdSequence = 0;

  const taskLookup = computed(() => {
    const byId = new Map<string, TaskItem>();
    const indexById = new Map<string, number>();
    tasks.value.forEach((task, index) => {
      byId.set(task.id, task);
      indexById.set(task.id, index);
    });
    return { byId, indexById };
  });

  const activeTaskIdSet = computed(() => new Set(activeTaskIds.value));
  const orderedTasks = computed(() => [...tasks.value].sort(compareTaskAddedOrder));

  const queueHasActiveDownloads = computed(() =>
    activeTaskIds.value.some((taskId) => {
      const task = getTaskById(taskId);
      return task ? task.lifecycle.phase !== "paused" : false;
    }),
  );

  // 用不可变数组替换单个任务，确保 Vue 能可靠触发列表更新。
  function replaceTaskAtIndex(taskIndex: number, nextTask: TaskItem) {
    tasks.value = tasks.value.map((task, index) => (index === taskIndex ? nextTask : task));
  }

  // 生成新的任务 id，同时扫描已有任务避免重启后 id 冲突。
  function nextTaskId() {
    taskIdSequence += 1;
    return `task-${Date.now()}-${taskIdSequence}`;
  }

  // 按 taskId 替换任务，供浏览器演示流程和真实下载流程复用。
  function replaceTask(nextTask: TaskItem) {
    const index = taskLookup.value.indexById.get(nextTask.id);
    if (index === undefined) return;
    replaceTaskAtIndex(index, nextTask);
  }

  // 根据 id 查找当前最新任务快照，避免异步流程使用过期对象。
  function getTaskById(taskId: string) {
    return taskLookup.value.byId.get(taskId);
  }

  function findDuplicateTasksForDrafts(drafts: TaskDraft[]) {
    const tasksByTarget = new Map<string, TaskItem[]>();
    const duplicateTaskIds = new Set<string>();
    const duplicateTasks: TaskItem[] = [];

    for (const task of tasks.value) {
      const key = buildTaskTargetKey(task);
      const bucket = tasksByTarget.get(key);
      if (bucket) {
        bucket.push(task);
      } else {
        tasksByTarget.set(key, [task]);
      }
    }

    for (const draft of drafts) {
      for (const task of tasksByTarget.get(buildDraftTargetKey(draft)) ?? []) {
        if (!isSameTaskTarget(task, draft) || duplicateTaskIds.has(task.id)) continue;

        duplicateTaskIds.add(task.id);
        duplicateTasks.push(task);
      }
    }

    return duplicateTasks;
  }

  // 根据 sidecar 最终结果构造完成态任务，写入输出目录、文件列表和进度终值。
  function buildCompletedTask(task: TaskItem, result: RuntimeDownloadTaskResult, attempts: number): TaskItem {
    let posterCount = 0;
    let stillCount = 0;
    let verticalCount = 0;
    let horizontalCount = 0;
    const discovered = result.discovery.images.map((image) => ({
      ...image,
      extension: image.imageUrl.match(/\.[a-z0-9]+(?:$|\?)/i)?.[0]?.replace(/\?.*$/, ""),
    }));
    for (const image of discovered) {
      if (image.category === "poster") posterCount += 1;
      if (image.category === "still") stillCount += 1;
      if (image.orientation === "vertical") verticalCount += 1;
      if (image.orientation === "horizontal") horizontalCount += 1;
    }

    return {
      ...task,
      title: task.target.selectedImages?.length
        ? `${task.target.selectedPhotoTitle || result.discovery.normalizedTitle} 选图下载`
        : result.discovery.normalizedTitle,
      lifecycle: {
        phase: "completed",
        attempts,
        updatedAt: timestampNow(),
      },
      detection: {
        site: result.discovery.source,
        confidence: 93,
        reason: "已从详情页自动推导到豆瓣 all_photos 图片页",
        detailUrl: result.discovery.detailUrl,
        imagePageUrl: result.discovery.imagePageUrl,
      },
      discovery: {
        discovered,
        posterCount,
        stillCount,
        verticalCount,
        horizontalCount,
      },
      download: {
        savedCount: result.download.saved.length,
        targetCount: result.discovery.images.length,
        directory: result.download.outputDir,
        files: result.download.saved.map((file) => fileNameFromPath(file.outputPath)),
      },
      outputFolderName: result.discovery.outputFolderName,
      outputDirectory: result.download.outputDir,
      summary: `已下载 ${result.download.saved.length}/${result.discovery.images.length} 张图片`,
    };
  }

  // 重试前清空发现/下载快照和错误信息，让任务重新进入 queued。
  function resetTask(task: TaskItem): TaskItem {
    return {
      ...task,
      lifecycle: {
        phase: "retrying",
        attempts: 0,
        updatedAt: timestampNow(),
        cooldownUntil: undefined,
        lastError: undefined,
      },
      detection: undefined,
      discovery: undefined,
      download: undefined,
      summary: "任务已重新排队，等待重新解析详情页",
    };
  }

  // 判断失败任务是否仍在冷却时间内，冷却未结束前不重新执行。
  function isCooling(task: TaskItem) {
    if (!task.lifecycle.cooldownUntil) return false;
    return new Date(task.lifecycle.cooldownUntil).getTime() > Date.now();
  }

  // 找出最近一个冷却任务还需要等待多久，队列循环会短暂 sleep 后再检查。
  function nextCooldownDelay() {
    const waiting = tasks.value
      .filter(
        (task) =>
          task.lifecycle.phase === "failed" &&
          task.lifecycle.cooldownUntil &&
          task.lifecycle.attempts < queueConfig.value.maxAttempts,
      )
      .map((task) => new Date(task.lifecycle.cooldownUntil!).getTime() - Date.now())
      .filter((value) => value > 0)
      .sort((a, b) => a - b);

    return waiting[0] ?? null;
  }

  // 判断当前是否已有豆瓣任务运行，避免多个豆瓣任务并行触发更高风控风险。
  function hasActiveDoubanTask(excludeTaskId?: string) {
    return activeTaskIds.value.some((taskId) => {
      if (taskId === excludeTaskId) return false;
      const task = getTaskById(taskId);
      return task ? inferTaskSource(task) === "douban" : false;
    });
  }

  // 判断队列是否还有可运行或可重试任务，决定本轮队列是否结束。
  function hasRemainingQueueWork() {
    return tasks.value.some((task) => {
      if (runnablePhases.has(task.lifecycle.phase)) return true;
      if (task.lifecycle.phase === "failed" && task.lifecycle.attempts < queueConfig.value.maxAttempts) return true;
      return false;
    });
  }

  // 将冷却结束且仍有重试次数的失败任务恢复为 retrying。
  function promoteCooledTasks() {
    let promoted = 0;
    tasks.value = tasks.value.map((task) => {
      if (task.lifecycle.phase !== "failed") return task;
      if (!task.lifecycle.cooldownUntil) return task;
      if (task.lifecycle.attempts >= queueConfig.value.maxAttempts) return task;
      if (new Date(task.lifecycle.cooldownUntil).getTime() > Date.now()) return task;

      promoted += 1;
      return {
        ...task,
        lifecycle: {
          ...task.lifecycle,
          phase: "retrying",
          updatedAt: timestampNow(),
          cooldownUntil: undefined,
        },
        summary: "冷却结束，已重新加入队列",
      };
    });

    return promoted;
  }

  // 后台执行顺序独立于界面排序：这里按添加时间正序挑选任务，保证旧任务先处理。
  function nextRunnableBatch() {
    const batch: TaskItem[] = [];
    let batchHasDouban = false;

    const activeIds = activeTaskIdSet.value;
    for (const task of orderedTasks.value) {
      if (batch.length >= queueConfig.value.batchSize) {
        break;
      }

      if (!runnablePhases.has(task.lifecycle.phase)) continue;
      if (activeIds.has(task.id)) continue;
      if (isCooling(task)) continue;

      const isDoubanTask = inferTaskSource(task) === "douban";
      if (isDoubanTask && (batchHasDouban || hasActiveDoubanTask(task.id))) {
        continue;
      }

      batch.push(task);
      if (isDoubanTask) {
        batchHasDouban = true;
      }
    }

    return batch;
  }

  // 初始化时加载任务列表。
  function setTasks(newTasks: TaskItem[]) {
    tasks.value = newTasks;
  }

  // 设置队列配置。
  function setQueueConfig(config: QueueConfig) {
    queueConfig.value = config;
  }

  // 进度事件是下载实时更新的主路径：每保存一张图片都会推进 savedCount 和进度条。
  function applyTaskProgressUpdate(event: RuntimeTaskProgressEvent) {
    const taskIndex = taskLookup.value.indexById.get(event.taskId);
    if (taskIndex === undefined) {
      return false;
    }

    const currentTask = tasks.value[taskIndex]!;
    if (terminalProgressPhases.has(currentTask.lifecycle.phase)) {
      return false;
    }

    const currentDownload = currentTask.download;
    const nextSavedCount = Math.min(event.savedCount, event.targetCount);
    const nextTask: TaskItem = {
      ...currentTask,
      download: {
        savedCount: nextSavedCount,
        targetCount: event.targetCount,
        directory: currentDownload?.directory ?? currentTask.outputDirectory ?? currentTask.target.outputRootDir,
        files: currentDownload?.files ?? [],
      },
      lifecycle: {
        ...currentTask.lifecycle,
        phase: event.phase,
      },
      summary:
        nextSavedCount > 0
          ? `已下载 ${nextSavedCount}/${event.targetCount} 张图片`
          : `已发现 ${event.targetCount} 张图片，开始下载`,
    };

    replaceTaskAtIndex(taskIndex, nextTask);
    progressTick.value += 1;
    return true;
  }

  // sidecar 会把实时进度同时写成隐藏日志；这里把它还原成进度事件，补齐事件监听可能错过的情况。
  function extractTaskProgressFromRuntimeLog(entry: AppSeedState["logs"][number]) {
    if (entry.scope !== "task-progress" || !entry.taskId) {
      return null;
    }

    try {
      const parsed = JSON.parse(entry.message) as Partial<RuntimeTaskProgressEvent>;
      if (typeof parsed.targetCount !== "number" || typeof parsed.savedCount !== "number") {
        return null;
      }

      return {
        taskId: entry.taskId,
        phase: typeof parsed.phase === "string" ? parsed.phase : "downloading",
        targetCount: parsed.targetCount,
        savedCount: parsed.savedCount,
        timestamp: entry.timestamp,
      } satisfies RuntimeTaskProgressEvent;
    } catch {
      return null;
    }
  }

  // 日志解析是实时进度的兜底路径：解析片名、发现数量和 saved image 日志都能反推任务状态。
  function applyRuntimeLogTaskUpdate(entry: AppSeedState["logs"][number]) {
    if (!entry.taskId) {
      return false;
    }

    const taskProgress = extractTaskProgressFromRuntimeLog(entry);
    if (taskProgress) {
      return applyTaskProgressUpdate(taskProgress);
    }

    const taskIndex = taskLookup.value.indexById.get(entry.taskId);
    if (taskIndex === undefined) {
      return false;
    }

    const currentTask = tasks.value[taskIndex]!;
    let nextTask = currentTask;
    let changed = false;

    const resolvedTitle = extractResolvedTitleFromLogMessage(entry.message);
    if (resolvedTitle && resolvedTitle !== nextTask.title) {
      nextTask = {
        ...nextTask,
        title: resolvedTitle,
      };
      changed = true;
    }

    const discoveredDownload = extractDiscoveredDownloadSnapshotFromLogMessage(entry.message);
    if (discoveredDownload && !terminalProgressPhases.has(nextTask.lifecycle.phase)) {
      const nextSavedCount = Math.min(nextTask.download?.savedCount ?? 0, discoveredDownload.targetCount);
      const nextDirectory =
        nextTask.download?.directory ??
        discoveredDownload.outputDirectory ??
        nextTask.outputDirectory ??
        nextTask.target.outputRootDir;

      nextTask = {
        ...nextTask,
        lifecycle: {
          ...nextTask.lifecycle,
          phase: "downloading",
        },
        download: {
          savedCount: nextSavedCount,
          targetCount: discoveredDownload.targetCount,
          directory: nextDirectory,
          files: nextTask.download?.files ?? [],
        },
        outputDirectory: nextTask.outputDirectory ?? discoveredDownload.outputDirectory ?? undefined,
        summary:
          nextSavedCount > 0
            ? `已下载 ${nextSavedCount}/${discoveredDownload.targetCount} 张图片`
            : `已发现 ${discoveredDownload.targetCount} 张图片，开始下载`,
      };
      changed = true;
    }

    const savedImagePath = extractSavedImagePathFromLogMessage(entry.message);
    if (savedImagePath && !terminalProgressPhases.has(nextTask.lifecycle.phase)) {
      const targetCount = nextTask.download?.targetCount ?? 0;
      const nextSavedCount = targetCount > 0
        ? Math.min((nextTask.download?.savedCount ?? 0) + 1, targetCount)
        : (nextTask.download?.savedCount ?? 0) + 1;
      const outputDirectory =
        nextTask.download?.directory ??
        directoryFromFilePath(savedImagePath) ??
        nextTask.outputDirectory ??
        nextTask.target.outputRootDir;
      const fileName = fileNameFromPath(savedImagePath);
      const nextFiles =
        nextTask.download?.files?.includes(fileName)
          ? (nextTask.download?.files ?? [])
          : [...(nextTask.download?.files ?? []), fileName];

      nextTask = {
        ...nextTask,
        lifecycle: {
          ...nextTask.lifecycle,
          phase: "downloading",
        },
        download: {
          savedCount: nextSavedCount,
          targetCount,
          directory: outputDirectory,
          files: nextFiles,
        },
        outputDirectory: nextTask.outputDirectory ?? outputDirectory,
        summary:
          targetCount > 0
            ? `已下载 ${nextSavedCount}/${targetCount} 张图片`
            : "正在下载图片",
      };
      changed = true;
    }

    if (!changed) {
      return false;
    }

    replaceTaskAtIndex(taskIndex, nextTask);
    return true;
  }

  // 批量处理日志带来的任务状态变化。
  function applyRuntimeLogTaskUpdates(entries: AppSeedState["logs"]) {
    let changed = false;

    for (const entry of entries) {
      if (applyRuntimeLogTaskUpdate(entry)) {
        changed = true;
      }
    }

    return changed;
  }

  return {
    queueRunning,
    queueBusy,
    progressTick,
    tasks,
    queueConfig,
    activeTaskIds,
    queueSortOrder,
    queueSearchQuery,
    taskLookup,
    activeTaskIdSet,
    orderedTasks,
    queueHasActiveDownloads,
    replaceTaskAtIndex,
    nextTaskId,
    replaceTask,
    getTaskById,
    findDuplicateTasksForDrafts,
    buildCompletedTask,
    resetTask,
    isCooling,
    nextCooldownDelay,
    hasActiveDoubanTask,
    hasRemainingQueueWork,
    promoteCooledTasks,
    nextRunnableBatch,
    setTasks,
    setQueueConfig,
    applyTaskProgressUpdate,
    applyRuntimeLogTaskUpdate,
    applyRuntimeLogTaskUpdates,
  };
});
