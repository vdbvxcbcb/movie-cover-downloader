// SQLite 数据迁移和恢复模块

use crate::sqlite::connection::{is_recoverable_sqlite_error, open_state_db_path, rotate_corrupted_state_db};
use crate::sqlite::state::{sqlite_has_any_state, write_snapshot_to_sqlite};
use rusqlite::Connection;
use serde_json::Value;
use std::fs;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

// 旧版 JSON 快照路径，仅用于迁移；新版本主要使用 SQLite。
pub fn state_file_path(app: &AppHandle) -> Result<PathBuf, String> {
    let base_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("无法获取应用数据目录: {error}"))?;

    Ok(base_dir.join("runtime-state.json"))
}

// 兼容旧版 JSON 状态文件：只有 SQLite 为空时才迁移，避免覆盖新状态。
pub fn migrate_json_snapshot_if_needed(
    app: &AppHandle,
    connection: &mut Connection,
) -> Result<(), String> {
    if sqlite_has_any_state(connection)? {
        return Ok(());
    }

    let legacy_file_path = state_file_path(app)?;
    if !legacy_file_path.exists() {
        return Ok(());
    }

    let snapshot_json = fs::read_to_string(&legacy_file_path)
        .map_err(|error| format!("读取旧版持久化状态失败: {error}"))?;
    let snapshot = serde_json::from_str::<Value>(&snapshot_json)
        .map_err(|error| format!("解析旧版持久化状态失败: {error}"))?;
    write_snapshot_to_sqlite(connection, &snapshot)
}

pub fn save_snapshot_to_sqlite_path(db_path: &Path, snapshot: &Value) -> Result<(), String> {
    let mut connection = open_state_db_path(db_path)?;
    write_snapshot_to_sqlite(&mut connection, snapshot)
}

// 保存失败且判断为可恢复损坏时，会自动备份旧库并重试一次写入。
pub fn save_snapshot_to_sqlite_path_with_recovery(
    db_path: &Path,
    snapshot: &Value,
) -> Result<(), String> {
    match save_snapshot_to_sqlite_path(db_path, snapshot) {
        Ok(()) => Ok(()),
        Err(error) if is_recoverable_sqlite_error(&error) => {
            let backup_path = rotate_corrupted_state_db(db_path)?;
            save_snapshot_to_sqlite_path(db_path, snapshot).map_err(|retry_error| {
                format!(
                    "本地 SQLite 状态库已损坏，已备份到 {}，但重建后写入仍失败: {retry_error}",
                    backup_path.display()
                )
            })
        }
        Err(error) => Err(error),
    }
}
