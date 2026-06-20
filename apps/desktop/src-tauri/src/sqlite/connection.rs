// SQLite 数据库连接和初始化模块

use crate::utils::timestamp_now;
use rusqlite::Connection;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::Duration;
use tauri::{AppHandle, Manager};

// SQLite 状态库放在 Tauri 应用数据目录，不会被打进安装包，也不会污染用户输出目录。
pub fn sqlite_db_path(app: &AppHandle) -> Result<PathBuf, String> {
    let base_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("无法获取应用数据目录: {error}"))?;

    Ok(base_dir.join("runtime-state.sqlite"))
}

// 本地状态存入 SQLite，并启用 WAL 以降低频繁日志写入时的锁冲突。
pub fn open_state_db_path(db_path: &Path) -> Result<Connection, String> {
    if let Some(parent) = db_path.parent() {
        fs::create_dir_all(parent).map_err(|error| format!("创建状态目录失败: {error}"))?;
    }

    let connection =
        Connection::open(db_path).map_err(|error| format!("打开 SQLite 状态库失败: {error}"))?;
    connection
        .busy_timeout(Duration::from_secs(5))
        .map_err(|error| format!("设置 SQLite busy_timeout 失败: {error}"))?;
    // 表结构刻意保持简单：每条任务/Cookie/日志仍保存为 JSON，方便前端类型演进。
    connection
        .execute_batch(
            r#"
            PRAGMA journal_mode = WAL;
            CREATE TABLE IF NOT EXISTS app_meta (
              key TEXT PRIMARY KEY,
              value_json TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS tasks (
              id TEXT PRIMARY KEY,
              payload_json TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS cookies (
              id TEXT PRIMARY KEY,
              payload_json TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS app_logs (
              id INTEGER PRIMARY KEY,
              payload_json TEXT NOT NULL
            );
        "#,
        )
        .map_err(|error| format!("初始化 SQLite 状态库失败: {error}"))?;

    Ok(connection)
}

pub fn open_state_db(app: &AppHandle) -> Result<Connection, String> {
    let db_path = sqlite_db_path(app)?;
    open_state_db_path(&db_path)
}

// 这些错误通常表示状态库不可继续使用，可以备份后重建，避免应用启动失败。
pub fn is_recoverable_sqlite_error(message: &str) -> bool {
    let normalized = message.to_lowercase();

    [
        "file is not a database",
        "database disk image is malformed",
        "malformed database schema",
        "unable to open database file",
        "readonly database",
        "i/o error",
    ]
    .iter()
    .any(|keyword| normalized.contains(keyword))
}

// SQLite WAL 模式会产生 -wal 和 -shm 侧文件，备份/恢复时必须和主库一起处理。
pub fn sqlite_sidecar_paths(db_path: &Path) -> [PathBuf; 3] {
    [
        db_path.to_path_buf(),
        db_path.with_extension("sqlite-wal"),
        db_path.with_extension("sqlite-shm"),
    ]
}

// 状态库损坏时先把主库和 WAL/SHM 侧文件整体改名备份，再创建干净库继续运行。
pub fn rotate_corrupted_state_db(db_path: &Path) -> Result<PathBuf, String> {
    let backup_stem = format!("runtime-state.corrupt-{}", timestamp_now());
    let backup_db_path = db_path.with_file_name(format!("{backup_stem}.sqlite"));
    let backup_wal_path = db_path.with_file_name(format!("{backup_stem}.sqlite-wal"));
    let backup_shm_path = db_path.with_file_name(format!("{backup_stem}.sqlite-shm"));

    for source_path in sqlite_sidecar_paths(db_path) {
        if !source_path.exists() {
            continue;
        }

        let backup_path = if source_path == db_path {
            backup_db_path.clone()
        } else if source_path.extension().and_then(|value| value.to_str()) == Some("sqlite-wal") {
            backup_wal_path.clone()
        } else {
            backup_shm_path.clone()
        };

        fs::rename(&source_path, &backup_path).map_err(|error| {
            format!(
                "备份损坏的 SQLite 状态库失败: {} -> {}: {error}",
                source_path.display(),
                backup_path.display()
            )
        })?;
    }

    Ok(backup_db_path)
}
