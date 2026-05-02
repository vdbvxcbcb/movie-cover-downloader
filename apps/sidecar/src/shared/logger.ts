import type { LogLevel, SidecarLogEvent, SidecarTaskProgressEvent, TaskPhase } from "./contracts.js";

export interface SidecarLogger {
  info(message: string, taskId?: string): void;
  warn(message: string, taskId?: string): void;
  error(message: string, taskId?: string): void;
}

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
export function createLogger(scope: string): SidecarLogger {
  return {
    info(message, taskId) {
      emit("INFO", scope, message, taskId);
    },
    warn(message, taskId) {
      emit("WARN", scope, message, taskId);
    },
    error(message, taskId) {
      emit("ERROR", scope, message, taskId);
    },
  };
}
