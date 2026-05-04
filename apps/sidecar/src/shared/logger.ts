// sidecar 日志工具：把结构化日志和进度事件写到 stdout，供 Tauri 解析。
import type { LogLevel, SidecarLogEvent, SidecarTaskProgressEvent, TaskPhase } from "./contracts.js";

export interface SidecarLogger {
  info(message: string, taskId?: string): void;
  warn(message: string, taskId?: string): void;
  error(message: string, taskId?: string): void;
}

// 日志以单行 JSON 写入 stdout，Tauri 可以稳定解析而不用依赖文本格式。
function emit(level: LogLevel, scope: string, message: string, taskId?: string) {
  const event: SidecarLogEvent = {
    level,
    scope,
    timestamp: Date.now(),
    message,
    taskId,
  };

  process.stdout.write(`${JSON.stringify(event)}\n`);
}

// 输出专用进度事件；Tauri 收到后会立即更新前端进度条，并写隐藏进度日志兜底。
export function emitTaskProgress(taskId: string, phase: TaskPhase, targetCount: number, savedCount: number) {
  const event: SidecarTaskProgressEvent = {
    kind: "task-progress",
    taskId,
    phase,
    targetCount,
    savedCount,
    timestamp: Date.now(),
  };

  process.stdout.write(`${JSON.stringify(event)}\n`);
}

// sidecar 默认输出 NDJSON，方便后续让 Rust 或 Tauri 桥接层直接消费。
// 创建带固定 scope 的日志器，让不同服务的日志在前端日志中心里可区分。
export function createLogger(scope: string): SidecarLogger {
  return {
    // 写 INFO 级别日志，通常表示正常流程节点，例如启动、发现图片、保存完成。
    info(message, taskId) {
      emit("INFO", scope, message, taskId);
    },
    // 写 WARN 级别日志，通常表示可跳过或可恢复的问题，例如单张图片下载失败。
    warn(message, taskId) {
      emit("WARN", scope, message, taskId);
    },
    // 写 ERROR 级别日志，通常表示任务或 sidecar 进程需要终止的错误。
    error(message, taskId) {
      emit("ERROR", scope, message, taskId);
    },
  };
}
