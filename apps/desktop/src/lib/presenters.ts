import type {
  CookieProfile,
  CookieStatus,
  SourceSite,
  StatusTone,
  TaskItem,
  TaskPhase,
} from "../types/app";
import { isDoubanEmptyCategoryTask } from "./douban-empty-category";

const sourceSiteLabels: Record<SourceSite, string> = {
  douban: "豆瓣",
};

const taskPhaseDescriptors: Record<TaskPhase, { label: string; tone: StatusTone }> = {
  queued: { label: "待处理", tone: "neutral" },
  resolving: { label: "解析详情页", tone: "warn" },
  discovering: { label: "发现图片中", tone: "warn" },
  downloading: { label: "下载中", tone: "good" },
  pausing: { label: "暂停中", tone: "warn" },
  paused: { label: "已暂停", tone: "neutral" },
  completed: { label: "已完成", tone: "good" },
  failed: { label: "失败待重试", tone: "danger" },
  retrying: { label: "重试中", tone: "warn" },
};

const cookieStatusDescriptors: Record<CookieStatus, { label: string; tone: StatusTone }> = {
  active: { label: "可用", tone: "good" },
  cooling: { label: "冷却中", tone: "warn" },
  testing: { label: "待测试", tone: "warn" },
};

const completeInferencePhases = new Set<TaskPhase>(["resolving", "discovering", "downloading", "retrying"]);

export function formatSourceSite(site: SourceSite) {
  return sourceSiteLabels[site];
}

export function formatTaskTitle(task: TaskItem) {
  return task.title;
}

export function isTaskDownloadComplete(task: TaskItem) {
  const download = task.download;
  return Boolean(
    completeInferencePhases.has(task.lifecycle.phase) &&
      download &&
      download.targetCount > 0 &&
      download.savedCount >= download.targetCount &&
      (task.outputDirectory || download.directory),
  );
}

export function formatTaskProgress(task: TaskItem) {
  if (!task.download?.targetCount) {
    return "-";
  }

  if (task.download.savedCount === 0) {
    return `-/${task.download.targetCount}`;
  }

  return `${task.download.savedCount}/${task.download.targetCount}`;
}

export function getTaskProgressPercent(task: TaskItem) {
  const download = task.download;
  if (!download?.targetCount) {
    return null;
  }

  const ratio = Math.min(download.savedCount / download.targetCount, 1);
  return Math.round(ratio * 100);
}

export function describeTaskStatus(task: TaskItem) {
  if (task.lifecycle.phase === "completed" || isTaskDownloadComplete(task)) {
    return taskPhaseDescriptors.completed;
  }

  if (isDoubanEmptyCategoryTask(task)) {
    return {
      label: "暂无内容",
      tone: "neutral" as const,
    };
  }

  return taskPhaseDescriptors[task.lifecycle.phase];
}

export function describeQueueAction(task: TaskItem) {
  if (task.lifecycle.phase === "completed" || isTaskDownloadComplete(task)) {
    return {
      label: "完成",
      action: "none" as const,
      disabled: true,
    };
  }

  if (task.lifecycle.phase === "paused") {
    return {
      label: "继续",
      action: "resume" as const,
      disabled: false,
    };
  }

  if (task.lifecycle.phase === "pausing") {
    return {
      label: "暂停中",
      action: "none" as const,
      disabled: true,
    };
  }

  if (
    task.lifecycle.phase === "resolving" ||
    task.lifecycle.phase === "discovering" ||
    task.lifecycle.phase === "downloading" ||
    task.lifecycle.phase === "retrying"
  ) {
    return {
      label: "暂停",
      action: "pause" as const,
      disabled: false,
    };
  }

  return {
    label: "重试",
    action: "retry" as const,
    disabled: false,
  };
}

export function describeCookieStatus(cookie: CookieProfile) {
  return cookieStatusDescriptors[cookie.status];
}

export function formatCookieExpiry(cookie: CookieProfile) {
  if (!cookie.expiresAt) {
    return "未设置";
  }

  return cookie.expiresAt.replace("T", " ").replace(/\.\d+Z$/, "");
}

export function formatTaskOrigin(task: TaskItem) {
  try {
    const url = new URL(task.target.detailUrl);
    return url.hostname.replace(/^www\./, "");
  } catch {
    return "无效链接";
  }
}
