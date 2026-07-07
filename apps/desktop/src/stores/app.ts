// Pinia 核心状态仓库：协调子 store，处理应用启动和持久化。
import { computed, nextTick, shallowRef } from "vue";
import { defineStore } from "pinia";
import { createInitialAppSeed } from "../data/mock";
import { runtimeBridge } from "../lib/runtime-bridge";
import { rehydrateTasks, toSnapshot, buildPersistErrorNotice } from "./app-helpers";
import { useTaskQueue } from "./taskQueue";
import { useCookies } from "./cookies";
import { useLogs } from "./logs";
import { useUI } from "./ui";
import {
  createTasks as createTasksAction,
  retryTask as retryTaskAction,
  pauseTask as pauseTaskAction,
  resumeTask as resumeTaskAction,
  deleteTask as deleteTaskAction,
  clearQueueTasks as clearQueueTasksAction,
  openTaskOutputDirectory as openTaskOutputDirectoryAction,
} from "./taskActions";
import type { CookieDraft, DoubanMoviePreview, TaskDraft } from "../types/app";

type PersistReason = "state" | "logs" | "progress";

interface CreateTasksOptions {
  replacementTaskIds?: string[];
}

// 主应用 store 保持精简，只负责协调其他 store 和持久化。
export const useAppStore = defineStore("app", () => {
  const taskQueueStore = useTaskQueue();
  const cookiesStore = useCookies();
  const logsStore = useLogs();
  const uiStore = useUI();

  const hydrated = shallowRef(false);
  const bootstrapping = shallowRef(false);

  let persistenceTimer: number | null = null;
  let logPersistenceTimer: number | null = null;
  let persistInFlight: Promise<void> | null = null;
  let persistRerunRequested = false;

  // 清理待执行的状态/日志保存定时器，避免持久化重入时重复触发。
  function clearPersistTimers() {
    if (persistenceTimer !== null) {
      window.clearTimeout(persistenceTimer);
      persistenceTimer = null;
    }

    if (logPersistenceTimer !== null) {
      window.clearTimeout(logPersistenceTimer);
      logPersistenceTimer = null;
    }
  }

  // 持久化串行执行：如果保存过程中又有新状态，当前保存结束后立即补跑一次。
  async function persistState() {
    if (!hydrated.value) return;

    if (persistInFlight) {
      persistRerunRequested = true;
      await persistInFlight;
      return;
    }

    persistInFlight = (async () => {
      do {
        persistRerunRequested = false;
        clearPersistTimers();
        try {
          await runtimeBridge.saveState(
            toSnapshot(
              taskQueueStore.tasks,
              cookiesStore.cookies,
              logsStore.logs,
              taskQueueStore.queueConfig,
              uiStore.createTaskOutputRootDir,
              uiStore.imageProcessOutputRootDir,
            ),
          );
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          console.error("persist state failed:", message);
          uiStore.showNotice(buildPersistErrorNotice(message), "warn");
        }
      } while (persistRerunRequested);
    })().finally(() => {
      persistInFlight = null;
    });

    await persistInFlight;
  }

  // 延迟保存状态：普通状态短防抖，日志保存稍长合并，减少 SQLite 写入频率。
  function schedulePersist(reason: PersistReason = "state") {
    if (!hydrated.value) return;

    if (reason === "logs" || reason === "progress") {
      if (logPersistenceTimer !== null) return;
      logPersistenceTimer = window.setTimeout(() => {
        void persistState();
      }, 1000);
      return;
    }

    if (persistenceTimer !== null) {
      window.clearTimeout(persistenceTimer);
    }

    persistenceTimer = window.setTimeout(() => {
      void persistState();
    }, 180);
  }

  // 应用启动恢复入口：读取本地快照、恢复任务状态、清理过期 Cookie。
  async function bootstrap() {
    if (hydrated.value || bootstrapping.value) return;

    bootstrapping.value = true;
    const seed = createInitialAppSeed();

    try {
      try {
        const snapshot = await runtimeBridge.loadState();
        if (snapshot) {
          taskQueueStore.setTasks(rehydrateTasks(snapshot.tasks));

          const latestTask = taskQueueStore.tasks[taskQueueStore.tasks.length - 1];
          if (Object.prototype.hasOwnProperty.call(snapshot, "createTaskOutputRootDir")) {
            uiStore.syncCreateTaskOutputRootDir(snapshot.createTaskOutputRootDir?.trim() ?? "");
          } else if (latestTask?.target.outputRootDir) {
            uiStore.syncCreateTaskOutputRootDir(latestTask.target.outputRootDir);
          }

          uiStore.syncImageProcessOutputRootDir(snapshot.imageProcessOutputRootDir?.trim() ?? "");

          const normalizedCookies = cookiesStore.setCookies(snapshot.cookies);
          logsStore.setLogs(snapshot.logs);
          taskQueueStore.setQueueConfig(snapshot.queueConfig ?? seed.queueConfig);

          if (normalizedCookies.removedCount > 0) {
            // 启动完成后，检查是否有过期 Cookie 需要提示用户
            await nextTick();
            uiStore.showExpiredCookiePrompt(normalizedCookies.removedCount, normalizedCookies.latestExpiresAt);
          }

          if (normalizedCookies.changed) {
            schedulePersist();
          }
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error("load persisted state failed:", message);
        uiStore.showNotice("本地持久化读取失败，已回退到默认空白状态", "warn");
      }

      hydrated.value = true;
    } finally {
      bootstrapping.value = false;
    }
  }

  // 包装异步动作，防止同一个按钮或操作被重复点击并发执行。
  async function withPending<T>(actionId: string, run: () => Promise<T>) {
    if (uiStore.isActionPending(actionId)) return null;
    uiStore.addPendingAction(actionId);
    try {
      return await run();
    } finally {
      uiStore.removePendingAction(actionId);
    }
  }

  // 批量创建链接任务，写日志、关闭弹窗，并自动启动队列。
  async function createTasks(drafts: TaskDraft[], options: CreateTasksOptions = {}) {
    await withPending("queue.create-task", async () => {
      uiStore.syncCreateTaskOutputRootDir(drafts[0]?.outputRootDir ?? uiStore.createTaskOutputRootDir);

      const result = await createTasksAction(drafts, uiStore.createTaskMoviePreviews, options);

      schedulePersist();
      uiStore.showNotice(
        result.replacedCount > 0
          ? `已覆盖 ${result.replacedCount} 个旧任务并重新加入队列`
          : result.hasSelectedPhotoTasks
            ? "已新增选图下载任务"
            : result.createdCount > 1
            ? `已新增 ${result.createdCount} 个链接任务`
            : "已新增链接任务",
        "success",
      );
      uiStore.closeCreateTask();
      uiStore.clearCreateTaskDraft();
    });
  }

  // 手动重试失败任务：重置任务状态并重新启动队列循环。
  async function retryTask(taskId: string) {
    await withPending(`queue.retry.${taskId}`, async () => {
      await retryTaskAction(taskId);
      schedulePersist();
      uiStore.showNotice("任务已重新加入队列", "success");
    });
  }

  // 请求暂停任务：先把界面切到 pausing，再通知 Tauri/sidecar 暂停。
  async function pauseTask(taskId: string) {
    await withPending(`queue.pause.${taskId}`, async () => {
      await pauseTaskAction(taskId);
      schedulePersist();
      uiStore.showNotice("任务已暂停", "warn");
    });
  }

  // 继续暂停任务：通知 Tauri 清除暂停状态，并把任务放回 retrying。
  async function resumeTask(taskId: string) {
    await withPending(`queue.resume.${taskId}`, async () => {
      await resumeTaskAction(taskId);
      schedulePersist();
      uiStore.showNotice("任务已继续", "success");
    });
  }

  // 删除单个任务，同时取消后台进程并删除该任务生成的输出目录。
  async function deleteTask(taskId: string) {
    await withPending(`queue.delete.${taskId}`, async () => {
      const task = taskQueueStore.getTaskById(taskId);
      if (taskQueueStore.activeTaskIdSet.has(taskId) && task?.lifecycle.phase !== "paused") {
        uiStore.showNotice("任务下载中，不能删除任务", "warn");
        return;
      }

      await deleteTaskAction(taskId);
      schedulePersist();
      uiStore.showNotice("任务已删除", "warn");
    });
  }

  // 清空队列时移除记录、取消后台任务，并清空这些任务所属输出根目录下的所有内容。
  async function clearQueueTasks() {
    if (taskQueueStore.queueHasActiveDownloads) {
      uiStore.showNotice("队列下载中，不能清空队列任务", "warn");
      return;
    }

    if (taskQueueStore.tasks.length === 0) {
      uiStore.showNotice("当前队列为空", "info");
      return;
    }

    await withPending("queue.clear-all", async () => {
      const result = await clearQueueTasksAction();
      schedulePersist();
      uiStore.showNotice(
        result.count > 0 ? `已清空 ${result.count} 个队列任务并清理输出目录` : "当前队列为空",
        result.count > 0 ? "warn" : "info",
      );
    });
  }

  // 导入 Cookie：无草稿时只打开弹窗，有草稿时保存 Cookie 并写日志。
  async function importCookie(draft?: CookieDraft) {
    await withPending("cookies.import", async () => {
      if (!draft) {
        uiStore.openImportCookie();
        return;
      }

      const result = cookiesStore.importCookie(draft);
      schedulePersist();
      uiStore.closeImportCookie();
      await logsStore.emitLog("INFO", "cookie", `已导入新的豆瓣 Cookie #${result.id}`);
      uiStore.showNotice(`已导入 Cookie #${result.id}`, "success");
    });
  }

  // 自动登录导入 Cookie：打开豆瓣登录窗口，轮询 Cookie，成功后保存并关闭窗口。
  async function startDoubanLoginImport() {
    await withPending("cookies.import.login", async () => {
      try {
        await logsStore.emitLog("INFO", "cookie", "已打开豆瓣登录窗口，等待登录完成");
        uiStore.showNotice("豆瓣登录窗口已打开，请完成登录");

        const result = await cookiesStore.startDoubanLoginImport();

        if (result.success && result.id) {
          schedulePersist();
          uiStore.closeImportCookie();
          await logsStore.emitLog("INFO", "cookie", `已自动导入豆瓣 Cookie #${result.id}`);
          uiStore.showNotice(`已导入 Cookie #${result.id}`, "success");
        } else {
          uiStore.showNotice("已取消豆瓣登录导入", "warn");
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await logsStore.emitLog("ERROR", "cookie", `豆瓣登录导入失败: ${message}`);
        uiStore.showNotice("豆瓣登录导入失败", "warn");
      }
    });
  }

  // 删除 Cookie 列表中的一条记录，并持久化状态。
  async function deleteCookie(cookieId: string) {
    await withPending(`cookies.delete.${cookieId}`, async () => {
      cookiesStore.deleteCookie(cookieId);
      schedulePersist();
      await logsStore.emitLog("WARN", "cookie", `Cookie 已删除 #${cookieId}`);
      uiStore.showNotice(`已删除 Cookie #${cookieId}`, "warn");
    });
  }

  // 清空日志中心的全部可见日志，并立即保存状态。
  async function clearAllLogs() {
    await withPending("logs.clear-all", async () => {
      logsStore.clearAllLogs();
      await persistState();
      uiStore.showNotice("全部日志已清空", "success");
    });
  }

  // 打开已完成任务的输出目录，未完成或无目录时忽略。
  async function openTaskOutputDirectory(taskId: string) {
    await withPending(`queue.open-output.${taskId}`, async () => {
      await openTaskOutputDirectoryAction(taskId);
      uiStore.showNotice("任务输出目录打开动作已触发");
    });
  }

  function persistTaskCoverPreview(taskId: string, preview: Pick<DoubanMoviePreview, "coverUrl" | "coverDataUrl">) {
    const task = taskQueueStore.getTaskById(taskId);
    if (!task) return;

    const nextCoverUrl = task.coverUrl ?? preview.coverUrl;
    const nextCoverDataUrl = task.coverDataUrl ?? preview.coverDataUrl;
    if (task.coverUrl === nextCoverUrl && task.coverDataUrl === nextCoverDataUrl) return;

    taskQueueStore.replaceTask({
      ...task,
      coverUrl: nextCoverUrl,
      coverDataUrl: nextCoverDataUrl,
    });
    schedulePersist();
  }

  // 顶栏通用 action 分发入口，目前用于日志中心的错误过滤切换。
  async function triggerAction(actionId: string) {
    if (actionId === "logs.only-errors") {
      logsStore.toggleLogOnlyErrors();
    }
  }

  // 监听运行时日志批次事件。
  void runtimeBridge.onRuntimeLogBatch((entries) => {
    if (entries.length === 0) return;
    const changed = taskQueueStore.applyRuntimeLogTaskUpdates(entries);
    logsStore.addLogBatch(entries);
    if (changed) {
      schedulePersist("progress");
    }
    schedulePersist("logs");
  });

  // 监听任务进度事件。
  void runtimeBridge.onTaskProgress((event) => {
    taskQueueStore.applyTaskProgressUpdate(event);
    schedulePersist("progress");
  });

  return {
    hydrated,
    bootstrapping,
    queueRunning: computed(() => taskQueueStore.queueRunning),
    queueBusy: computed(() => taskQueueStore.queueBusy),
    createTaskOpen: computed(() => uiStore.createTaskOpen),
    createTaskDetailUrls: computed(() => uiStore.createTaskDetailUrls),
    selectedPhotoDownloadSeed: computed(() => uiStore.selectedPhotoDownloadSeed),
    createTaskOutputRootDir: computed(() => uiStore.createTaskOutputRootDir),
    importCookieOpen: computed(() => uiStore.importCookieOpen),
    searchMovieOpen: computed(() => uiStore.searchMovieOpen),
    customCropOpen: computed(() => uiStore.customCropOpen),
    imageProcessOpen: computed(() => uiStore.imageProcessOpen),
    imageProcessOutputRootDir: computed(() => uiStore.imageProcessOutputRootDir),
    expiredCookiePromptOpen: computed(() => uiStore.expiredCookiePromptOpen),
    expiredCookieCount: computed(() => uiStore.expiredCookieCount),
    expiredCookieExpiresAt: computed(() => uiStore.expiredCookieExpiresAt),
    logOnlyErrors: computed(() => logsStore.logOnlyErrors),
    progressTick: computed(() => taskQueueStore.progressTick),
    tasks: computed(() => taskQueueStore.tasks),
    cookies: computed(() => cookiesStore.cookies),
    logs: computed(() => logsStore.logs),
    queueConfig: computed(() => taskQueueStore.queueConfig),
    queueSortOrder: computed(() => taskQueueStore.queueSortOrder),
    queueSearchQuery: computed(() => taskQueueStore.queueSearchQuery),
    visibleLogs: computed(() => logsStore.visibleLogs),
    customCropOutputRootDir: computed(() => uiStore.customCropOutputRootDir),
    notice: computed(() => uiStore.notice),
    pendingActionIds: computed(() => uiStore.pendingActionIds),
    activeTaskIds: computed(() => taskQueueStore.activeTaskIds),
    queueHasActiveDownloads: computed(() => taskQueueStore.queueHasActiveDownloads),
    clearNotice: uiStore.clearNotice,
    showNotice: uiStore.showNotice,
    syncCreateTaskDetailUrls: uiStore.syncCreateTaskDetailUrls,
    syncCreateTaskOutputRootDir: (value: string) => {
      const changed = uiStore.syncCreateTaskOutputRootDir(value);
      if (changed) schedulePersist();
    },
    syncImageProcessOutputRootDir: (value: string) => {
      const changed = uiStore.syncImageProcessOutputRootDir(value);
      if (changed) schedulePersist();
    },
    addCreateTaskDetailUrl: uiStore.addCreateTaskDetailUrl,
    upsertCreateTaskMoviePreview: uiStore.upsertCreateTaskMoviePreview,
    getCreateTaskMoviePreview: uiStore.getCreateTaskMoviePreview,
    removeCreateTaskDetailUrl: uiStore.removeCreateTaskDetailUrl,
    hasCreateTaskDetailUrl: uiStore.hasCreateTaskDetailUrl,
    findDuplicateTasksForDrafts: taskQueueStore.findDuplicateTasksForDrafts,
    toggleLogOnlyErrors: logsStore.toggleLogOnlyErrors,
    openCreateTask: uiStore.openCreateTask,
    openSelectedPhotoDownload: uiStore.openSelectedPhotoDownload,
    closeCreateTask: uiStore.closeCreateTask,
    openImportCookie: uiStore.openImportCookie,
    openSearchMovie: uiStore.openSearchMovie,
    closeImportCookie: uiStore.closeImportCookie,
    closeSearchMovie: uiStore.closeSearchMovie,
    openCustomCrop: uiStore.openCustomCrop,
    closeCustomCrop: uiStore.closeCustomCrop,
    openImageProcess: uiStore.openImageProcess,
    closeImageProcess: uiStore.closeImageProcess,
    closeExpiredCookiePrompt: uiStore.closeExpiredCookiePrompt,
    openLoginFromExpiredPrompt: uiStore.openLoginFromExpiredPrompt,
    createTasks,
    importCookie,
    startDoubanLoginImport,
    deleteCookie,
    retryTask,
    pauseTask,
    resumeTask,
    deleteTask,
    openTaskOutputDirectory,
    persistTaskCoverPreview,
    clearQueueTasks,
    clearAllLogs,
    triggerAction,
    isActionPending: uiStore.isActionPending,
    bootstrap,
  };
});
