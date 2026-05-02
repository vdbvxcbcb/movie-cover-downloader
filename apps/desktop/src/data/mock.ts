import type {
  AppSeedState,
  LogEntry,
  NavItem,
  QueueConfig,
  TaskDraft,
  TaskItem,
} from "../types/app";

const baseDay = "2026-04-28";
const schemaVersion = 2;

function atTime(time: string) {
  return `${baseDay} ${time}`;
}

function currentStamp() {
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

export function createTaskFromDraft(id: string, draft: TaskDraft): TaskItem {
  return {
    id,
    title: "待解析标题",
    target: {
      detailUrl: draft.detailUrl,
      outputRootDir: draft.outputRootDir,
      sourceHint: draft.sourceHint,
      doubanAssetType: draft.doubanAssetType,
      imageCountMode: draft.imageCountMode,
      maxImages: draft.maxImages,
      outputImageFormat: draft.outputImageFormat,
      requestIntervalSeconds: draft.requestIntervalSeconds,
    },
    lifecycle: {
      phase: "queued",
      attempts: 0,
      updatedAt: currentStamp(),
    },
    summary: "新链接任务已入队，等待解析详情页与图片页",
  };
}

export const navItems: NavItem[] = [
  { label: "控制中心", to: "/control", eyebrow: "Control" },
  { label: "日志中心", to: "/logs", eyebrow: "Logs" },
];

export const defaultQueueConfig: QueueConfig = {
  batchSize: 4,
  concurrency: 2,
  failureCooldownMs: 10_000,
  maxAttempts: 3,
};

const initialTasks: TaskItem[] = [];

const initialLogs: LogEntry[] = [
  {
    id: 1,
    level: "INFO",
    scope: "bootstrap",
    timestamp: atTime("21:18:02"),
    message: "应用已就绪，等待添加链接任务",
  },
];

export function createInitialAppSeed(): AppSeedState {
  return {
    schemaVersion,
    tasks: structuredClone(initialTasks),
    cookies: [],
    logs: structuredClone(initialLogs),
    queueConfig: structuredClone(defaultQueueConfig),
  };
}
