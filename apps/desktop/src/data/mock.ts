// 前端初始数据工厂：生产干净启动状态和从表单草稿转换出的任务。
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

// 用固定日期拼接时间，主要服务初始日志和测试数据。
function atTime(time: string) {
  return `${baseDay} ${time}`;
}

// 生成当前本地时间戳，用于新建任务的 updatedAt。
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

// 把新增任务弹窗的草稿转换成队列任务实体，并填充默认生命周期和摘要。
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
      imageAspectRatio: draft.imageAspectRatio,
      requestIntervalSeconds: draft.requestIntervalSeconds,
    },
    lifecycle: {
      phase: "queued",
      attempts: 0,
      updatedAt: currentStamp(),
    },
    summary: "新链接任务已入队，等待解析详情页与图片页",
    coverUrl: draft.coverUrl,
    coverDataUrl: draft.coverDataUrl,
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

// 生成应用初始状态；真实启动后会被本地持久化快照覆盖。
export function createInitialAppSeed(): AppSeedState {
  return {
    schemaVersion,
    tasks: structuredClone(initialTasks),
    cookies: [],
    logs: structuredClone(initialLogs),
    queueConfig: structuredClone(defaultQueueConfig),
  };
}
