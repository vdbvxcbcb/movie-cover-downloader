// 日志管理 store：处理运行时日志的收集、过滤和显示。
import { computed, ref } from "vue";
import { defineStore } from "pinia";
import { runtimeBridge } from "../lib/runtime-bridge";
import { retainedRuntimeLogCount } from "./app-helpers";
import type { AppSeedState } from "../types/app";

export const useLogs = defineStore("logs", () => {
  const logs = ref<AppSeedState["logs"]>([]);
  const logOnlyErrors = ref(false);

  // 日志中心可见日志：按"仅错误"开关过滤，并隐藏内部 task-progress 兜底日志。
  const visibleLogs = computed(() =>
    (logOnlyErrors.value ? logs.value.filter((entry) => entry.level === "ERROR") : logs.value).filter(
      (entry) => entry.scope !== "task-progress",
    ),
  );

  // 切换日志中心"仅错误"过滤，也支持显式设置为开或关。
  function toggleLogOnlyErrors(force?: boolean) {
    logOnlyErrors.value = typeof force === "boolean" ? force : !logOnlyErrors.value;
  }

  // 添加新的日志批次到日志列表头部。
  function addLogBatch(entries: AppSeedState["logs"]) {
    if (entries.length === 0) return;
    logs.value = [...entries.slice().reverse(), ...logs.value].slice(0, retainedRuntimeLogCount);
  }

  // 清空日志中心的全部可见日志。
  function clearAllLogs() {
    logs.value = [];
  }

  // 通过 runtimeBridge 写运行日志，桌面端会由 Rust 统一发回日志事件。
  async function emitLog(level: "INFO" | "WARN" | "ERROR", scope: string, message: string, taskId?: string) {
    await runtimeBridge.emitLog({ level, scope, message, taskId });
  }

  // 初始化时加载日志列表。
  function setLogs(newLogs: AppSeedState["logs"]) {
    logs.value = newLogs;
  }

  return {
    logs,
    logOnlyErrors,
    visibleLogs,
    toggleLogOnlyErrors,
    addLogBatch,
    clearAllLogs,
    emitLog,
    setLogs,
  };
});
