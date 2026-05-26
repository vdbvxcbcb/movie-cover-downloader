import type {
  AppSeedState,
  CookieProfile,
  QueueConfig,
  TaskItem,
} from "../types/app";

export const retainedRuntimeLogCount = 200;

const resumablePhases = new Set(["resolving", "discovering", "downloading"]);
const resolvedTitleLogPrefix = "片名已解析: ";
const discoveredImagesLogPattern = /^(?:\[[^\]]+\]\s*)?discovered\s+(\d+)\s+images\s+from\s+\S+\s+->\s+(.+)$/i;
const savedImageLogPattern = /^(?:\[[^\]]+\]\s*)?saved image:\s*(.+)$/i;

export function timestampNow() {
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

export function buildPersistErrorNotice(message: string) {
  const compactMessage = message.replace(/\s+/g, " ").trim().slice(0, 120);
  return compactMessage ? `本地持久化保存失败：${compactMessage}` : "本地持久化保存失败";
}

export function toSnapshot(
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

export function rehydrateTasks(tasks: TaskItem[]) {
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

export function inferTaskSource(task: TaskItem) {
  if (task.target.sourceHint !== "auto") {
    return task.target.sourceHint;
  }

  return "douban";
}

export function fileNameFromPath(filePath: string) {
  return filePath.split(/[/\\]/).pop() ?? filePath;
}

export function buildAutoImportedCookieNote() {
  return `豆瓣登录导入 ${timestampNow()}`;
}

export function extractResolvedTitleFromLogMessage(message: string) {
  if (!message.startsWith(resolvedTitleLogPrefix)) {
    return null;
  }

  const title = message.slice(resolvedTitleLogPrefix.length).trim();
  return title || null;
}

export function extractDiscoveredDownloadSnapshotFromLogMessage(message: string) {
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

export function extractSavedImagePathFromLogMessage(message: string) {
  const match = savedImageLogPattern.exec(message.trim());
  if (!match) {
    return null;
  }

  const outputPath = match[1]?.trim();
  return outputPath || null;
}
