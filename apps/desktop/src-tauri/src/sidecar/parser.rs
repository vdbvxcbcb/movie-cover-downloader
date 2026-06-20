// Sidecar 输出解析模块

use crate::sidecar::runtime::resolve_sidecar_event_task_id;
use crate::types::{RuntimeTaskProgressEvent, RuntimeLogEvent};
use crate::constants::LOG_ID_SEED;
use crate::utils::timestamp_now;
use serde_json::Value;
use std::sync::{Arc, Mutex, atomic::Ordering};
use tauri::{AppHandle, Emitter};

// 所有 Rust/sidecar 日志最终都转成 runtime-log 事件，由前端统一展示和持久化。
pub fn emit_runtime_log_event(
    app: &AppHandle,
    level: &str,
    scope: &str,
    message: String,
    task_id: Option<&str>,
    timestamp: Option<String>,
) -> Result<(), String> {
    let event = RuntimeLogEvent {
        id: LOG_ID_SEED.fetch_add(1, Ordering::Relaxed),
        level: level.to_string(),
        scope: scope.to_string(),
        timestamp: timestamp.unwrap_or_else(timestamp_now),
        message,
        task_id: task_id.map(|s| s.to_string()),
    };

    app.emit("runtime-log", event)
        .map_err(|error| format!("发送运行日志事件失败: {error}"))
}

// 实时进度不只写日志，还单独发 task-progress 事件，保证进度条不等日志批量刷新。
pub fn emit_task_progress_event(
    app: &AppHandle,
    task_id: String,
    phase: String,
    target_count: u32,
    saved_count: u32,
    timestamp: Option<String>,
) -> Result<(), String> {
    let event = RuntimeTaskProgressEvent {
        task_id,
        phase,
        target_count,
        saved_count,
        timestamp: timestamp.unwrap_or_else(timestamp_now),
    };

    app.emit("task-progress", event)
        .map_err(|error| format!("发送任务进度事件失败: {error}"))
}

// sidecar stdout 同时承载日志、进度和最终结果，解析时必须按 kind 分流。
pub fn parse_sidecar_stdout_line(
    app: &AppHandle,
    fallback_task_id: &str,
    line: &str,
    result_holder: &Arc<Mutex<Option<Value>>>,
    error_holder: &Arc<Mutex<Option<String>>>,
) {
    let trimmed = line.trim();
    if trimmed.is_empty() {
        return;
    }

    // sidecar 正常输出是 JSON；如果第三方库输出普通文本，也会作为普通日志显示出来。
    let parsed = match serde_json::from_str::<Value>(trimmed) {
        Ok(value) => value,
        Err(_) => {
            let _ = emit_runtime_log_event(
                app,
                "INFO",
                "sidecar",
                trimmed.to_string(),
                Some(fallback_task_id),
                None,
            );
            return;
        }
    };

    // 最终结果只保存到 result_holder，不再作为普通日志显示。
    if parsed.get("kind").and_then(Value::as_str) == Some("task-result") {
        if let Some(payload) = parsed.get("payload") {
            if let Ok(mut guard) = result_holder.lock() {
                *guard = Some(payload.clone());
            }
        }
        return;
    }

    // 进度事件会走两条路：emit task-progress 立即更新进度条，同时写隐藏日志作为兜底恢复。
    if parsed.get("kind").and_then(Value::as_str) == Some("task-progress") {
        let task_id = resolve_sidecar_event_task_id(
            parsed.get("taskId").and_then(Value::as_str),
            fallback_task_id,
        );
        let phase = parsed
            .get("phase")
            .and_then(Value::as_str)
            .unwrap_or("downloading")
            .to_string();
        let target_count = parsed
            .get("targetCount")
            .and_then(Value::as_u64)
            .unwrap_or(0) as u32;
        let saved_count = parsed
            .get("savedCount")
            .and_then(Value::as_u64)
            .unwrap_or(0) as u32;
        let timestamp = parsed.get("timestamp").map(|value| match value {
            Value::String(text) => text.clone(),
            Value::Number(number) => number.to_string(),
            _ => timestamp_now(),
        });

        let _ = emit_task_progress_event(app, task_id.clone(), phase.clone(), target_count, saved_count, timestamp.clone());
        let _ = emit_runtime_log_event(
            app,
            "INFO",
            "task-progress",
            serde_json::json!({
                "phase": phase,
                "targetCount": target_count,
                "savedCount": saved_count
            })
            .to_string(),
            Some(&task_id),
            timestamp,
        );
        return;
    }

    if parsed.get("kind").and_then(Value::as_str) == Some("task-paused") {
        if let Some(message) = parsed.get("message").and_then(Value::as_str) {
            remember_sidecar_error_message(error_holder, message);
        }
        return;
    }

    if parsed.get("kind").and_then(Value::as_str) == Some("task-cancelled") {
        if let Some(message) = parsed.get("message").and_then(Value::as_str) {
            remember_sidecar_error_message(error_holder, message);
        }
        return;
    }

    let level = parsed
        .get("level")
        .and_then(Value::as_str)
        .unwrap_or("INFO");
    let scope = parsed
        .get("scope")
        .and_then(Value::as_str)
        .unwrap_or("sidecar");
    let message = parsed
        .get("message")
        .and_then(Value::as_str)
        .unwrap_or(trimmed)
        .to_string();
    let task_id = resolve_sidecar_event_task_id(
        parsed.get("taskId").and_then(Value::as_str),
        fallback_task_id,
    );
    let timestamp = parsed.get("timestamp").map(|value| match value {
        Value::String(text) => text.clone(),
        Value::Number(number) => number.to_string(),
        _ => timestamp_now(),
    });

    if level.eq_ignore_ascii_case("ERROR") {
        remember_sidecar_error_message(error_holder, &message);
    }

    let _ = emit_runtime_log_event(app, level, scope, message, Some(&task_id), timestamp);
}

// stderr 一律按错误日志处理，并记住最后一条错误，供 sidecar 异常退出时返回给前端。
pub fn parse_sidecar_stderr_line(
    app: &AppHandle,
    fallback_task_id: &str,
    line: &str,
    error_holder: &Arc<Mutex<Option<String>>>,
) {
    let trimmed = line.trim();
    if trimmed.is_empty() {
        return;
    }

    remember_sidecar_error_message(error_holder, trimmed);

    let _ = emit_runtime_log_event(
        app,
        "ERROR",
        "sidecar.stderr",
        trimmed.to_string(),
        Some(fallback_task_id),
        None,
    );
}

pub fn parse_douban_photos_discover_stdout_line(
    app: &AppHandle,
    fallback_task_id: &str,
    line: &str,
    result_holder: &Arc<Mutex<Option<Value>>>,
    error_holder: &Arc<Mutex<Option<String>>>,
) {
    let trimmed = line.trim();
    if trimmed.is_empty() {
        return;
    }

    let parsed = match serde_json::from_str::<Value>(trimmed) {
        Ok(value) => value,
        Err(_) => {
            let _ = emit_runtime_log_event(
                app,
                "INFO",
                "sidecar",
                trimmed.to_string(),
                Some(fallback_task_id),
                None,
            );
            return;
        }
    };

    if parsed.get("kind").and_then(Value::as_str) == Some("douban-photos-discover-result") {
        if let Some(payload) = parsed.get("payload") {
            if let Ok(mut guard) = result_holder.lock() {
                *guard = Some(payload.clone());
            }
        }
        return;
    }

    if parsed.get("kind").and_then(Value::as_str) == Some("douban-photos-discover-progress") {
        if let Some(payload) = parsed.get("payload") {
            let _ = app.emit("douban-photo-discovery-progress", payload.clone());
        }
        return;
    }

    let level = parsed
        .get("level")
        .and_then(Value::as_str)
        .unwrap_or("INFO");
    let scope = parsed
        .get("scope")
        .and_then(Value::as_str)
        .unwrap_or("sidecar");
    let message = parsed
        .get("message")
        .and_then(Value::as_str)
        .unwrap_or(trimmed)
        .to_string();
    let task_id = resolve_sidecar_event_task_id(
        parsed.get("taskId").and_then(Value::as_str),
        fallback_task_id,
    );
    let timestamp = parsed.get("timestamp").map(|value| match value {
        Value::String(text) => text.clone(),
        Value::Number(number) => number.to_string(),
        _ => timestamp_now(),
    });

    if level.eq_ignore_ascii_case("ERROR") {
        remember_sidecar_error_message(error_holder, &message);
    }

    let _ = emit_runtime_log_event(app, level, scope, message, Some(&task_id), timestamp);
}

// 多线程读取 stdout/stderr 时用 Mutex 保存最近错误，最后统一决定返回给前端的失败原因。
pub fn remember_sidecar_error_message(error_holder: &Arc<Mutex<Option<String>>>, message: &str) {
    let trimmed = message.trim();
    if trimmed.is_empty() {
        return;
    }

    if let Ok(mut guard) = error_holder.lock() {
        *guard = Some(trimmed.to_string());
    }
}

// 通用 sidecar JSON 结果解析函数，统一处理错误提取和结果返回
pub fn parse_sidecar_json_result<T, F>(
    output: &std::process::Output,
    result_kind: &str,
    extract_payload: F,
) -> Result<T, String>
where
    F: Fn(&Value) -> Option<T>,
{
    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);

    if !output.status.success() {
        let last_error_line = stderr
            .lines()
            .rfind(|line| !line.trim().is_empty())
            .unwrap_or("sidecar 进程异常退出");

        let parsed_error = serde_json::from_str::<Value>(last_error_line)
            .ok()
            .and_then(|value| {
                if value.get("level")?.as_str()? == "ERROR" {
                    Some(value.get("message")?.as_str()?.to_string())
                } else {
                    None
                }
            });

        return Err(parsed_error.unwrap_or_else(|| {
            format!("{}执行失败: {}", result_kind, last_error_line)
        }));
    }

    let last_line = stdout
        .lines()
        .rfind(|line| !line.trim().is_empty())
        .ok_or_else(|| format!("sidecar 未返回{}", result_kind))?;

    let parsed: Value = serde_json::from_str(last_line)
        .map_err(|_| format!("解析 sidecar {} JSON 失败", result_kind))?;

    if parsed.get("kind").and_then(Value::as_str) == Some("error") {
        let sidecar_message = parsed
            .get("message")
            .and_then(Value::as_str)
            .ok_or_else(|| format!("读取{}错误失败", result_kind))?
            .to_string();
        return Err(sidecar_message);
    }

    extract_payload(&parsed).ok_or_else(|| format!("sidecar 未返回{}", result_kind))
}
