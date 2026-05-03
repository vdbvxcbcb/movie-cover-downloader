import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import type {
  AppSeedState,
  DoubanLoginImportStatus,
  LogEntry,
  RuntimeDownloadTaskPayload,
  RuntimeDownloadTaskResult,
  RuntimeTaskProgressEvent,
} from "../types/app";

const storageKey = "movie-cover-downloader.runtime-state";
const browserEventName = "movie-cover-downloader:runtime-log";

interface RuntimeLogPayload {
  id?: number;
  level: LogEntry["level"];
  scope: string;
  timestamp?: string;
  message: string;
  taskId?: string;
}

interface NativeLoginWindowCookieStatus {
  status: "pending" | "ready" | "closed";
  cookie?: string;
}

interface RuntimeTaskProgressPayload {
  taskId: string;
  phase: RuntimeTaskProgressEvent["phase"];
  targetCount: number;
  savedCount: number;
  timestamp?: string | number;
}

const timestampFormatter = new Intl.DateTimeFormat("zh-CN", {
  hour12: false,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

let browserLogSeed = 4_000;

function isTauriRuntime() {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

function nowStamp() {
  return timestampFormatter.format(new Date()).replace(/\//g, "-");
}

function normalizeLog(payload: RuntimeLogPayload): LogEntry {
  const rawTimestamp = payload.timestamp ?? nowStamp();
  const numericTimestamp = Number(rawTimestamp);
  const timestamp =
    Number.isFinite(numericTimestamp) && rawTimestamp.trim() !== ""
      ? nowStampFromEpoch(numericTimestamp)
      : rawTimestamp;

  return {
    id: payload.id ?? ++browserLogSeed,
    level: payload.level,
    scope: payload.scope,
    timestamp,
    message: payload.message,
    taskId: payload.taskId,
  };
}

function nowStampFromEpoch(epoch: number) {
  return timestampFormatter.format(new Date(epoch)).replace(/\//g, "-");
}

function normalizeTaskProgress(payload: RuntimeTaskProgressPayload): RuntimeTaskProgressEvent {
  const rawTimestamp = payload.timestamp ?? nowStamp();
  const numericTimestamp = Number(rawTimestamp);
  const timestamp =
    Number.isFinite(numericTimestamp) && String(rawTimestamp).trim() !== ""
      ? nowStampFromEpoch(numericTimestamp)
      : String(rawTimestamp);

  return {
    taskId: payload.taskId,
    phase: payload.phase,
    targetCount: payload.targetCount,
    savedCount: payload.savedCount,
    timestamp,
  };
}

function flushEntries(queue: LogEntry[], listener: (entries: LogEntry[]) => void) {
  if (queue.length === 0) return;
  listener(queue.splice(0, queue.length));
}

function wait(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

// 运行桥负责和 Tauri command / event 对接；在纯网页模式下会自动退回到浏览器存储和本地事件。
class RuntimeBridge {
  isNativeRuntime() {
    return isTauriRuntime();
  }

  async loadState() {
    if (isTauriRuntime()) {
      const snapshot = await invoke<string | null>("load_persisted_state");
      if (!snapshot) return null;
      const parsed = JSON.parse(snapshot) as Partial<AppSeedState>;
      if (parsed.schemaVersion !== 2) return null;
      return parsed as AppSeedState;
    }

    const snapshot = window.localStorage.getItem(storageKey);
    if (!snapshot) return null;
    const parsed = JSON.parse(snapshot) as Partial<AppSeedState>;
    if (parsed.schemaVersion !== 2) return null;
    return parsed as AppSeedState;
  }

  async saveState(snapshot: AppSeedState) {
    const serialized = JSON.stringify(snapshot);

    if (isTauriRuntime()) {
      await invoke("save_persisted_state", {
        snapshotJson: serialized,
      });
      return;
    }

    window.localStorage.setItem(storageKey, serialized);
  }

  async emitLog(payload: RuntimeLogPayload) {
    if (isTauriRuntime()) {
      await invoke("emit_runtime_log", { payload });
      return;
    }

    window.dispatchEvent(
      new CustomEvent<LogEntry>(browserEventName, {
        detail: normalizeLog(payload),
      }),
    );
  }

  async openDirectoryPath(directoryPath: string) {
    if (isTauriRuntime()) {
      await invoke("open_directory_path", { directoryPath });
      return directoryPath;
    }

    return directoryPath;
  }

  async revealFilePath(filePath: string) {
    if (isTauriRuntime()) {
      await invoke("reveal_file_path", { filePath });
    }

    return filePath;
  }

  async pickOutputDirectory(initialPath?: string) {
    if (isTauriRuntime()) {
      return invoke<string | null>("pick_output_directory", { initialPath });
    }

    return window.prompt("请输入输出目录", initialPath ?? "D:/cover");
  }

  async runDownloadTask(payload: RuntimeDownloadTaskPayload) {
    if (!isTauriRuntime()) {
      throw new Error("真实下载仅在 Tauri 桌面环境可用");
    }

    const serialized = await invoke<string>("run_download_task", { payload });
    return JSON.parse(serialized) as RuntimeDownloadTaskResult;
  }

  async pauseDownloadTask(taskId: string) {
    if (isTauriRuntime()) {
      await invoke("pause_download_task", { taskId });
    }

    return taskId;
  }

  async resumeDownloadTask(taskId: string) {
    if (isTauriRuntime()) {
      await invoke("resume_download_task", { taskId });
    }

    return taskId;
  }

  async clearDownloadTasks(taskIds: string[]) {
    if (isTauriRuntime()) {
      return invoke<number>("clear_download_tasks", { taskIds });
    }

    return taskIds.length;
  }

  async deleteDirectoryPath(directoryPath: string, rootDirectoryPath: string) {
    if (isTauriRuntime()) {
      await invoke("delete_directory_path", { directoryPath, rootDirectoryPath });
    }

    return directoryPath;
  }

  async readLocalImageFile(filePath: string) {
    if (!isTauriRuntime()) {
      throw new Error("拖拽读取本地图片仅在 Tauri 桌面环境可用");
    }

    const bytes = await invoke<number[]>("read_local_image_file", { filePath });
    return new Uint8Array(bytes);
  }
  async saveCustomCroppedImage(outputRootDir: string, fileName: string, imageBytes: Uint8Array) {
    if (isTauriRuntime()) {
      return invoke<string>("save_custom_cropped_image", {
        outputRootDir,
        fileName,
        imageBytes: Array.from(imageBytes),
      });
    }

    const url = URL.createObjectURL(new Blob([imageBytes], { type: "image/png" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = fileName;
    anchor.click();
    URL.revokeObjectURL(url);
    return fileName;
  }
  async openDoubanLoginWindow(windowLabel: string) {
    if (!isTauriRuntime()) {
      throw new Error("豆瓣登录自动导入仅在 Tauri 桌面环境可用");
    }

    const existing = await WebviewWindow.getByLabel(windowLabel);
    if (existing) {
      await existing.clearAllBrowsingData().catch(() => undefined);
      await existing.destroy();
      await wait(120);
    }

    const loginWindow = new WebviewWindow(windowLabel, {
      url: "https://accounts.douban.com/passport/login?source=movie#",
      title: "豆瓣登录",
      width: 980,
      height: 760,
      center: true,
      resizable: true,
      incognito: true,
    });

    await new Promise<void>((resolve, reject) => {
      loginWindow.once("tauri://created", () => resolve());
      loginWindow.once("tauri://error", (error) => reject(error));
    });

    return windowLabel;
  }

  async inspectDoubanLoginWindow(windowLabel: string) {
    if (!isTauriRuntime()) {
      throw new Error("豆瓣登录自动导入仅在 Tauri 桌面环境可用");
    }

    const status = await invoke<NativeLoginWindowCookieStatus>("check_login_window_cookie_status", { windowLabel });
    return {
      state: status.status,
      cookieValue: status.cookie,
    } satisfies DoubanLoginImportStatus;
  }

  async closeDoubanLoginWindow(windowLabel: string) {
    if (!isTauriRuntime()) {
      return;
    }

    await invoke("close_login_window", { windowLabel });
  }

  async onRuntimeLogBatch(listener: (entries: LogEntry[]) => void) {
    if (isTauriRuntime()) {
      const queue: LogEntry[] = [];
      let flushTimer: number | null = null;

      const scheduleFlush = () => {
        if (flushTimer !== null) return;
        flushTimer = window.setTimeout(() => {
          flushTimer = null;
          flushEntries(queue, listener);
        }, 240);
      };

      const unlisten = await listen<RuntimeLogPayload>("runtime-log", (event) => {
        queue.push(normalizeLog(event.payload));
        if (queue.length >= 24) {
          if (flushTimer !== null) {
            window.clearTimeout(flushTimer);
            flushTimer = null;
          }
          flushEntries(queue, listener);
          return;
        }
        scheduleFlush();
      });

      return () => {
        if (flushTimer !== null) {
          window.clearTimeout(flushTimer);
          flushTimer = null;
        }
        flushEntries(queue, listener);
        void unlisten();
      };
    }

    const browserListener = (event: Event) => {
      listener([(event as CustomEvent<LogEntry>).detail]);
    };

    window.addEventListener(browserEventName, browserListener as EventListener);
    return () => window.removeEventListener(browserEventName, browserListener as EventListener);
  }

  async onTaskProgress(listener: (event: RuntimeTaskProgressEvent) => void) {
    if (isTauriRuntime()) {
      const unlisten = await listen<RuntimeTaskProgressPayload>("task-progress", (event) => {
        listener(normalizeTaskProgress(event.payload));
      });

      return () => {
        void unlisten();
      };
    }

    return () => {};
  }
}

export const runtimeBridge = new RuntimeBridge();

