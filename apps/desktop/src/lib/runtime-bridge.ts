// 运行时桥接层：把前端调用统一转发到 Tauri 命令，网页预览时使用浏览器降级实现。
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import type {
  AppSeedState,
  DoubanLoginImportStatus,
  DoubanMoviePreview,
  DoubanSearchResultPage,
  LogEntry,
  RuntimeDownloadTaskPayload,
  RuntimeDownloadTaskResult,
  RuntimeTaskProgressEvent,
} from "../types/app";

// 浏览器预览模式使用 localStorage 和 DOM 事件，桌面模式使用 Tauri invoke/listen。
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

// 判断当前是否运行在 Tauri 桌面环境；网页预览模式没有 Tauri 内部对象。
function isTauriRuntime() {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

// 生成前端统一使用的中文本地时间字符串。
function nowStamp() {
  return timestampFormatter.format(new Date()).replace(/\//g, "-");
}

// Rust 和浏览器可能传入毫秒时间戳或格式化字符串，这里统一成界面展示格式。
// 把 Rust、sidecar 或浏览器传来的日志 payload 统一成前端 LogEntry。
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

// 把毫秒时间戳转换成界面使用的本地时间字符串。
function nowStampFromEpoch(epoch: number) {
  return timestampFormatter.format(new Date(epoch)).replace(/\//g, "-");
}

// 把 Tauri task-progress 事件转换成 store 能直接消费的进度结构。
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

// 批量吐出日志队列，减少高频日志导致的 Vue 重渲染次数。
function flushEntries(queue: LogEntry[], listener: (entries: LogEntry[]) => void) {
  if (queue.length === 0) return;
  listener(queue.splice(0, queue.length));
}

// 小延时工具，用于重建豆瓣登录窗口前等待旧窗口释放资源。
function wait(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

// 运行桥负责和 Tauri command / event 对接；在纯网页模式下会自动退回到浏览器存储和本地事件。
class RuntimeBridge {
  // 对外暴露是否为桌面环境，store 据此决定走真实下载还是浏览器演示流程。
  isNativeRuntime() {
    return isTauriRuntime();
  }

  // 读取持久化状态：桌面端走 Tauri/SQLite，浏览器预览走 localStorage。
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

  // 保存完整应用快照，确保任务、Cookie、日志和队列配置一起落盘。
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

  // 统一发日志：桌面端交给 Rust emit，浏览器预览用自定义 DOM 事件模拟。
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

  // 请求系统文件管理器打开目录；浏览器预览只能原样返回路径。
  async openDirectoryPath(directoryPath: string) {
    if (isTauriRuntime()) {
      await invoke("open_directory_path", { directoryPath });
      return directoryPath;
    }

    return directoryPath;
  }

  // 请求系统文件管理器打开文件所在目录并选中文件。
  async revealFilePath(filePath: string) {
    if (isTauriRuntime()) {
      await invoke("reveal_file_path", { filePath });
    }

    return filePath;
  }

  // 打开系统目录选择器；浏览器预览用 prompt 模拟输入目录。
  async pickOutputDirectory(initialPath?: string) {
    if (isTauriRuntime()) {
      return invoke<string | null>("pick_output_directory", { initialPath });
    }

    return window.prompt("请输入输出目录", initialPath ?? "D:/cover");
  }

  // 通过 Tauri 命令调用 sidecar 的豆瓣搜索模式；浏览器预览不直接跨域访问豆瓣。
  async searchDoubanMovies(query: string, page: number) {
    if (!isTauriRuntime()) {
      throw new Error("豆瓣搜索仅在 Tauri 桌面环境可用");
    }

    const serialized = await invoke<string>("search_douban_movies", { query, page });
    return JSON.parse(serialized) as DoubanSearchResultPage;
  }

  // 解析豆瓣详情页片名，用于把用户手动粘贴的纯链接展示成“片名：链接”。
  async resolveDoubanMovieTitle(detailUrl: string) {
    if (!isTauriRuntime()) {
      return null;
    }

    return invoke<string>("resolve_douban_movie_title", { detailUrl });
  }

  // 解析豆瓣影片预览信息，包含片名和封面缩略图 data URL。
  async resolveDoubanMoviePreview(detailUrl: string) {
    if (!isTauriRuntime()) {
      return null;
    }

    const serialized = await invoke<string>("resolve_douban_movie_preview", { detailUrl });
    return JSON.parse(serialized) as DoubanMoviePreview;
  }
  // 真实下载只允许在 Tauri 环境执行，避免网页预览误以为可以访问本地 sidecar。
  // 触发真实 sidecar 下载任务；非 Tauri 环境直接报错，避免误导用户。
  async runDownloadTask(payload: RuntimeDownloadTaskPayload) {
    if (!isTauriRuntime()) {
      throw new Error("真实下载仅在 Tauri 桌面环境可用");
    }

    const serialized = await invoke<string>("run_download_task", { payload });
    return JSON.parse(serialized) as RuntimeDownloadTaskResult;
  }

  // 向 Rust 发送暂停请求，Rust 会写控制文件让 sidecar 在安全点暂停。
  async pauseDownloadTask(taskId: string) {
    if (isTauriRuntime()) {
      await invoke("pause_download_task", { taskId });
    }

    return taskId;
  }

  // 向 Rust 发送继续请求，前端会把任务重新放回可运行队列。
  async resumeDownloadTask(taskId: string) {
    if (isTauriRuntime()) {
      await invoke("resume_download_task", { taskId });
    }

    return taskId;
  }

  // 清空或删除任务时通知 Rust 取消可能仍在运行的 sidecar 进程。
  async clearDownloadTasks(taskIds: string[]) {
    if (isTauriRuntime()) {
      return invoke<number>("clear_download_tasks", { taskIds });
    }

    return taskIds.length;
  }

  // 请求 Rust 删除任务输出目录，Rust 会再次校验目录边界。
  async deleteDirectoryPath(directoryPath: string, rootDirectoryPath: string) {
    if (isTauriRuntime()) {
      await invoke("delete_directory_path", { directoryPath, rootDirectoryPath });
    }

    return directoryPath;
  }

  // 清空输出根目录下的所有子目录和文件，但保留输出根目录本身。
  async clearDirectoryContents(directoryPath: string, rootDirectoryPath: string) {
    if (isTauriRuntime()) {
      return invoke<number>("clear_directory_contents", { directoryPath, rootDirectoryPath });
    }

    return 0;
  }

  // 自定义裁剪拖拽本地图片时读取图片字节，只在桌面端可用。
  async readLocalImageFile(filePath: string, rootDirectoryPath: string) {
    if (!isTauriRuntime()) {
      throw new Error("拖拽读取本地图片仅在 Tauri 桌面环境可用");
    }

    const bytes = await invoke<number[]>("read_local_image_file", { filePath, rootDirectoryPath });
    return new Uint8Array(bytes);
  }
  // 保存自定义裁剪结果；桌面端写入输出目录，浏览器预览则触发下载。
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
  // 打开独立的豆瓣登录 WebView，使用无痕窗口避免复用旧登录状态。
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

  // 轮询登录窗口 Cookie 状态，检测到 dbcl2/ck 后返回可导入 Cookie。
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

  // 登录成功或用户取消后关闭豆瓣登录窗口。
  async closeDoubanLoginWindow(windowLabel: string) {
    if (!isTauriRuntime()) {
      return;
    }

    await invoke("close_login_window", { windowLabel });
  }

  // 日志事件高频出现时先短暂合并，既保持实时感，也避免每行日志触发一次渲染。
  // 订阅运行日志并做短时间批处理，避免日志高峰拖慢界面。
  async onRuntimeLogBatch(listener: (entries: LogEntry[]) => void) {
    if (isTauriRuntime()) {
      const queue: LogEntry[] = [];
      let flushTimer: number | null = null;

      // 安排一次日志批量刷新；如果已有定时器则复用，避免重复排队。
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

    // 浏览器预览模式监听自定义日志事件，并包装成批量回调。
    const browserListener = (event: Event) => {
      listener([(event as CustomEvent<LogEntry>).detail]);
    };

    window.addEventListener(browserEventName, browserListener as EventListener);
    return () => window.removeEventListener(browserEventName, browserListener as EventListener);
  }

  // 进度事件不经过日志列表过滤，专门用于驱动任务进度条的实时变化。
  // 订阅实时任务进度事件，直接驱动下载进度条更新。
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
