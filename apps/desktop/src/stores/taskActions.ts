// 任务执行动作：处理任务的创建、重试、暂停、恢复、删除等操作。
import { createTaskFromDraft } from "../data/mock";
import { runTaskLifecycle } from "../lib/queue-runtime";
import { runtimeBridge } from "../lib/runtime-bridge";
import { inferTaskSource } from "./app-helpers";
import { classifyDoubanFailure, resolveFailureTaskTitle } from "../composables/useDoubanFailureClassifier";
import { getTaskGeneratedOutputDirectory } from "../composables/useTaskOutputDirectory";
import { useTaskQueue } from "./taskQueue";
import { useCookies } from "./cookies";
import { useLogs } from "./logs";
import type { TaskDraft, TaskItem } from "../types/app";

interface CreateTasksOptions {
  replacementTaskIds?: string[];
}

// store 内部等待工具，用于队列冷却等异步等待场景。
const wait = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));

// 浏览器预览模式下执行模拟任务生命周期，不触碰本地文件系统。
export async function runBrowserTask(task: TaskItem) {
  const taskQueueStore = useTaskQueue();
  const cookiesStore = useCookies();

  for await (const frame of runTaskLifecycle(task, cookiesStore.cookies, taskQueueStore.queueConfig)) {
    taskQueueStore.replaceTask(frame.task);
    cookiesStore.applyCookieMutations(frame.cookieMutations);

    if (!taskQueueStore.queueRunning) {
      break;
    }
  }
}

// 桌面端真实任务由 Tauri 拉起 sidecar；前端只负责传入任务参数并接收最终结果。
export async function runNativeTask(task: TaskItem) {
  const taskQueueStore = useTaskQueue();
  const cookiesStore = useCookies();
  const logsStore = useLogs();

  const attempts = task.lifecycle.attempts + 1;
  const cookie = cookiesStore.pickUsableCookie();

  // 原生桌面端统一走 Tauri + sidecar 真实抓取链路，浏览器模式才退回演示态。
  taskQueueStore.replaceTask({
    ...task,
    lifecycle: {
      phase: "resolving",
      attempts,
      updatedAt: new Date().toISOString(),
      cooldownUntil: undefined,
      lastError: undefined,
    },
    summary: "正在解析详情页与图片页",
  });

  try {
    const basePayload = {
      taskId: task.id,
      detailUrl: task.target.detailUrl,
      outputRootDir: task.target.outputRootDir,
      sourceHint: task.target.sourceHint,
      doubanAssetType: task.target.doubanAssetType,
      imageCountMode: task.target.imageCountMode,
      maxImages: task.target.maxImages,
      outputImageFormat: task.target.outputImageFormat,
      imageAspectRatio: task.target.imageAspectRatio,
      requestIntervalSeconds: task.target.requestIntervalSeconds,
      doubanCookie: cookie?.value,
    };
    const result = task.target.selectedImages?.length
      ? await runtimeBridge.runSelectedPhotoDownload({
          ...basePayload,
          selectedImages: task.target.selectedImages,
          selectedPhotoTitle: task.target.selectedPhotoTitle,
        })
      : await runtimeBridge.runDownloadTask(basePayload);

    const latestTask = taskQueueStore.getTaskById(task.id);
    if (!latestTask) {
      return;
    }

    taskQueueStore.replaceTask(taskQueueStore.buildCompletedTask(latestTask, result, attempts));
    taskQueueStore.progressTick += 1;

    if (cookie && result.discovery.source === "douban") {
      cookiesStore.updateCookieStatus(cookie.id, {
        status: "active",
        successDelta: 1,
      });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const latestTask = taskQueueStore.getTaskById(task.id);

    if (
      message.toLowerCase().includes("task paused by user") ||
      message.toLowerCase().includes("task cancelled by user")
    ) {
      return;
    }

    if (!latestTask) {
      return;
    }

    const isDoubanTask = inferTaskSource(latestTask) === "douban";
    const failure = isDoubanTask
      ? classifyDoubanFailure(message, latestTask)
      : {
          kind: "generic" as const,
          cooldown: false,
          userMessage: message,
        };
    const cooldownUntil = new Date(Date.now() + taskQueueStore.queueConfig.failureCooldownMs).toISOString();

    taskQueueStore.replaceTask({
      ...latestTask,
      title: resolveFailureTaskTitle(message, latestTask),
      lifecycle: {
        phase: "failed",
        attempts,
        updatedAt: new Date().toISOString(),
        cooldownUntil:
          failure.cooldown && attempts < taskQueueStore.queueConfig.maxAttempts ? cooldownUntil : undefined,
        lastError: message,
      },
      summary: failure.userMessage,
    });
    taskQueueStore.progressTick += 1;

    if (cookie && isDoubanTask) {
      cookiesStore.updateCookieStatus(cookie.id, {
        status: failure.cooldown && attempts < taskQueueStore.queueConfig.maxAttempts ? "cooling" : "active",
        failureDelta: failure.cooldown ? 1 : 0,
        coolingUntil:
          failure.cooldown && attempts < taskQueueStore.queueConfig.maxAttempts ? cooldownUntil : undefined,
      });
    }

    await logsStore.emitLog("ERROR", "queue", `任务失败: ${message}`, task.id);
  }
}

// 处理单个任务：登记 activeTaskIds，并按运行环境选择真实下载或浏览器模拟。
export async function processTask(task: TaskItem) {
  const taskQueueStore = useTaskQueue();

  taskQueueStore.activeTaskIds = [...taskQueueStore.activeTaskIds, task.id];
  try {
    if (runtimeBridge.isNativeRuntime()) {
      await runNativeTask(task);
      return;
    }

    await runBrowserTask(task);
  } finally {
    taskQueueStore.activeTaskIds = taskQueueStore.activeTaskIds.filter((item) => item !== task.id);
  }
}

// 队列排水循环会持续拉取可运行批次，直到无任务、冷却等待或用户停止队列。
export async function drainQueue() {
  const taskQueueStore = useTaskQueue();
  const logsStore = useLogs();

  if (taskQueueStore.queueBusy) return;
  taskQueueStore.queueBusy = true;

  try {
    while (taskQueueStore.queueRunning) {
      const promoted = taskQueueStore.promoteCooledTasks();
      if (promoted > 0) {
        await logsStore.emitLog("INFO", "queue", `失败冷却结束: ${promoted} 个任务恢复可重试状态`);
      }

      const batch = taskQueueStore.nextRunnableBatch();
      if (batch.length === 0) {
        const cooldownDelay = taskQueueStore.nextCooldownDelay();
        if (cooldownDelay !== null) {
          await wait(Math.min(cooldownDelay, 1000));
          continue;
        }
        break;
      }

      const inFlight = new Set<Promise<void>>();
      for (const task of batch) {
        const latestTask = taskQueueStore.getTaskById(task.id);
        if (!latestTask || taskQueueStore.activeTaskIdSet.has(latestTask.id)) {
          continue;
        }

        const runner = processTask(latestTask).finally(() => {
          inFlight.delete(runner);
        });
        inFlight.add(runner);

        if (inFlight.size >= taskQueueStore.queueConfig.concurrency) {
          await Promise.race(inFlight);
        }
      }

      await Promise.all(inFlight);
    }
  } finally {
    taskQueueStore.queueBusy = false;
    taskQueueStore.activeTaskIds = [];

    if (taskQueueStore.queueRunning && !taskQueueStore.hasRemainingQueueWork()) {
      taskQueueStore.queueRunning = false;
    }
  }
}

// 批量创建链接任务，写日志、关闭弹窗，并自动启动队列。
export async function createTasks(
  drafts: TaskDraft[],
  moviePreviews: Record<string, any>,
  options: CreateTasksOptions = {},
) {
  const taskQueueStore = useTaskQueue();
  const logsStore = useLogs();

  const replacementTaskIds = new Set(options.replacementTaskIds ?? []);
  const replacementTasks = taskQueueStore.tasks.filter((task) => replacementTaskIds.has(task.id));
  const replacementOutputDirectories = replacementTasks.flatMap((task) => {
    const outputDirectory = getTaskGeneratedOutputDirectory(task);
    return outputDirectory ? [outputDirectory] : [];
  });

  const createdTasks = drafts.map((draft) => {
    const preview = moviePreviews[draft.detailUrl];
    return createTaskFromDraft(taskQueueStore.nextTaskId(), {
      ...draft,
      coverUrl: draft.coverUrl ?? preview?.coverUrl,
      coverDataUrl: draft.coverDataUrl ?? preview?.coverDataUrl,
    });
  });

  const hasSelectedPhotoTasks = drafts.some((draft) => draft.selectedImages?.length);

  if (replacementTaskIds.size > 0) {
    await runtimeBridge.clearDownloadTasks(Array.from(replacementTaskIds));
    for (const outputDirectory of replacementOutputDirectories) {
      await runtimeBridge.clearDirectoryContents(outputDirectory.directoryPath, outputDirectory.rootDirectoryPath);
    }
    taskQueueStore.activeTaskIds = taskQueueStore.activeTaskIds.filter((taskId) => !replacementTaskIds.has(taskId));
  }

  taskQueueStore.tasks = [...taskQueueStore.tasks.filter((task) => !replacementTaskIds.has(task.id)), ...createdTasks];

  await logsStore.emitLog(
    replacementTaskIds.size > 0 ? "WARN" : "INFO",
    "command",
    replacementTaskIds.size > 0
      ? `已覆盖重复任务 ${replacementTaskIds.size} 个，并新增链接任务 ${createdTasks.length} 个 -> ${drafts[0]?.outputRootDir ?? ""}`
      : `${hasSelectedPhotoTasks ? "新增选图下载任务" : "新增链接任务"} ${createdTasks.length} 个 -> ${drafts[0]?.outputRootDir ?? ""} / 并发 ${taskQueueStore.queueConfig.concurrency}`,
  );

  taskQueueStore.queueRunning = true;
  void drainQueue();

  return {
    createdCount: createdTasks.length,
    replacedCount: replacementTaskIds.size,
    hasSelectedPhotoTasks,
  };
}

// 手动重试失败任务：重置任务状态并重新启动队列循环。
export async function retryTask(taskId: string) {
  const taskQueueStore = useTaskQueue();
  const logsStore = useLogs();

  const task = taskQueueStore.getTaskById(taskId);
  if (!task) return;

  taskQueueStore.replaceTask(taskQueueStore.resetTask(task));
  taskQueueStore.queueRunning = true;
  await logsStore.emitLog("INFO", "queue", `任务已手动重试: ${task.target.detailUrl}`, taskId);
  void drainQueue();
}

// 请求暂停任务：先把界面切到 pausing，再通知 Tauri/sidecar 暂停。
export async function pauseTask(taskId: string) {
  const taskQueueStore = useTaskQueue();
  const logsStore = useLogs();

  const task = taskQueueStore.getTaskById(taskId);
  if (!task) return;

  taskQueueStore.replaceTask({
    ...task,
    lifecycle: {
      ...task.lifecycle,
      phase: "pausing",
      updatedAt: new Date().toISOString(),
    },
    summary: "任务正在暂停",
  });

  await runtimeBridge.pauseDownloadTask(taskId);

  const latestTask = taskQueueStore.getTaskById(taskId) ?? task;
  taskQueueStore.replaceTask({
    ...latestTask,
    lifecycle: {
      ...latestTask.lifecycle,
      phase: "paused",
      updatedAt: new Date().toISOString(),
    },
    summary: "任务已暂停",
  });

  await logsStore.emitLog("WARN", "queue", `任务已暂停: ${task.target.detailUrl}`, taskId);
}

// 继续暂停任务：通知 Tauri 清除暂停状态，并把任务放回 retrying。
export async function resumeTask(taskId: string) {
  const taskQueueStore = useTaskQueue();
  const logsStore = useLogs();

  const task = taskQueueStore.getTaskById(taskId);
  if (!task || task.lifecycle.phase !== "paused") return;

  await runtimeBridge.resumeDownloadTask(taskId);

  taskQueueStore.replaceTask({
    ...task,
    lifecycle: {
      ...task.lifecycle,
      phase: "retrying",
      updatedAt: new Date().toISOString(),
    },
    summary: "任务继续中",
  });

  taskQueueStore.queueRunning = true;
  await logsStore.emitLog("INFO", "queue", `任务已继续: ${task.target.detailUrl}`, taskId);
  void drainQueue();
}

// 删除单个任务，同时取消后台进程并删除该任务生成的输出目录。
export async function deleteTask(taskId: string) {
  const taskQueueStore = useTaskQueue();
  const logsStore = useLogs();

  const task = taskQueueStore.getTaskById(taskId);
  if (!task) return;

  const outputDirectory = getTaskGeneratedOutputDirectory(task);

  if (runtimeBridge.isNativeRuntime()) {
    await runtimeBridge.clearDownloadTasks([taskId]);
    if (outputDirectory) {
      await runtimeBridge.deleteDirectoryPath(outputDirectory.directoryPath, outputDirectory.rootDirectoryPath);
    }
  }

  taskQueueStore.tasks = taskQueueStore.tasks.filter((item) => item.id !== taskId);
  taskQueueStore.activeTaskIds = taskQueueStore.activeTaskIds.filter((item) => item !== taskId);
  taskQueueStore.progressTick += 1;

  await logsStore.emitLog(
    "WARN",
    "queue",
    outputDirectory
      ? `任务已删除并清理输出目录: ${outputDirectory.directoryPath}`
      : `任务已删除: ${task.target.detailUrl}`,
    taskId,
  );
}

// 清空队列时移除记录、取消后台任务，并清空这些任务所属输出根目录下的所有内容。
export async function clearQueueTasks() {
  const taskQueueStore = useTaskQueue();
  const logsStore = useLogs();

  if (taskQueueStore.tasks.length === 0) {
    return { count: 0 };
  }

  const count = taskQueueStore.tasks.length;
  const taskIds = taskQueueStore.tasks.map((task) => task.id);
  const outputRootDirectories = Array.from(
    new Set(taskQueueStore.tasks.map((task) => task.target.outputRootDir.trim()).filter(Boolean)),
  );
  taskQueueStore.queueRunning = false;

  if (runtimeBridge.isNativeRuntime() && taskIds.length > 0) {
    await runtimeBridge.clearDownloadTasks(taskIds);
    for (const outputRootDir of outputRootDirectories) {
      await runtimeBridge.clearDirectoryContents(outputRootDir, outputRootDir);
    }
  }

  taskQueueStore.activeTaskIds = [];
  taskQueueStore.tasks = [];
  taskQueueStore.progressTick += 1;

  await logsStore.emitLog("WARN", "queue", `队列任务已清空: ${count} 个，输出目录内容已清理: ${outputRootDirectories.join(", ")}`);

  return { count };
}

// 打开已完成任务的输出目录，未完成或无目录时忽略。
export async function openTaskOutputDirectory(taskId: string) {
  const taskQueueStore = useTaskQueue();
  const logsStore = useLogs();

  const task = taskQueueStore.getTaskById(taskId);
  if (!task?.outputDirectory || task.lifecycle.phase !== "completed") {
    return;
  }

  await runtimeBridge.openDirectoryPath(task.outputDirectory);
  await logsStore.emitLog("INFO", "shell", `请求打开任务输出目录 ${task.outputDirectory}`, taskId);
}
