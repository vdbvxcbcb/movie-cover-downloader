// 状态持久化命令模块

use crate::sidecar::emit_runtime_log_event;
use crate::sqlite::*;
use crate::types::RuntimeLogPayload;
use serde_json::Value;
use tauri::AppHandle;

// 前端启动时调用：读取 SQLite，如果发现库损坏则自动备份并重建。
#[tauri::command]
pub fn load_persisted_state(app: AppHandle) -> Result<Option<String>, String> {
    let db_path = sqlite_db_path(&app)?;
    let snapshot = match open_state_db(&app).and_then(|mut connection| {
        migrate_json_snapshot_if_needed(&app, &mut connection)?;
        load_snapshot_from_sqlite(&connection)
    }) {
        Ok(snapshot) => snapshot,
        Err(error) if is_recoverable_sqlite_error(&error) => {
            let _ = rotate_corrupted_state_db(&db_path)?;
            let mut connection = open_state_db(&app)?;
            migrate_json_snapshot_if_needed(&app, &mut connection)?;
            load_snapshot_from_sqlite(&connection).map_err(|retry_error| {
                format!("本地 SQLite 状态库已重建，但重新读取仍失败: {retry_error}")
            })?
        }
        Err(error) => return Err(error),
    };
    match snapshot {
        Some(value) => serde_json::to_string(&value)
            .map(Some)
            .map_err(|error| format!("序列化持久化状态失败: {error}")),
        None => Ok(None),
    }
}

// 前端状态有变化时调用：传入完整 JSON 快照，由 Rust 写入 SQLite。
#[tauri::command]
pub fn save_persisted_state(app: AppHandle, snapshot_json: String) -> Result<(), String> {
    let snapshot = serde_json::from_str::<Value>(&snapshot_json)
        .map_err(|error| format!("解析持久化状态失败: {error}"))?;
    let db_path = sqlite_db_path(&app)?;
    save_snapshot_to_sqlite_path_with_recovery(&db_path, &snapshot)
}

// 前端也可以主动写日志，最终仍走同一条 runtime-log 事件管道。
#[tauri::command]
pub fn emit_runtime_log(app: AppHandle, payload: RuntimeLogPayload) -> Result<(), String> {
    emit_runtime_log_event(
        &app,
        &payload.level,
        &payload.scope,
        payload.message,
        payload.task_id.as_deref(),
        payload.timestamp,
    )
}
