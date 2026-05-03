import { computed, ref } from "vue";
import { defineStore } from "pinia";
import { createInitialAppSeed, createTaskFromDraft } from "../data/mock";
import { extractDoubanEmptyCategoryTitle, formatDoubanAssetTypeLabel } from "../lib/douban-empty-category";
import { runTaskLifecycle } from "../lib/queue-runtime";
import { runtimeBridge } from "../lib/runtime-bridge";
import { compareTaskAddedOrder } from "../lib/task-order";
import type {
  AppSeedState,
  CookieDraft,
  CookieMutation,
  CookieProfile,
  NoticePayload,
  QueueConfig,
  RuntimeDownloadTaskResult,
  RuntimeTaskProgressEvent,
  TaskDraft,
  TaskItem,
} from "../types/app";

const runnablePhases = new Set(["queued", "retrying"]);
const resumablePhases = new Set(["resolving", "discovering", "downloading"]);
const pausablePhases = new Set(["resolving", "discovering", "downloading", "retrying"]);
const terminalProgressPhases = new Set(["completed", "failed", "paused"]);
const cookieRetentionMs = 30 * 24 * 60 * 60 * 1000;

const wait = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));
const resolvedTitleLogPrefix = "片名已解析: ";
const discoveredImagesLogPattern = /^(?:\[[^\]]+\]\s*)?discovered\s+(\d+)\s+images\s+from\s+\S+\s+->\s+(.+)$/i;
const savedImageLogPattern = /^(?:\[[^\]]+\]\s*)?saved image:\s*(.+)$/i;

function timestampNow() {
  return new Intl.DateTimeFormat("zh-CN", {
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  })
    .format(new Date())
    .replace(/\//g, "-");
}

function clonePersistable<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function normalizeSnapshotLogs(logs: AppSeedState["logs"]) {
  const nextLogs = clonePersistable(logs.slice(0, 200));
  const usedIds = new Set<number>();
  let maxId = nextLogs.reduce((currentMax, entry) => Math.max(currentMax, entry.id), 0);

  return nextLogs.map((entry) => {
    if (!usedIds.has(entry.id)) {
      usedIds.add(entry.id);
      return entry;
    }

    maxId += 1;
    usedIds.add(maxId);
    return {
      ...entry,
      id: maxId,
    };
  });
}

function buildPersistErrorNotice(message: string) {
  const compactMessage = message.replace(/\s+/g, " ").trim().slice(0, 120);
  return compactMessage ? `本地持久化保存失败：${compactMessage}` : "本地持久化保存失败";
}

function toSnapshot(tasks: TaskItem[], cookies: CookieProfile[], logs: AppSeedState["logs"], queueConfig: QueueConfig): AppSeedState {
  return {
    schemaVersion: 2,
    tasks: clonePersistable(tasks),
    cookies: clonePersistable(cookies),
    logs: normalizeSnapshotLogs(logs),
    queueConfig: clonePersistable(queueConfig),
  };
}

// 持久化恢复后，未结束任务统一退回可重试，避免应用重启后卡在中间态。
function rehydrateTasks(tasks: TaskItem[]) {
  return tasks.map((task) => {
    const normalizedTask = {
      ...task,
      target: {
        ...task.target,
        doubanAssetType: task.target.doubanAssetType ?? "still",
        imageCountMode: task.target.imageCountMode ?? "limited",
        outputImageFormat: task.target.outputImageFormat ?? "jpg",
        requestIntervalSeconds: task.target.requestIntervalSeconds ?? 1,
      },
    };

    if (
      normalizedTask.download?.targetCount &&
      normalizedTask.download.savedCount >= normalizedTask.download.targetCount &&
      (normalizedTask.outputDirectory || normalizedTask.download.directory)
    ) {
      return {
        ...normalizedTask,
        lifecycle: {
          ...normalizedTask.lifecycle,
          phase: "completed" as const,
          updatedAt: timestampNow(),
          cooldownUntil: undefined,
          lastError: undefined,
        },
        outputDirectory: normalizedTask.outputDirectory ?? normalizedTask.download.directory,
        summary: `已下载 ${normalizedTask.download.savedCount}/${normalizedTask.download.targetCount} 张图片`,
      };
    }

    if (!resumablePhases.has(task.lifecycle.phase)) {
      return normalizedTask;
    }

    return {
      ...normalizedTask,
      lifecycle: {
        ...normalizedTask.lifecycle,
        phase: "retrying" as const,
        updatedAt: timestampNow(),
      },
      summary: "应用重启后恢复为待重试状态",
    };
  });
}

function inferTaskSource(task: TaskItem) {
  if (task.target.sourceHint !== "auto") {
    return task.target.sourceHint;
  }

  return "douban";
}

function fileNameFromPath(filePath: string) {
  return filePath.split(/[/\\]/).pop() ?? filePath;
}

function buildAutoImportedCookieNote() {
  return `豆瓣登录导入 ${timestampNow()}`;
}

function extractResolvedTitleFromLogMessage(message: string) {
  if (!message.startsWith(resolvedTitleLogPrefix)) {
    return null;
  }

  const title = message.slice(resolvedTitleLogPrefix.length).trim();
  return title || null;
}

function extractDiscoveredDownloadSnapshotFromLogMessage(message: string) {
  const match = discoveredImagesLogPattern.exec(message.trim());
  if (!match) {
    return null;
  }

  const targetCount = Number(match[1]);
  const outputDirectory = match[2]?.trim();
  if (!Number.isFinite(targetCount) || targetCount < 0) {
    return null;
  }

  return {
    targetCount,
    outputDirectory: outputDirectory || null,
  };
}

function extractSavedImagePathFromLogMessage(message: string) {
  const match = savedImageLogPattern.exec(message.trim());
  if (!match) {
    return null;
  }

  const outputPath = match[1]?.trim();
  return outputPath || null;
}

function normalizeComparablePath(path: string) {
  return path.trim().replace(/[\\/]+$/, "").toLowerCase();
}

function getTaskGeneratedOutputDirectory(task: TaskItem) {
  const directoryPath = task.outputDirectory ?? task.download?.directory;
  if (!directoryPath) {
    return null;
  }

  if (normalizeComparablePath(directoryPath) === normalizeComparablePath(task.target.outputRootDir)) {
    return null;
  }

  return {
    directoryPath,
    rootDirectoryPath: task.target.outputRootDir,
  };
}

function directoryFromFilePath(filePath: string) {
  const separatorIndex = Math.max(filePath.lastIndexOf("/"), filePath.lastIndexOf("\\"));
  if (separatorIndex === -1) {
    return null;
  }

  return filePath.slice(0, separatorIndex);
}

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

function shouldCooldownDoubanCookie(message: string) {
  const normalized = message.toLowerCase();

  if (normalized.includes("no images discovered on douban photos page")) {
    return false;
  }

  return [
    "403",
    "418",
    "429",
    "forbidden",
    "captcha",
    "验证码",
    "sec.douban.com",
  ].some((keyword) => normalized.includes(keyword));
}

function isDoubanAuthFailure(message: string) {
  const normalized = message.toLowerCase();

  return [
    "douban login required",
    "login required",
    "session expired",
    "login expired",
    "cookie expired",
    "sign in again",
    "log in again",
    "please sign in again",
    "please log in again",
    "登录失效",
    "登录已失效",
    "登录过期",
    "会话过期",
    "需要登录",
    "请重新登录",
    "请先登录",
  ].some((keyword) => normalized.includes(keyword));
}

function classifyDoubanFailure(message: string, task: TaskItem) {
  const normalized = message.toLowerCase();

  if (normalized.includes("douban photo category is empty")) {
    const title = extractDoubanEmptyCategoryTitle(message) ?? (task.title !== "待解析标题" ? task.title : "当前条目");
    const assetLabel = formatDoubanAssetTypeLabel(task.target.doubanAssetType);
    return {
      kind: "empty" as const,
      cooldown: false,
      userMessage: `${title}暂时没有${assetLabel}`,
    };
  }

  if (isDoubanAuthFailure(message)) {
    return {
      kind: "auth" as const,
      cooldown: true,
      userMessage: "豆瓣登录状态失效，请重新导入 Cookie",
    };
  }

  if (normalized.includes("douban risk page detected")) {
    return {
      kind: "risk" as const,
      cooldown: true,
      userMessage: "触发豆瓣风控，请稍后重试",
    };
  }

  if (normalized.includes("douban page structure mismatch")) {
    return {
      kind: "unexpected" as const,
      cooldown: false,
      userMessage: "豆瓣页面结构异常，暂时无法解析",
    };
  }

  return {
    kind: "generic" as const,
    cooldown: shouldCooldownDoubanCookie(message),
    userMessage: shouldCooldownDoubanCookie(message)
      ? "豆瓣访问受限，请稍后重试或重新导入 Cookie"
      : "豆瓣抓图失败，请稍后重试",
  };
}

function resolveFailureTaskTitle(message: string, task: TaskItem) {
  if (task.title !== "待解析标题") {
    return task.title;
  }

  return extractDoubanEmptyCategoryTitle(message) ?? task.title;
}

function createCookieLifetime(baseTime = Date.now()) {
  return {
    importedAt: new Date(baseTime).toISOString(),
    expiresAt: new Date(baseTime + cookieRetentionMs).toISOString(),
  };
}

function normalizeCookieProfiles(rawCookies: CookieProfile[], now = Date.now()) {
  let changed = false;
  let removedCount = 0;

  const cookies = rawCookies.flatMap((cookie) => {
    const expiresAt = Number.isFinite(new Date(cookie.expiresAt ?? "").getTime())
      ? new Date(cookie.expiresAt!).toISOString()
      : new Date(now + cookieRetentionMs).toISOString();
    const expiresTime = new Date(expiresAt).getTime();

    if (expiresTime <= now) {
      changed = true;
      removedCount += 1;
      return [];
    }

    const importedAt = Number.isFinite(new Date(cookie.importedAt ?? "").getTime())
      ? new Date(cookie.importedAt!).toISOString()
      : new Date(now).toISOString();

    if (cookie.expiresAt !== expiresAt || cookie.importedAt !== importedAt) {
      changed = true;
    }

    return [
      {
        ...cookie,
        importedAt,
        expiresAt,
      },
    ];
  });

  return {
    cookies,
    changed,
    removedCount,
  };
}

export const useAppStore = defineStore("app", () => {
  const seed = createInitialAppSeed();

  const hydrated = ref(false);
  const bootstrapping = ref(false);
  const queueRunning = ref(false);
  const queueBusy = ref(false);
  const createTaskOpen = ref(false);
  const importCookieOpen = ref(false);
  const logOnlyErrors = ref(false);
  const progressTick = ref(0);
  const tasks = ref<TaskItem[]>(seed.tasks);
  const cookies = ref<CookieProfile[]>(seed.cookies);
  const logs = ref(seed.logs);
  const queueConfig = ref<QueueConfig>(seed.queueConfig);
  const notice = ref<NoticePayload | null>(null);
  const pendingActionIds = ref<string[]>([]);
  const activeTaskIds = ref<string[]>([]);

  let persistenceTimer: number | null = null;
  let logPersistenceTimer: number | null = null;
  let taskIdSequence = 0;
  let cookieIdSequence = 299;
  let persistInFlight: Promise<void> | null = null;
  let persistRerunRequested = false;

  function replaceTaskAtIndex(taskIndex: number, nextTask: TaskItem) {
    tasks.value = tasks.value.map((task, index) => (index === taskIndex ? nextTask : task));
  }

  function applyTaskProgressUpdate(event: RuntimeTaskProgressEvent) {
    const taskIndex = tasks.value.findIndex((task) => task.id === event.taskId);
    if (taskIndex === -1) {
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
    schedulePersist();
    return true;
  }

  function applyRuntimeLogTaskUpdate(entry: AppSeedState["logs"][number]) {
    if (!entry.taskId) {
      return false;
    }

    const taskProgress = extractTaskProgressFromRuntimeLog(entry);
    if (taskProgress) {
      return applyTaskProgressUpdate(taskProgress);
    }

    const taskIndex = tasks.value.findIndex((task) => task.id === entry.taskId);
    if (taskIndex === -1) {
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

  function applyRuntimeLogTaskUpdates(entries: AppSeedState["logs"]) {
    let changed = false;

    for (const entry of entries) {
      if (applyRuntimeLogTaskUpdate(entry)) {
        changed = true;
      }
    }

    if (changed) {
      schedulePersist();
    }
  }

  void runtimeBridge.onRuntimeLogBatch((entries) => {
    if (entries.length === 0) return;
    applyRuntimeLogTaskUpdates(entries);
    logs.value.unshift(...entries.slice().reverse());
    schedulePersist("logs");
  });

  void runtimeBridge.onTaskProgress((event) => {
    applyTaskProgressUpdate(event);
  });

  const visibleLogs = computed(() =>
    (logOnlyErrors.value ? logs.value.filter((entry) => entry.level === "ERROR") : logs.value).filter(
      (entry) => entry.scope !== "task-progress",
    ),
  );

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
            toSnapshot(tasks.value, cookies.value, logs.value, queueConfig.value),
          );
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          console.error("persist state failed:", message);
          showNotice(buildPersistErrorNotice(message), "warn");
        }
      } while (persistRerunRequested);
    })().finally(() => {
      persistInFlight = null;
    });

    await persistInFlight;
  }

  function schedulePersist(reason: "state" | "logs" = "state") {
    if (!hydrated.value) return;

    if (reason === "logs") {
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

  function showNotice(message: string, tone: NoticePayload["tone"] = "info") {
    notice.value = { message, tone };
  }

  function clearNotice() {
    notice.value = null;
  }

  function toggleLogOnlyErrors(force?: boolean) {
    logOnlyErrors.value = typeof force === "boolean" ? force : !logOnlyErrors.value;
  }

  function openCreateTask() {
    createTaskOpen.value = true;
  }

  function closeCreateTask() {
    createTaskOpen.value = false;
  }

  function openImportCookie() {
    importCookieOpen.value = true;
  }

  function closeImportCookie() {
    importCookieOpen.value = false;
  }

  function isActionPending(actionId: string) {
    return pendingActionIds.value.includes(actionId);
  }

  function replaceTask(nextTask: TaskItem) {
    const index = tasks.value.findIndex((task) => task.id === nextTask.id);
    if (index === -1) return;
    replaceTaskAtIndex(index, nextTask);
    schedulePersist();
  }

  function getTaskById(taskId: string) {
    return tasks.value.find((task) => task.id === taskId);
  }

  function applyCookieMutations(mutations?: CookieMutation[]) {
    if (!mutations?.length) return;

    cookies.value = cookies.value.map((cookie) => {
      const mutation = mutations.find((item) => item.id === cookie.id);
      if (!mutation) return cookie;

      return {
        ...cookie,
        status: mutation.status ?? cookie.status,
        success: cookie.success + (mutation.successDelta ?? 0),
        failure: cookie.failure + (mutation.failureDelta ?? 0),
        coolingUntil:
          mutation.coolingUntil === null
            ? undefined
            : mutation.coolingUntil ?? cookie.coolingUntil,
      };
    });

    schedulePersist();
  }

  function nextTaskId() {
    taskIdSequence += 1;
    return `task-${Date.now()}-${taskIdSequence}`;
  }

  function nextCookieId() {
    const maxExistingId = cookies.value.reduce((maxId, cookie) => {
      const numericId = Number(cookie.id);
      return Number.isInteger(numericId) ? Math.max(maxId, numericId) : maxId;
    }, 299);

    cookieIdSequence = Math.max(cookieIdSequence, maxExistingId) + 1;
    return String(cookieIdSequence);
  }

  function pickUsableCookie(task: TaskItem) {
    if (inferTaskSource(task) !== "douban") {
      return null;
    }

    const normalized = normalizeCookieProfiles(cookies.value);
    if (normalized.changed) {
      cookies.value = normalized.cookies;
      schedulePersist();
    }

    return cookies.value.find((cookie) => cookie.source === "douban" && cookie.status !== "cooling" && cookie.value);
  }

  function buildCompletedTask(task: TaskItem, result: RuntimeDownloadTaskResult, attempts: number): TaskItem {
    const discovered = result.discovery.images.map((image) => ({
      ...image,
      extension: image.imageUrl.match(/\.[a-z0-9]+(?:$|\?)/i)?.[0]?.replace(/\?.*$/, ""),
    }));

    return {
      ...task,
      title: result.discovery.normalizedTitle,
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
        posterCount: discovered.filter((image) => image.category === "poster").length,
        stillCount: discovered.filter((image) => image.category === "still").length,
        verticalCount: discovered.filter((image) => image.orientation === "vertical").length,
        horizontalCount: discovered.filter((image) => image.orientation === "horizontal").length,
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

  function isCooling(task: TaskItem) {
    if (!task.lifecycle.cooldownUntil) return false;
    return new Date(task.lifecycle.cooldownUntil).getTime() > Date.now();
  }

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

  function hasActiveDoubanTask(excludeTaskId?: string) {
    return activeTaskIds.value.some((taskId) => {
      if (taskId === excludeTaskId) return false;
      const task = tasks.value.find((item) => item.id === taskId);
      return task ? inferTaskSource(task) === "douban" : false;
    });
  }

  function hasRemainingQueueWork() {
    return tasks.value.some((task) => {
      if (runnablePhases.has(task.lifecycle.phase)) return true;
      if (task.lifecycle.phase === "failed" && task.lifecycle.attempts < queueConfig.value.maxAttempts) return true;
      return false;
    });
  }

  async function emitLog(level: "INFO" | "WARN" | "ERROR", scope: string, message: string, taskId?: string) {
    await runtimeBridge.emitLog({ level, scope, message, taskId });
  }

  async function bootstrap() {
    if (hydrated.value || bootstrapping.value) return;

    bootstrapping.value = true;
    let cookiesChanged = false;
    try {
      try {
        const snapshot = await runtimeBridge.loadState();
        if (snapshot) {
          tasks.value = rehydrateTasks(snapshot.tasks);
          const normalizedCookies = normalizeCookieProfiles(snapshot.cookies);
          cookies.value = normalizedCookies.cookies;
          cookiesChanged = normalizedCookies.changed;
          logs.value = snapshot.logs;
          queueConfig.value = snapshot.queueConfig ?? seed.queueConfig;
          if (normalizedCookies.removedCount > 0) {
            showNotice(`已自动清理 ${normalizedCookies.removedCount} 个过期 Cookie`, "info");
          }
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error("load persisted state failed:", message);
        showNotice("本地持久化读取失败，已回退到默认空白状态", "warn");
      }

      hydrated.value = true;
      if (cookiesChanged) {
        schedulePersist();
      }
    } finally {
      bootstrapping.value = false;
    }
  }

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

    if (promoted > 0) {
      schedulePersist();
      void emitLog("INFO", "queue", `失败冷却结束: ${promoted} 个任务恢复可重试状态`);
    }
  }

  function nextRunnableBatch() {
    const batch: TaskItem[] = [];
    let batchHasDouban = false;

    for (const task of [...tasks.value].sort(compareTaskAddedOrder)) {
      if (batch.length >= queueConfig.value.batchSize) {
        break;
      }

      if (!runnablePhases.has(task.lifecycle.phase)) continue;
      if (activeTaskIds.value.includes(task.id)) continue;
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

  async function runBrowserTask(task: TaskItem) {
    for await (const frame of runTaskLifecycle(task, cookies.value, queueConfig.value)) {
      replaceTask(frame.task);
      applyCookieMutations(frame.cookieMutations);

      if (!queueRunning.value) {
        break;
      }
    }
  }

  async function runNativeTask(task: TaskItem) {
    const attempts = task.lifecycle.attempts + 1;
    const cookie = pickUsableCookie(task);

    // 原生桌面端统一走 Tauri + sidecar 真实抓取链路，浏览器模式才退回演示态。
    replaceTask({
      ...task,
      lifecycle: {
        phase: "resolving",
        attempts,
        updatedAt: timestampNow(),
        cooldownUntil: undefined,
        lastError: undefined,
      },
      summary: "正在解析详情页与图片页",
    });

    try {
      const result = await runtimeBridge.runDownloadTask({
        taskId: task.id,
        detailUrl: task.target.detailUrl,
        outputRootDir: task.target.outputRootDir,
        sourceHint: task.target.sourceHint,
        doubanAssetType: task.target.doubanAssetType,
        imageCountMode: task.target.imageCountMode,
        maxImages: task.target.maxImages,
        outputImageFormat: task.target.outputImageFormat,
        requestIntervalSeconds: task.target.requestIntervalSeconds,
        doubanCookie: cookie?.value,
      });

      replaceTask(buildCompletedTask(task, result, attempts));
      progressTick.value += 1;

      if (cookie && result.discovery.source === "douban") {
        cookies.value = cookies.value.map((item) =>
          item.id === cookie.id
            ? {
                ...item,
                status: "active",
                success: item.success + 1,
                failure: item.failure,
              }
            : item,
        );
        schedulePersist();
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const latestTask = getTaskById(task.id);

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
      const cooldownUntil = new Date(Date.now() + queueConfig.value.failureCooldownMs).toISOString();

      replaceTask({
        ...latestTask,
        title: resolveFailureTaskTitle(message, latestTask),
        lifecycle: {
          phase: "failed",
          attempts,
          updatedAt: timestampNow(),
          cooldownUntil:
            failure.cooldown && attempts < queueConfig.value.maxAttempts ? cooldownUntil : undefined,
          lastError: message,
        },
        summary: failure.userMessage,
      });
      progressTick.value += 1;

      if (cookie && isDoubanTask) {
        cookies.value = cookies.value.map((item) =>
          item.id === cookie.id
            ? {
                ...item,
                status: failure.cooldown && attempts < queueConfig.value.maxAttempts ? "cooling" : "active",
                failure: failure.cooldown ? item.failure + 1 : item.failure,
                coolingUntil:
                  failure.cooldown && attempts < queueConfig.value.maxAttempts ? cooldownUntil : undefined,
              }
            : item,
        );
        schedulePersist();
      }

      await emitLog("ERROR", "queue", `任务失败: ${message}`, task.id);
    }
  }

  async function processTask(task: TaskItem) {
    activeTaskIds.value = [...activeTaskIds.value, task.id];
    try {
      if (runtimeBridge.isNativeRuntime()) {
        await runNativeTask(task);
        return;
      }

      await runBrowserTask(task);
    } finally {
      activeTaskIds.value = activeTaskIds.value.filter((item) => item !== task.id);
    }
  }

  async function drainQueue() {
    if (queueBusy.value) return;
    queueBusy.value = true;

    try {
      while (queueRunning.value) {
        promoteCooledTasks();
        const batch = nextRunnableBatch();
        if (batch.length === 0) {
          const cooldownDelay = nextCooldownDelay();
          if (cooldownDelay !== null) {
            await wait(Math.min(cooldownDelay, 1000));
            continue;
          }
          break;
        }

        const inFlight = new Set<Promise<void>>();
        for (const task of batch) {
          const runner = processTask(task).finally(() => {
            inFlight.delete(runner);
          });
          inFlight.add(runner);

          if (inFlight.size >= queueConfig.value.concurrency) {
            await Promise.race(inFlight);
          }
        }

        await Promise.all(inFlight);
      }
    } finally {
      queueBusy.value = false;
      activeTaskIds.value = [];

      if (queueRunning.value && !hasRemainingQueueWork()) {
        queueRunning.value = false;
        showNotice("本轮任务已全部流转完成", "success");
      }
    }
  }

  async function withPending<T>(actionId: string, run: () => Promise<T>) {
    if (isActionPending(actionId)) return null;
    pendingActionIds.value = [...pendingActionIds.value, actionId];
    try {
      return await run();
    } finally {
      pendingActionIds.value = pendingActionIds.value.filter((item) => item !== actionId);
    }
  }

  async function createTasks(drafts: TaskDraft[]) {
    await withPending("queue.create-task", async () => {
      const createdTasks = drafts.map((draft) => createTaskFromDraft(nextTaskId(), draft));
      tasks.value = [...tasks.value, ...createdTasks];
      schedulePersist();
      await emitLog(
        "INFO",
        "command",
        `新增链接任务 ${createdTasks.length} 个 -> ${drafts[0]?.outputRootDir ?? ""} / 并发 ${queueConfig.value.concurrency}`,
      );
      showNotice(createdTasks.length > 1 ? `已新增 ${createdTasks.length} 个链接任务` : "已新增链接任务", "success");
      createTaskOpen.value = false;
      queueRunning.value = true;
      void drainQueue();
    });
  }

  async function retryTask(taskId: string) {
    await withPending(`queue.retry.${taskId}`, async () => {
      const task = tasks.value.find((item) => item.id === taskId);
      if (!task) return;

      replaceTask(resetTask(task));
      queueRunning.value = true;
      await emitLog("INFO", "queue", `任务已手动重试: ${task.target.detailUrl}`, taskId);
      showNotice("任务已重新加入队列", "success");
      void drainQueue();
    });
  }

  async function pauseTask(taskId: string) {
    await withPending(`queue.pause.${taskId}`, async () => {
      const task = getTaskById(taskId);
      if (!task || !pausablePhases.has(task.lifecycle.phase)) return;

      replaceTask({
        ...task,
        lifecycle: {
          ...task.lifecycle,
          phase: "pausing",
          updatedAt: timestampNow(),
        },
        summary: "任务正在暂停",
      });

      await runtimeBridge.pauseDownloadTask(taskId);

      const latestTask = getTaskById(taskId) ?? task;
      replaceTask({
        ...latestTask,
        lifecycle: {
          ...latestTask.lifecycle,
          phase: "paused",
          updatedAt: timestampNow(),
        },
        summary: "任务已暂停",
      });

      await emitLog("WARN", "queue", `任务已暂停: ${task.target.detailUrl}`, taskId);
      showNotice("任务已暂停", "warn");
    });
  }

  async function resumeTask(taskId: string) {
    await withPending(`queue.resume.${taskId}`, async () => {
      const task = getTaskById(taskId);
      if (!task || task.lifecycle.phase !== "paused") return;

      await runtimeBridge.resumeDownloadTask(taskId);

      replaceTask({
        ...task,
        lifecycle: {
          ...task.lifecycle,
          phase: "retrying",
          updatedAt: timestampNow(),
        },
        summary: "任务继续中",
      });

      queueRunning.value = true;
      await emitLog("INFO", "queue", `任务已继续: ${task.target.detailUrl}`, taskId);
      showNotice("任务已继续", "success");
      void drainQueue();
    });
  }

  async function deleteTask(taskId: string) {
    await withPending(`queue.delete.${taskId}`, async () => {
      const task = tasks.value.find((item) => item.id === taskId);
      const outputDirectory = task?.outputDirectory ?? task?.download?.directory;

      if (runtimeBridge.isNativeRuntime() && task) {
        await runtimeBridge.clearDownloadTasks([taskId]);
        if (outputDirectory) {
          await runtimeBridge.deleteDirectoryPath(outputDirectory, task.target.outputRootDir);
        }
      }

      tasks.value = tasks.value.filter((item) => item.id !== taskId);
      progressTick.value += 1;
      schedulePersist();
      await emitLog(
        "WARN",
        "queue",
        outputDirectory
          ? `任务已删除并清理输出目录: ${outputDirectory}`
          : `任务已删除: ${task?.target.detailUrl ?? taskId}`,
        taskId,
      );
      showNotice("任务已删除", "warn");
    });
  }

  async function clearQueueTasks() {
    await withPending("queue.clear-all", async () => {
      const count = tasks.value.length;
      const taskIds = tasks.value.map((task) => task.id);
      const outputDirectories: { directoryPath: string; rootDirectoryPath: string }[] = [];
      for (const task of tasks.value) {
        const outputDirectory = getTaskGeneratedOutputDirectory(task);
        if (!outputDirectory) continue;
        if (outputDirectories.some((item) => item.directoryPath === outputDirectory.directoryPath)) continue;

        outputDirectories.push(outputDirectory);
      }
      queueRunning.value = false;

      if (runtimeBridge.isNativeRuntime() && taskIds.length > 0) {
        await runtimeBridge.clearDownloadTasks(taskIds);
        for (const outputDirectory of outputDirectories) {
          if (outputDirectory) {
            await runtimeBridge.deleteDirectoryPath(outputDirectory.directoryPath, outputDirectory.rootDirectoryPath);
          }
        }
      }

      activeTaskIds.value = [];
      tasks.value = [];
      progressTick.value += 1;
      schedulePersist();
      await emitLog("WARN", "queue", `队列任务已清空: ${count} 个`);
      showNotice(count > 0 ? `已清空 ${count} 个队列任务` : "当前队列为空", count > 0 ? "warn" : "info");
    });
  }

  async function importCookie(draft?: CookieDraft) {
    await withPending("cookies.import", async () => {
      if (!draft) {
        openImportCookie();
        return;
      }

      const normalized = normalizeCookieProfiles(cookies.value);
      if (normalized.changed) {
        cookies.value = normalized.cookies;
      }

      const id = nextCookieId();
      cookies.value.unshift({
        id,
        status: "active",
        success: 0,
        failure: 0,
        note: draft.note,
        source: "douban",
        value: draft.value,
        ...createCookieLifetime(),
      });
      schedulePersist();
      importCookieOpen.value = false;
      await emitLog("INFO", "cookie", `已导入新的豆瓣 Cookie #${id}`);
      showNotice(`已导入 Cookie #${id}`, "success");
    });
  }

  async function startDoubanLoginImport() {
    await withPending("cookies.import.login", async () => {
      const windowLabel = "douban-login-import";
      const normalized = normalizeCookieProfiles(cookies.value);
      if (normalized.changed) {
        cookies.value = normalized.cookies;
        schedulePersist();
      }

      try {
        await runtimeBridge.openDoubanLoginWindow(windowLabel);
        await emitLog("INFO", "cookie", "已打开豆瓣登录窗口，等待登录完成");
        showNotice("豆瓣登录窗口已打开，请完成登录");

        for (;;) {
          await wait(1200);
          const status = await runtimeBridge.inspectDoubanLoginWindow(windowLabel);

          if (status.state === "ready" && status.cookieValue) {
            const id = nextCookieId();
            cookies.value.unshift({
              id,
              status: "active",
              success: 0,
              failure: 0,
              note: buildAutoImportedCookieNote(),
              source: "douban",
              value: status.cookieValue,
              ...createCookieLifetime(),
            });
            schedulePersist();
            importCookieOpen.value = false;
            await runtimeBridge.closeDoubanLoginWindow(windowLabel);
            await emitLog("INFO", "cookie", `已自动导入豆瓣 Cookie #${id}`);
            showNotice(`已导入 Cookie #${id}`, "success");
            return;
          }

          if (status.state === "closed") {
            showNotice("已取消豆瓣登录导入", "warn");
            return;
          }
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await emitLog("ERROR", "cookie", `豆瓣登录导入失败: ${message}`);
        showNotice("豆瓣登录导入失败", "warn");
      }
    });
  }

  async function deleteCookie(cookieId: string) {
    await withPending(`cookies.delete.${cookieId}`, async () => {
      cookies.value = cookies.value.filter((cookie) => cookie.id !== cookieId);
      schedulePersist();
      await emitLog("WARN", "cookie", `Cookie 已删除 #${cookieId}`);
      showNotice(`已删除 Cookie #${cookieId}`, "warn");
    });
  }

  async function clearAllLogs() {
    await withPending("logs.clear-all", async () => {
      logs.value = [];
      await persistState();
      showNotice("全部日志已清空", "success");
    });
  }

  async function openTaskOutputDirectory(taskId: string) {
    await withPending(`queue.open-output.${taskId}`, async () => {
      const task = tasks.value.find((item) => item.id === taskId);
      if (!task?.outputDirectory || task.lifecycle.phase !== "completed") {
        return;
      }

      await runtimeBridge.openDirectoryPath(task.outputDirectory);
      await emitLog("INFO", "shell", `请求打开任务输出目录 ${task.outputDirectory}`, taskId);
      showNotice("任务输出目录打开动作已触发");
    });
  }

  async function triggerAction(actionId: string) {
    if (actionId === "logs.only-errors") {
      toggleLogOnlyErrors();
    }
  }

  return {
    hydrated,
    bootstrapping,
    queueRunning,
    queueBusy,
    createTaskOpen,
    importCookieOpen,
    logOnlyErrors,
    progressTick,
    tasks,
    cookies,
    logs,
    queueConfig,
    visibleLogs,
    notice,
    pendingActionIds,
    activeTaskIds,
    clearNotice,
    toggleLogOnlyErrors,
    openCreateTask,
    closeCreateTask,
    openImportCookie,
    closeImportCookie,
    createTasks,
    importCookie,
    startDoubanLoginImport,
    deleteCookie,
    retryTask,
    pauseTask,
    resumeTask,
    deleteTask,
    openTaskOutputDirectory,
    clearQueueTasks,
    clearAllLogs,
    triggerAction,
    isActionPending,
    bootstrap,
  };
});
