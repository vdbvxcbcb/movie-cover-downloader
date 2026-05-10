// Pinia 核心状态仓库：集中管理任务队列、Cookie、日志、持久化和下载调度。
import { computed, ref } from "vue";
import { defineStore } from "pinia";
import { createInitialAppSeed, createTaskFromDraft } from "../data/mock";
import { extractDoubanEmptyCategoryTitle, formatDoubanAssetTypeLabel } from "../lib/douban-empty-category";
import { runTaskLifecycle } from "../lib/queue-runtime";
import { runtimeBridge } from "../lib/runtime-bridge";
import { compareTaskAddedOrder } from "../lib/task-order";
import {
  formatDetailUrlDisplayLine,
  normalizeComparableDetailUrl,
} from "../lib/task-draft-input";
import type {
  AppSeedState,
  CookieDraft,
  CookieMutation,
  CookieProfile,
  DoubanMoviePreview,
  NoticePayload,
  QueueConfig,
  RuntimeDownloadTaskResult,
  RuntimeTaskProgressEvent,
  TaskDraft,
  TaskItem,
} from "../types/app";

// 队列阶段集合按行为能力分组：能运行、能恢复、能暂停、以及进度不应再被覆盖的终态。
const runnablePhases = new Set(["queued", "retrying"]);
const resumablePhases = new Set(["resolving", "discovering", "downloading"]);
const pausablePhases = new Set(["resolving", "discovering", "downloading", "retrying"]);
const terminalProgressPhases = new Set(["completed", "failed", "paused"]);
const cookieRetentionMs = 30 * 24 * 60 * 60 * 1000;
const retainedRuntimeLogCount = 200;

// store 内部等待工具，用于队列冷却、登录窗口轮询等异步等待场景。
const wait = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));
const resolvedTitleLogPrefix = "片名已解析: ";
const discoveredImagesLogPattern = /^(?:\[[^\]]+\]\s*)?discovered\s+(\d+)\s+images\s+from\s+\S+\s+->\s+(.+)$/i;
const savedImageLogPattern = /^(?:\[[^\]]+\]\s*)?saved image:\s*(.+)$/i;

interface CreateTasksOptions {
  replacementTaskIds?: string[];
}

// 生成任务、日志和 Cookie 记录使用的当前本地时间字符串。
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

// 通过 JSON 深拷贝去掉 Vue 响应式代理，得到可安全持久化的普通对象。
function clonePersistable<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

// 重新载入本地快照时会裁剪日志并修正重复 id，避免旧数据导致 Vue 列表 key 冲突。
function normalizeSnapshotLogs(logs: AppSeedState["logs"]) {
  const nextLogs = clonePersistable(logs.slice(0, retainedRuntimeLogCount));
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

// 把持久化异常压缩成适合 toast 展示的短提示。
function buildPersistErrorNotice(message: string) {
  const compactMessage = message.replace(/\s+/g, " ").trim().slice(0, 120);
  return compactMessage ? `本地持久化保存失败：${compactMessage}` : "本地持久化保存失败";
}

// 把当前 store 状态组装成持久化快照，Rust 会按这个结构写入 SQLite。
function toSnapshot(
  tasks: TaskItem[],
  cookies: CookieProfile[],
  logs: AppSeedState["logs"],
  queueConfig: QueueConfig,
  createTaskOutputRootDir: string,
  imageProcessOutputRootDir: string,
): AppSeedState {
  return {
    schemaVersion: 2,
    tasks: clonePersistable(tasks),
    cookies: clonePersistable(cookies),
    logs: normalizeSnapshotLogs(logs),
    queueConfig: clonePersistable(queueConfig),
    createTaskOutputRootDir,
    imageProcessOutputRootDir,
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
        imageAspectRatio: task.target.imageAspectRatio ?? "original",
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

// 根据任务 sourceHint 推断站点来源；auto 目前默认按豆瓣处理。
function inferTaskSource(task: TaskItem) {
  if (task.target.sourceHint !== "auto") {
    return task.target.sourceHint;
  }

  return "douban";
}

// 从完整路径中提取文件名，用于 download.files 列表。
function fileNameFromPath(filePath: string) {
  return filePath.split(/[/\\]/).pop() ?? filePath;
}

// 为自动登录导入的 Cookie 生成备注，方便用户区分导入来源和时间。
function buildAutoImportedCookieNote() {
  return `豆瓣登录导入 ${timestampNow()}`;
}

// 从 sidecar 片名解析日志中提取影片标题，用于实时更新任务标题。
function extractResolvedTitleFromLogMessage(message: string) {
  if (!message.startsWith(resolvedTitleLogPrefix)) {
    return null;
  }

  const title = message.slice(resolvedTitleLogPrefix.length).trim();
  return title || null;
}

// 从 discovered images 日志中提取图片总数和输出目录，用于初始化进度分母。
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

// 从 saved image 日志中提取已保存图片路径，用作进度事件兜底。
function extractSavedImagePathFromLogMessage(message: string) {
  const match = savedImageLogPattern.exec(message.trim());
  if (!match) {
    return null;
  }

  const outputPath = match[1]?.trim();
  return outputPath || null;
}

// 比较目录时统一去掉结尾斜杠并转小写，避免 Windows 路径大小写差异。
function normalizeComparablePath(path: string) {
  return path.trim().replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
}

function isSameTaskTarget(task: TaskItem, draft: TaskDraft) {
  return (
    normalizeComparableDetailUrl(task.target.detailUrl) === normalizeComparableDetailUrl(draft.detailUrl) &&
    normalizeComparablePath(task.target.outputRootDir) === normalizeComparablePath(draft.outputRootDir) &&
    task.target.doubanAssetType === draft.doubanAssetType &&
    task.target.imageAspectRatio === draft.imageAspectRatio
  );
}

// 找出任务真正生成的子输出目录；如果只是输出根目录则拒绝作为删除目标。
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

// 从图片完整路径中提取所在目录，用于补齐任务 outputDirectory。
function directoryFromFilePath(filePath: string) {
  const separatorIndex = Math.max(filePath.lastIndexOf("/"), filePath.lastIndexOf("\\"));
  if (separatorIndex === -1) {
    return null;
  }

  return filePath.slice(0, separatorIndex);
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

// 根据失败消息判断是否需要让当前豆瓣 Cookie 冷却，降低连续风控风险。
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

// 判断错误是否属于豆瓣登录失效或未登录，便于提示用户重新导入 Cookie。
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

// 豆瓣失败会按用户可理解的原因分类，决定是否冷却 Cookie 和展示什么提示。
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

// 失败时尽量保留已解析片名；空分类错误也可以从消息里提取片名。
function resolveFailureTaskTitle(message: string, task: TaskItem) {
  if (task.title !== "待解析标题") {
    return task.title;
  }

  return extractDoubanEmptyCategoryTitle(message) ?? task.title;
}

// 为新导入 Cookie 生成导入时间和默认过期时间。
function createCookieLifetime(baseTime = Date.now()) {
  return {
    importedAt: new Date(baseTime).toISOString(),
    expiresAt: new Date(baseTime + cookieRetentionMs).toISOString(),
  };
}

// 清理过期 Cookie，并补齐缺失或非法的导入/过期时间。
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

// 组合式 store 保留所有业务状态，外部组件只通过这里暴露的动作修改队列。
export const useAppStore = defineStore("app", () => {
  const seed = createInitialAppSeed();

  const hydrated = ref(false);
  const bootstrapping = ref(false);
  const queueRunning = ref(false);
  const queueBusy = ref(false);
  const createTaskOpen = ref(false);
  const createTaskDetailUrls = ref("");
  const createTaskOutputRootDir = ref("");
  const createTaskMoviePreviews = ref<Record<string, Partial<DoubanMoviePreview>>>({});
  const importCookieOpen = ref(false);
  const searchMovieOpen = ref(false);
  const customCropOpen = ref(false);
  const imageProcessOpen = ref(false);
  const imageProcessOutputRootDir = ref("");
  const logOnlyErrors = ref(false);
  const progressTick = ref(0);
  const tasks = ref<TaskItem[]>(seed.tasks);
  const cookies = ref<CookieProfile[]>(seed.cookies);
  const logs = ref(seed.logs);
  const queueConfig = ref<QueueConfig>(seed.queueConfig);
  const notice = ref<NoticePayload | null>(null);
  const pendingActionIds = ref<string[]>([]);
  const activeTaskIds = ref<string[]>([]);
  // 自定义裁剪默认保存到最近任务的输出根目录；没有任务时回退 D:/cover。
  const customCropOutputRootDir = computed(() => createTaskOutputRootDir.value || "D:/cover");

  let persistenceTimer: number | null = null;
  let logPersistenceTimer: number | null = null;
  let taskIdSequence = 0;
  let cookieIdSequence = 299;
  let persistInFlight: Promise<void> | null = null;
  let persistRerunRequested = false;

  // 用不可变数组替换单个任务，确保 Vue 能可靠触发列表更新。
  function replaceTaskAtIndex(taskIndex: number, nextTask: TaskItem) {
    tasks.value = tasks.value.map((task, index) => (index === taskIndex ? nextTask : task));
  }

  // 进度事件是下载实时更新的主路径：每保存一张图片都会推进 savedCount 和进度条。
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

  // 日志解析是实时进度的兜底路径：解析片名、发现数量和 saved image 日志都能反推任务状态。
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

  // 批量处理日志带来的任务状态变化，最后只触发一次持久化调度。
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

  // 日志采用批量监听，降低高频下载日志导致的界面和持久化压力。
  void runtimeBridge.onRuntimeLogBatch((entries) => {
    if (entries.length === 0) return;
    applyRuntimeLogTaskUpdates(entries);
    logs.value = [...entries.slice().reverse(), ...logs.value].slice(0, retainedRuntimeLogCount);
    schedulePersist("logs");
  });

  void runtimeBridge.onTaskProgress((event) => {
    applyTaskProgressUpdate(event);
  });

  // 日志中心可见日志：按“仅错误”开关过滤，并隐藏内部 task-progress 兜底日志。
  const visibleLogs = computed(() =>
    (logOnlyErrors.value ? logs.value.filter((entry) => entry.level === "ERROR") : logs.value).filter(
      (entry) => entry.scope !== "task-progress",
    ),
  );

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
              tasks.value,
              cookies.value,
              logs.value,
              queueConfig.value,
              createTaskOutputRootDir.value,
              imageProcessOutputRootDir.value,
            ),
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

  // 延迟保存状态：普通状态短防抖，日志保存稍长合并，减少 SQLite 写入频率。
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

  // 把链接草稿拆成去空白后的展示行，搜索弹窗和新增任务弹窗共用这份草稿。
  function getCreateTaskDetailUrlLines() {
    return createTaskDetailUrls.value
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
  }

  // 同步新增链接任务弹窗中的详情页链接文本。
  function syncCreateTaskDetailUrls(value: string) {
    createTaskDetailUrls.value = value;
  }

  // 同步新增链接任务弹窗中的输出根目录，供自定义裁剪复用。
  function syncCreateTaskOutputRootDir(value: string) {
    const nextValue = value.trim();
    if (createTaskOutputRootDir.value === nextValue) return;
    createTaskOutputRootDir.value = nextValue;
    schedulePersist();
  }

  function syncImageProcessOutputRootDir(value: string) {
    const nextValue = value.trim();
    if (imageProcessOutputRootDir.value === nextValue) return;
    imageProcessOutputRootDir.value = nextValue;
    schedulePersist();
  }

  function getCreateTaskMoviePreview(detailUrl: string) {
    return createTaskMoviePreviews.value[normalizeComparableDetailUrl(detailUrl)];
  }

  function upsertCreateTaskMoviePreview(detailUrl: string, preview: Partial<DoubanMoviePreview>) {
    const key = normalizeComparableDetailUrl(detailUrl);
    if (!key) return;

    createTaskMoviePreviews.value = {
      ...createTaskMoviePreviews.value,
      [key]: {
        ...createTaskMoviePreviews.value[key],
        ...preview,
        detailUrl: preview.detailUrl ?? detailUrl.trim(),
      },
    };
  }

  // 判断搜索结果中的详情页链接是否已经加入新增任务草稿；比较时只看 URL，不看显示片名。
  function hasCreateTaskDetailUrl(detailUrl: string) {
    const normalized = normalizeComparableDetailUrl(detailUrl);
    return getCreateTaskDetailUrlLines().some((line) => normalizeComparableDetailUrl(line) === normalized);
  }

  // 从搜索结果添加一条豆瓣详情页链接；文本框显示“片名：链接”，后续提交仍只提取链接。
  function addCreateTaskDetailUrl(detailUrl: string, title?: string | null, preview?: Partial<DoubanMoviePreview>) {
    const normalized = detailUrl.trim();
    if (!normalized || hasCreateTaskDetailUrl(normalized)) {
      return false;
    }

    createTaskDetailUrls.value = [
      ...getCreateTaskDetailUrlLines(),
      formatDetailUrlDisplayLine(normalized, title ?? preview?.title),
    ].join("\n");
    upsertCreateTaskMoviePreview(normalized, { ...preview, title: title ?? preview?.title ?? "" });
    return true;
  }

  // 从新增任务草稿中删除一条链接，供搜索结果行里的删除按钮调用。
  function removeCreateTaskDetailUrl(detailUrl: string) {
    const normalized = normalizeComparableDetailUrl(detailUrl);
    const currentLines = getCreateTaskDetailUrlLines();
    const nextLines = currentLines.filter((line) => normalizeComparableDetailUrl(line) !== normalized);
    const changed = nextLines.length !== currentLines.length;
    const { [normalized]: _removedPreview, ...remainingPreviews } = createTaskMoviePreviews.value;
    createTaskDetailUrls.value = nextLines.join("\n");
    createTaskMoviePreviews.value = remainingPreviews;
    return changed;
  }
  // 设置全局 toast 提示，供界面右上角统一展示反馈。
  function showNotice(message: string, tone: NoticePayload["tone"] = "info") {
    notice.value = { message, tone };
  }

  // 清除当前 toast，通常由用户点击关闭触发。
  function clearNotice() {
    notice.value = null;
  }

  // 切换日志中心“仅错误”过滤，也支持显式设置为开或关。
  function toggleLogOnlyErrors(force?: boolean) {
    logOnlyErrors.value = typeof force === "boolean" ? force : !logOnlyErrors.value;
  }

  // 打开新增链接任务弹窗。
  function openCreateTask() {
    createTaskOpen.value = true;
  }

  // 关闭新增链接任务弹窗。
  function closeCreateTask() {
    createTaskOpen.value = false;
  }

  // 打开 Cookie 导入弹窗。
  function openImportCookie() {
    importCookieOpen.value = true;
  }

  // 关闭 Cookie 导入弹窗。
  function closeImportCookie() {
    importCookieOpen.value = false;
  }

  // 打开豆瓣影片搜索弹窗。
  function openSearchMovie() {
    searchMovieOpen.value = true;
  }

  // 关闭豆瓣影片搜索弹窗。
  function closeSearchMovie() {
    searchMovieOpen.value = false;
  }
  // 打开自定义裁剪弹窗。
  function openCustomCrop() {
    customCropOpen.value = true;
  }

  // 关闭自定义裁剪弹窗。
  function closeCustomCrop() {
    customCropOpen.value = false;
  }

  function openImageProcess() {
    imageProcessOpen.value = true;
  }

  function closeImageProcess() {
    imageProcessOpen.value = false;
  }

  // 判断某个异步动作是否执行中，用于按钮 loading/disabled 状态。
  function isActionPending(actionId: string) {
    return pendingActionIds.value.includes(actionId);
  }

  // 按 taskId 替换任务，供浏览器演示流程和真实下载流程复用。
  function replaceTask(nextTask: TaskItem) {
    const index = tasks.value.findIndex((task) => task.id === nextTask.id);
    if (index === -1) return;
    replaceTaskAtIndex(index, nextTask);
    schedulePersist();
  }

  // 根据 id 查找当前最新任务快照，避免异步流程使用过期对象。
  function getTaskById(taskId: string) {
    return tasks.value.find((task) => task.id === taskId);
  }

  function findDuplicateTasksForDrafts(drafts: TaskDraft[]) {
    const duplicateTaskIds = new Set<string>();
    const duplicateTasks: TaskItem[] = [];

    for (const draft of drafts) {
      const duplicateTask = tasks.value.find((task) => isSameTaskTarget(task, draft));
      if (!duplicateTask || duplicateTaskIds.has(duplicateTask.id)) continue;

      duplicateTaskIds.add(duplicateTask.id);
      duplicateTasks.push(duplicateTask);
    }

    return duplicateTasks;
  }

  // 删除/清空队列只需要避开仍在真实执行的任务；已进入 paused 的任务允许取消并清理。
  const queueHasActiveDownloads = computed(() =>
    activeTaskIds.value.some((taskId) => {
      const task = getTaskById(taskId);
      return task ? task.lifecycle.phase !== "paused" : false;
    }),
  );

  // 应用浏览器演示运行时返回的 Cookie 成功/失败/冷却变更。
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

  // 生成新的任务 id，同时扫描已有任务避免重启后 id 冲突。
  function nextTaskId() {
    taskIdSequence += 1;
    return `task-${Date.now()}-${taskIdSequence}`;
  }

  // 生成新的 Cookie id，保持导入列表的编号递增。
  function nextCookieId() {
    const maxExistingId = cookies.value.reduce((maxId, cookie) => {
      const numericId = Number(cookie.id);
      return Number.isInteger(numericId) ? Math.max(maxId, numericId) : maxId;
    }, 299);

    cookieIdSequence = Math.max(cookieIdSequence, maxExistingId) + 1;
    return String(cookieIdSequence);
  }

  // 为豆瓣任务选择一个未过期、未冷却的 Cookie；其他来源不需要 Cookie。
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

  // 根据 sidecar 最终结果构造完成态任务，写入输出目录、文件列表和进度终值。
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
      const task = tasks.value.find((item) => item.id === taskId);
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

  // 通过 runtimeBridge 写运行日志，桌面端会由 Rust 统一发回日志事件。
  async function emitLog(level: "INFO" | "WARN" | "ERROR", scope: string, message: string, taskId?: string) {
    await runtimeBridge.emitLog({ level, scope, message, taskId });
  }

  // 应用启动恢复入口：读取本地快照、恢复任务状态、清理过期 Cookie。
  async function bootstrap() {
    if (hydrated.value || bootstrapping.value) return;

    bootstrapping.value = true;
    let cookiesChanged = false;
    try {
      try {
        const snapshot = await runtimeBridge.loadState();
        if (snapshot) {
          tasks.value = rehydrateTasks(snapshot.tasks);
          const latestTask = tasks.value[tasks.value.length - 1];
          if (Object.prototype.hasOwnProperty.call(snapshot, "createTaskOutputRootDir")) {
            createTaskOutputRootDir.value = snapshot.createTaskOutputRootDir?.trim() ?? "";
          } else if (latestTask?.target.outputRootDir) {
            createTaskOutputRootDir.value = latestTask.target.outputRootDir;
          }
          imageProcessOutputRootDir.value = snapshot.imageProcessOutputRootDir?.trim() ?? "";
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

    if (promoted > 0) {
      schedulePersist();
      void emitLog("INFO", "queue", `失败冷却结束: ${promoted} 个任务恢复可重试状态`);
    }
  }

  // 后台执行顺序独立于界面排序：这里按添加时间正序挑选任务，保证旧任务先处理。
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

  // 浏览器预览模式下执行模拟任务生命周期，不触碰本地文件系统。
  async function runBrowserTask(task: TaskItem) {
    for await (const frame of runTaskLifecycle(task, cookies.value, queueConfig.value)) {
      replaceTask(frame.task);
      applyCookieMutations(frame.cookieMutations);

      if (!queueRunning.value) {
        break;
      }
    }
  }

  // 桌面端真实任务由 Tauri 拉起 sidecar；前端只负责传入任务参数并接收最终结果。
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
        imageAspectRatio: task.target.imageAspectRatio,
        requestIntervalSeconds: task.target.requestIntervalSeconds,
        doubanCookie: cookie?.value,
      });

      const latestTask = getTaskById(task.id);
      if (!latestTask) {
        return;
      }

      replaceTask(buildCompletedTask(latestTask, result, attempts));
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

  // 处理单个任务：登记 activeTaskIds，并按运行环境选择真实下载或浏览器模拟。
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

  // 队列排水循环会持续拉取可运行批次，直到无任务、冷却等待或用户停止队列。
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
          const latestTask = getTaskById(task.id);
          if (!latestTask || !runnablePhases.has(latestTask.lifecycle.phase) || activeTaskIds.value.includes(latestTask.id)) {
            continue;
          }

          const runner = processTask(latestTask).finally(() => {
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

  // 包装异步动作，防止同一个按钮或操作被重复点击并发执行。
  async function withPending<T>(actionId: string, run: () => Promise<T>) {
    if (isActionPending(actionId)) return null;
    pendingActionIds.value = [...pendingActionIds.value, actionId];
    try {
      return await run();
    } finally {
      pendingActionIds.value = pendingActionIds.value.filter((item) => item !== actionId);
    }
  }

  // 批量创建链接任务，写日志、关闭弹窗，并自动启动队列。
  async function createTasks(drafts: TaskDraft[], options: CreateTasksOptions = {}) {
    await withPending("queue.create-task", async () => {
      syncCreateTaskOutputRootDir(drafts[0]?.outputRootDir ?? createTaskOutputRootDir.value);
      const replacementTaskIds = new Set(options.replacementTaskIds ?? []);
      const replacementTasks = tasks.value.filter((task) => replacementTaskIds.has(task.id));
      const replacementOutputDirectories = replacementTasks.flatMap((task) => {
        const outputDirectory = getTaskGeneratedOutputDirectory(task);
        return outputDirectory ? [outputDirectory] : [];
      });
      const createdTasks = drafts.map((draft) => {
        const preview = getCreateTaskMoviePreview(draft.detailUrl);
        return createTaskFromDraft(nextTaskId(), {
          ...draft,
          coverUrl: draft.coverUrl ?? preview?.coverUrl,
          coverDataUrl: draft.coverDataUrl ?? preview?.coverDataUrl,
        });
      });

      if (replacementTaskIds.size > 0) {
        await runtimeBridge.clearDownloadTasks(Array.from(replacementTaskIds));
        for (const outputDirectory of replacementOutputDirectories) {
          await runtimeBridge.clearDirectoryContents(outputDirectory.directoryPath, outputDirectory.rootDirectoryPath);
        }
        activeTaskIds.value = activeTaskIds.value.filter((taskId) => !replacementTaskIds.has(taskId));
      }

      tasks.value = [...tasks.value.filter((task) => !replacementTaskIds.has(task.id)), ...createdTasks];
      schedulePersist();
      await emitLog(
        replacementTaskIds.size > 0 ? "WARN" : "INFO",
        "command",
        replacementTaskIds.size > 0
          ? `已覆盖重复任务 ${replacementTaskIds.size} 个，并新增链接任务 ${createdTasks.length} 个 -> ${drafts[0]?.outputRootDir ?? ""}`
          : `新增链接任务 ${createdTasks.length} 个 -> ${drafts[0]?.outputRootDir ?? ""} / 并发 ${queueConfig.value.concurrency}`,
      );
      showNotice(
        replacementTaskIds.size > 0
          ? `已覆盖 ${replacementTaskIds.size} 个旧任务并重新加入队列`
          : createdTasks.length > 1
            ? `已新增 ${createdTasks.length} 个链接任务`
            : "已新增链接任务",
        "success",
      );
      createTaskOpen.value = false;
      createTaskDetailUrls.value = "";
      createTaskMoviePreviews.value = {};
      queueRunning.value = true;
      void drainQueue();
    });
  }

  // 手动重试失败任务：重置任务状态并重新启动队列循环。
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

  // 请求暂停任务：先把界面切到 pausing，再通知 Tauri/sidecar 暂停。
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

  // 继续暂停任务：通知 Tauri 清除暂停状态，并把任务放回 retrying。
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

  // 删除单个任务，同时取消后台进程并删除该任务生成的输出目录。
  async function deleteTask(taskId: string) {
    await withPending(`queue.delete.${taskId}`, async () => {
      const task = tasks.value.find((item) => item.id === taskId);
      if (activeTaskIds.value.includes(taskId) && task?.lifecycle.phase !== "paused") {
        showNotice("任务下载中，不能删除任务", "warn");
        return;
      }

      const outputDirectory = task ? getTaskGeneratedOutputDirectory(task) : null;

      if (runtimeBridge.isNativeRuntime() && task) {
        await runtimeBridge.clearDownloadTasks([taskId]);
        if (outputDirectory) {
          await runtimeBridge.deleteDirectoryPath(outputDirectory.directoryPath, outputDirectory.rootDirectoryPath);
        }
      }

      tasks.value = tasks.value.filter((item) => item.id !== taskId);
      activeTaskIds.value = activeTaskIds.value.filter((item) => item !== taskId);
      progressTick.value += 1;
      schedulePersist();
      await emitLog(
        "WARN",
        "queue",
        outputDirectory
          ? `任务已删除并清理输出目录: ${outputDirectory.directoryPath}`
          : `任务已删除: ${task?.target.detailUrl ?? taskId}`,
        taskId,
      );
      showNotice("任务已删除", "warn");
    });
  }

  // 清空队列时移除记录、取消后台任务，并清空这些任务所属输出根目录下的所有内容。
  async function clearQueueTasks() {
    if (queueHasActiveDownloads.value) {
      showNotice("队列下载中，不能清空队列任务", "warn");
      return;
    }

    if (tasks.value.length === 0) {
      showNotice("当前队列为空", "info");
      return;
    }

    await withPending("queue.clear-all", async () => {
      const count = tasks.value.length;
      const taskIds = tasks.value.map((task) => task.id);
      const outputRootDirectories = Array.from(
        new Set(tasks.value.map((task) => task.target.outputRootDir.trim()).filter(Boolean)),
      );
      queueRunning.value = false;

      if (runtimeBridge.isNativeRuntime() && taskIds.length > 0) {
        await runtimeBridge.clearDownloadTasks(taskIds);
        for (const outputRootDir of outputRootDirectories) {
          await runtimeBridge.clearDirectoryContents(outputRootDir, outputRootDir);
        }
      }

      activeTaskIds.value = [];
      tasks.value = [];
      progressTick.value += 1;
      schedulePersist();
      await emitLog("WARN", "queue", `队列任务已清空: ${count} 个，输出目录内容已清理: ${outputRootDirectories.join(", ")}`);
      showNotice(count > 0 ? `已清空 ${count} 个队列任务并清理输出目录` : "当前队列为空", count > 0 ? "warn" : "info");
    });
  }
  // 导入 Cookie：无草稿时只打开弹窗，有草稿时保存 Cookie 并写日志。
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

  // 自动登录导入 Cookie：打开豆瓣登录窗口，轮询 Cookie，成功后保存并关闭窗口。
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

  // 删除 Cookie 列表中的一条记录，并持久化状态。
  async function deleteCookie(cookieId: string) {
    await withPending(`cookies.delete.${cookieId}`, async () => {
      cookies.value = cookies.value.filter((cookie) => cookie.id !== cookieId);
      schedulePersist();
      await emitLog("WARN", "cookie", `Cookie 已删除 #${cookieId}`);
      showNotice(`已删除 Cookie #${cookieId}`, "warn");
    });
  }

  // 清空日志中心的全部可见日志，并立即保存状态。
  async function clearAllLogs() {
    await withPending("logs.clear-all", async () => {
      logs.value = [];
      await persistState();
      showNotice("全部日志已清空", "success");
    });
  }

  // 打开已完成任务的输出目录，未完成或无目录时忽略。
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

  // 顶栏通用 action 分发入口，目前用于日志中心的错误过滤切换。
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
    createTaskDetailUrls,
    createTaskOutputRootDir,
    importCookieOpen,
    searchMovieOpen,
    customCropOpen,
    imageProcessOpen,
    imageProcessOutputRootDir,
    logOnlyErrors,
    progressTick,
    tasks,
    cookies,
    logs,
    queueConfig,
    visibleLogs,
    customCropOutputRootDir,
    notice,
    pendingActionIds,
    activeTaskIds,
    queueHasActiveDownloads,
    clearNotice,
    showNotice,
    syncCreateTaskDetailUrls,
    syncCreateTaskOutputRootDir,
    syncImageProcessOutputRootDir,
    addCreateTaskDetailUrl,
    upsertCreateTaskMoviePreview,
    getCreateTaskMoviePreview,
    removeCreateTaskDetailUrl,
    hasCreateTaskDetailUrl,
    findDuplicateTasksForDrafts,
    toggleLogOnlyErrors,
    openCreateTask,
    closeCreateTask,
    openImportCookie,
    openSearchMovie,
    closeImportCookie,
    closeSearchMovie,
    openCustomCrop,
    closeCustomCrop,
    openImageProcess,
    closeImageProcess,
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


