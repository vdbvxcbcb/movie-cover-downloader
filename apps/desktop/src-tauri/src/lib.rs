use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    collections::{HashMap, HashSet},
    fs,
    io::{BufRead, BufReader},
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc, Mutex,
    },
    thread,
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Emitter, Manager};

static LOG_ID_SEED: AtomicU64 = AtomicU64::new(10_000);

const APP_STATE_SCHEMA_VERSION: i64 = 2;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RuntimeLogPayload {
    level: String,
    scope: String,
    timestamp: Option<String>,
    message: String,
    task_id: Option<String>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct RuntimeLogEvent {
    id: u64,
    level: String,
    scope: String,
    timestamp: String,
    message: String,
    task_id: Option<String>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct RuntimeTaskProgressEvent {
    task_id: String,
    phase: String,
    target_count: u32,
    saved_count: u32,
    timestamp: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DownloadTaskPayload {
    task_id: String,
    detail_url: String,
    output_root_dir: String,
    source_hint: String,
    douban_asset_type: String,
    image_count_mode: String,
    max_images: u32,
    output_image_format: String,
    request_interval_seconds: Option<u32>,
    douban_cookie: Option<String>,
}

#[derive(Debug, Serialize, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct LoginWindowCookieStatus {
    status: String,
    cookie: Option<String>,
}

#[derive(Default)]
struct TaskControlRegistry {
    paused: Mutex<HashSet<String>>,
    control_files: Mutex<HashMap<String, PathBuf>>,
}

impl TaskControlRegistry {
    fn pause(&self, task_id: String) -> Result<(), String> {
        if let Ok(mut paused) = self.paused.lock() {
            paused.insert(task_id);
            return Ok(());
        }

        Err("æ— æ³•å†™å…¥æš‚åœçŠ¶æ€".to_string())
    }

    fn resume(&self, task_id: &str) -> Result<(), String> {
        if let Ok(mut paused) = self.paused.lock() {
            paused.remove(task_id);
            return Ok(());
        }

        Err("æ— æ³•æ¸…ç†æš‚åœçŠ¶æ€".to_string())
    }

    fn is_paused(&self, task_id: &str) -> bool {
        self.paused
            .lock()
            .map(|paused| paused.contains(task_id))
            .unwrap_or(false)
    }

    fn register_control_file(&self, task_id: String, control_file: PathBuf) -> Result<(), String> {
        {
            let mut control_files = self
                .control_files
                .lock()
                .map_err(|_| "æ— æ³•æ³¨å†Œä»»åŠ¡æŽ§åˆ¶æ–‡ä»¶".to_string())?;
            control_files.insert(task_id.clone(), control_file.clone());
        }

        self.write_control_action(&task_id)
    }

    fn unregister_task(&self, task_id: &str) {
        if let Ok(mut control_files) = self.control_files.lock() {
            if let Some(control_file) = control_files.remove(task_id) {
                let _ = fs::remove_file(&control_file);
                let _ = fs::remove_file(task_pid_file_path(&control_file));
            }
        }

        if let Ok(mut paused) = self.paused.lock() {
            paused.remove(task_id);
        }
    }

    fn sync_pause_request(&self, task_id: String) -> Result<(), String> {
        self.pause(task_id.clone())?;
        self.write_control_action(&task_id)
    }

    fn sync_resume_request(&self, task_id: &str) -> Result<(), String> {
        self.resume(task_id)?;
        self.write_control_action(task_id)
    }

    fn write_control_action(&self, task_id: &str) -> Result<(), String> {
        let action = if self.is_paused(task_id) {
            "pause"
        } else {
            "resume"
        };

        self.write_control_action_value(task_id, action)
    }

    fn sync_cancel_request(&self, task_id: &str) -> Result<(), String> {
        if let Ok(mut paused) = self.paused.lock() {
            paused.remove(task_id);
        }

        self.write_control_action_value(task_id, "cancel")
    }

    fn write_control_action_value(&self, task_id: &str, action: &str) -> Result<(), String> {
        let control_file = self
            .control_files
            .lock()
            .map_err(|_| "æ— æ³•è¯»å–ä»»åŠ¡æŽ§åˆ¶æ–‡ä»¶".to_string())?
            .get(task_id)
            .cloned();

        let Some(control_file) = control_file else {
            return Ok(());
        };

        if let Some(parent) = control_file.parent() {
            fs::create_dir_all(parent)
                .map_err(|error| format!("åˆ›å»ºä»»åŠ¡æŽ§åˆ¶ç›®å½•å¤±è´¥: {error}"))?;
        }

        fs::write(&control_file, action)
            .map_err(|error| format!("å†™å…¥ä»»åŠ¡æŽ§åˆ¶æ–‡ä»¶å¤±è´¥: {error}"))
    }
}

fn resolve_request_interval_ms(payload: &DownloadTaskPayload) -> u32 {
    let interval_ms = payload
        .request_interval_seconds
        .map(|seconds| seconds.saturating_mul(1000))
        .unwrap_or(1000);

    interval_ms.clamp(1000, 5000)
}

fn timestamp_now() -> String {
    let millis = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or(0);
    millis.to_string()
}

fn state_file_path(app: &AppHandle) -> Result<PathBuf, String> {
    let base_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("无法获取应用数据目录: {error}"))?;

    Ok(base_dir.join("runtime-state.json"))
}

fn sqlite_db_path(app: &AppHandle) -> Result<PathBuf, String> {
    let base_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("无法获取应用数据目录: {error}"))?;

    Ok(base_dir.join("runtime-state.sqlite"))
}

fn open_state_db_path(db_path: &Path) -> Result<Connection, String> {
    if let Some(parent) = db_path.parent() {
        fs::create_dir_all(parent).map_err(|error| format!("创建状态目录失败: {error}"))?;
    }

    let connection =
        Connection::open(&db_path).map_err(|error| format!("打开 SQLite 状态库失败: {error}"))?;
    connection
        .busy_timeout(Duration::from_secs(5))
        .map_err(|error| format!("设置 SQLite busy_timeout 失败: {error}"))?;
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

fn open_state_db(app: &AppHandle) -> Result<Connection, String> {
    let db_path = sqlite_db_path(app)?;
    open_state_db_path(&db_path)
}

fn is_recoverable_sqlite_error(message: &str) -> bool {
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

fn sqlite_sidecar_paths(db_path: &Path) -> [PathBuf; 3] {
    [
        db_path.to_path_buf(),
        db_path.with_extension("sqlite-wal"),
        db_path.with_extension("sqlite-shm"),
    ]
}

fn rotate_corrupted_state_db(db_path: &Path) -> Result<PathBuf, String> {
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

fn count_rows(connection: &Connection, table_name: &str) -> Result<i64, String> {
    let sql = format!("SELECT COUNT(*) FROM {table_name}");
    connection
        .query_row(&sql, [], |row| row.get::<_, i64>(0))
        .map_err(|error| format!("统计 {table_name} 行数失败: {error}"))
}

fn sqlite_has_any_state(connection: &Connection) -> Result<bool, String> {
    let tasks = count_rows(connection, "tasks")?;
    let cookies = count_rows(connection, "cookies")?;
    let logs = count_rows(connection, "app_logs")?;

    Ok(tasks > 0 || cookies > 0 || logs > 0)
}

fn value_array_from_root<'a>(root: &'a Value, key: &str) -> &'a [Value] {
    root.get(key)
        .and_then(Value::as_array)
        .map(Vec::as_slice)
        .unwrap_or(&[])
}

fn next_runtime_log_seed(logs: &[Value]) -> Option<u64> {
    logs.iter()
        .filter_map(|log| log.get("id").and_then(Value::as_u64))
        .max()
        .map(|max_id| max_id.saturating_add(1))
}

fn write_snapshot_to_sqlite(connection: &mut Connection, snapshot: &Value) -> Result<(), String> {
    let tasks = value_array_from_root(snapshot, "tasks");
    let cookies = value_array_from_root(snapshot, "cookies");
    let logs = value_array_from_root(snapshot, "logs");
    let schema_version = snapshot
        .get("schemaVersion")
        .and_then(Value::as_i64)
        .unwrap_or(APP_STATE_SCHEMA_VERSION);
    let queue_config = snapshot
        .get("queueConfig")
        .cloned()
        .unwrap_or_else(|| Value::Object(serde_json::Map::new()));

    let transaction = connection
        .transaction()
        .map_err(|error| format!("开启 SQLite 事务失败: {error}"))?;

    transaction
        .execute("DELETE FROM tasks", [])
        .map_err(|error| format!("清理 tasks 失败: {error}"))?;
    transaction
        .execute("DELETE FROM cookies", [])
        .map_err(|error| format!("清理 cookies 失败: {error}"))?;
    transaction
        .execute("DELETE FROM app_logs", [])
        .map_err(|error| format!("清理 app_logs 失败: {error}"))?;

    {
        let mut statement = transaction
            .prepare("INSERT OR REPLACE INTO tasks (id, payload_json) VALUES (?1, ?2)")
            .map_err(|error| format!("准备写入 tasks 语句失败: {error}"))?;
        for task in tasks {
            let task_id = task
                .get("id")
                .and_then(Value::as_str)
                .ok_or_else(|| "写入 tasks 失败: 任务缺少 id".to_string())?;
            let payload = serde_json::to_string(task)
                .map_err(|error| format!("序列化 task 失败: {error}"))?;
            statement
                .execute(params![task_id, payload])
                .map_err(|error| format!("写入 task 失败: {error}"))?;
        }
    }

    {
        let mut statement = transaction
            .prepare("INSERT OR REPLACE INTO cookies (id, payload_json) VALUES (?1, ?2)")
            .map_err(|error| format!("准备写入 cookies 语句失败: {error}"))?;
        for cookie in cookies {
            let cookie_id = cookie
                .get("id")
                .and_then(Value::as_str)
                .ok_or_else(|| "写入 cookies 失败: Cookie 缺少 id".to_string())?;
            let payload = serde_json::to_string(cookie)
                .map_err(|error| format!("序列化 cookie 失败: {error}"))?;
            statement
                .execute(params![cookie_id, payload])
                .map_err(|error| format!("写入 cookie 失败: {error}"))?;
        }
    }

    {
        let mut statement = transaction
            .prepare("INSERT OR REPLACE INTO app_logs (id, payload_json) VALUES (?1, ?2)")
            .map_err(|error| format!("准备写入 app_logs 语句失败: {error}"))?;
        for log in logs {
            let log_id = log
                .get("id")
                .and_then(Value::as_i64)
                .ok_or_else(|| "写入 app_logs 失败: 日志缺少 id".to_string())?;
            let payload =
                serde_json::to_string(log).map_err(|error| format!("序列化日志失败: {error}"))?;
            statement
                .execute(params![log_id, payload])
                .map_err(|error| format!("写入日志失败: {error}"))?;
        }
    }

    let schema_version_json = serde_json::to_string(&schema_version)
        .map_err(|error| format!("序列化 schemaVersion 失败: {error}"))?;
    let queue_config_json = serde_json::to_string(&queue_config)
        .map_err(|error| format!("序列化 queueConfig 失败: {error}"))?;

    transaction
        .execute(
            "INSERT OR REPLACE INTO app_meta (key, value_json) VALUES (?1, ?2)",
            params!["schemaVersion", schema_version_json],
        )
        .map_err(|error| format!("写入 schemaVersion 失败: {error}"))?;
    transaction
        .execute(
            "INSERT OR REPLACE INTO app_meta (key, value_json) VALUES (?1, ?2)",
            params!["queueConfig", queue_config_json],
        )
        .map_err(|error| format!("写入 queueConfig 失败: {error}"))?;

    transaction
        .commit()
        .map_err(|error| format!("提交 SQLite 事务失败: {error}"))
}

fn migrate_json_snapshot_if_needed(app: &AppHandle, connection: &mut Connection) -> Result<(), String> {
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

fn load_snapshot_from_sqlite(connection: &Connection) -> Result<Option<Value>, String> {
    if !sqlite_has_any_state(connection)? {
        return Ok(None);
    }

    let schema_version_json = connection
        .query_row(
            "SELECT value_json FROM app_meta WHERE key = ?1",
            params!["schemaVersion"],
            |row| row.get::<_, String>(0),
        )
        .ok();
    let queue_config_json = connection
        .query_row(
            "SELECT value_json FROM app_meta WHERE key = ?1",
            params!["queueConfig"],
            |row| row.get::<_, String>(0),
        )
        .ok();

    let schema_version = schema_version_json
        .as_deref()
        .and_then(|raw| serde_json::from_str::<i64>(raw).ok())
        .unwrap_or(APP_STATE_SCHEMA_VERSION);
    let queue_config = queue_config_json
        .as_deref()
        .and_then(|raw| serde_json::from_str::<Value>(raw).ok())
        .unwrap_or_else(|| Value::Object(serde_json::Map::new()));

    let mut tasks_statement = connection
        .prepare("SELECT payload_json FROM tasks ORDER BY rowid ASC")
        .map_err(|error| format!("读取 tasks 失败: {error}"))?;
    let tasks_rows = tasks_statement
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(|error| format!("遍历 tasks 失败: {error}"))?;
    let mut tasks = Vec::new();
    for row in tasks_rows {
        let payload = row.map_err(|error| format!("读取 task 行失败: {error}"))?;
        let parsed = serde_json::from_str::<Value>(&payload)
            .map_err(|error| format!("解析 task 失败: {error}"))?;
        tasks.push(parsed);
    }

    let mut cookies_statement = connection
        .prepare("SELECT payload_json FROM cookies ORDER BY rowid DESC")
        .map_err(|error| format!("读取 cookies 失败: {error}"))?;
    let cookie_rows = cookies_statement
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(|error| format!("遍历 cookies 失败: {error}"))?;
    let mut cookies = Vec::new();
    for row in cookie_rows {
        let payload = row.map_err(|error| format!("读取 cookie 行失败: {error}"))?;
        let parsed = serde_json::from_str::<Value>(&payload)
            .map_err(|error| format!("解析 cookie 失败: {error}"))?;
        cookies.push(parsed);
    }

    let mut logs_statement = connection
        .prepare("SELECT payload_json FROM app_logs ORDER BY id DESC")
        .map_err(|error| format!("读取 app_logs 失败: {error}"))?;
    let log_rows = logs_statement
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(|error| format!("遍历 app_logs 失败: {error}"))?;
    let mut logs = Vec::new();
    for row in log_rows {
        let payload = row.map_err(|error| format!("读取日志行失败: {error}"))?;
        let parsed = serde_json::from_str::<Value>(&payload)
            .map_err(|error| format!("解析日志失败: {error}"))?;
        logs.push(parsed);
    }

    if let Some(next_seed) = next_runtime_log_seed(&logs) {
        LOG_ID_SEED.fetch_max(next_seed, Ordering::Relaxed);
    }

    let mut root = serde_json::Map::new();
    root.insert("schemaVersion".to_string(), Value::from(schema_version));
    root.insert("tasks".to_string(), Value::Array(tasks));
    root.insert("cookies".to_string(), Value::Array(cookies));
    root.insert("logs".to_string(), Value::Array(logs));
    root.insert("queueConfig".to_string(), queue_config);

    Ok(Some(Value::Object(root)))
}

fn save_snapshot_to_sqlite_path(db_path: &Path, snapshot: &Value) -> Result<(), String> {
    let mut connection = open_state_db_path(db_path)?;
    write_snapshot_to_sqlite(&mut connection, snapshot)
}

fn save_snapshot_to_sqlite_path_with_recovery(
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

fn task_control_file_path(app: &AppHandle, task_id: &str) -> Result<PathBuf, String> {
    let base_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("无法获取应用数据目录: {error}"))?;

    Ok(base_dir.join("task-control").join(format!("{task_id}.txt")))
}

fn task_pid_file_path(control_file_path: &Path) -> PathBuf {
    control_file_path.with_extension("pid")
}

fn emit_runtime_log_event(
    app: &AppHandle,
    level: &str,
    scope: &str,
    message: String,
    task_id: Option<String>,
    timestamp: Option<String>,
) -> Result<(), String> {
    let event = RuntimeLogEvent {
        id: LOG_ID_SEED.fetch_add(1, Ordering::Relaxed),
        level: level.to_string(),
        scope: scope.to_string(),
        timestamp: timestamp.unwrap_or_else(timestamp_now),
        message,
        task_id,
    };

    app.emit("runtime-log", event)
        .map_err(|error| format!("发送运行日志事件失败: {error}"))
}

fn emit_task_progress_event(
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

fn resolve_dev_sidecar_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("..")
        .join("sidecar")
}

fn resolve_bundled_sidecar_root(app: &AppHandle) -> Option<PathBuf> {
    let root = app.path().resource_dir().ok()?.join("sidecar");
    root.join("dist").join("index.js").exists().then_some(root)
}

fn resolve_sidecar_root(app: &AppHandle) -> PathBuf {
    resolve_bundled_sidecar_root(app).unwrap_or_else(resolve_dev_sidecar_root)
}

fn resolve_sidecar_entry(sidecar_root: &Path) -> Result<PathBuf, String> {
    let entry = sidecar_root.join("dist").join("index.js");
    if entry.exists() {
        return Ok(entry);
    }

    Err(format!(
        "未找到 sidecar 构建产物: {}，请先执行 apps/sidecar 的 build",
        entry.display()
    ))
}

fn resolve_sidecar_entry_arg() -> &'static str {
    "./dist/index.js"
}

fn resolve_sidecar_node(sidecar_root: &Path) -> PathBuf {
    let bundled_node = sidecar_root.join(if cfg!(windows) { "node.exe" } else { "node" });
    if bundled_node.exists() {
        return bundled_node;
    }

    PathBuf::from("node")
}

fn parse_sidecar_stdout_line(
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
                Some(fallback_task_id.to_string()),
                None,
            );
            return;
        }
    };

    if parsed.get("kind").and_then(Value::as_str) == Some("task-result") {
        if let Some(payload) = parsed.get("payload") {
            if let Ok(mut guard) = result_holder.lock() {
                *guard = Some(payload.clone());
            }
        }
        return;
    }

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

        let runtime_log_task_id = task_id.clone();
        let runtime_log_phase = phase.clone();
        let runtime_log_timestamp = timestamp.clone();
        let _ = emit_task_progress_event(app, task_id, phase, target_count, saved_count, timestamp);
        let _ = emit_runtime_log_event(
            app,
            "INFO",
            "task-progress",
            serde_json::json!({
                "phase": runtime_log_phase,
                "targetCount": target_count,
                "savedCount": saved_count
            })
            .to_string(),
            Some(runtime_log_task_id),
            runtime_log_timestamp,
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
    let task_id = Some(resolve_sidecar_event_task_id(
        parsed.get("taskId").and_then(Value::as_str),
        fallback_task_id,
    ));
    let timestamp = parsed.get("timestamp").map(|value| match value {
        Value::String(text) => text.clone(),
        Value::Number(number) => number.to_string(),
        _ => timestamp_now(),
    });

    if level.eq_ignore_ascii_case("ERROR") {
        remember_sidecar_error_message(error_holder, &message);
    }

    let _ = emit_runtime_log_event(app, level, scope, message, task_id, timestamp);
}

fn parse_sidecar_stderr_line(
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
        Some(fallback_task_id.to_string()),
        None,
    );
}

fn escape_powershell_single_quote(input: &str) -> String {
    input.replace('\'', "''")
}

fn existing_path(path: Option<String>) -> Option<String> {
    path.filter(|value| !value.trim().is_empty())
        .filter(|value| Path::new(value).exists())
}

fn remember_sidecar_error_message(error_holder: &Arc<Mutex<Option<String>>>, message: &str) {
    let trimmed = message.trim();
    if trimmed.is_empty() {
        return;
    }

    if let Ok(mut guard) = error_holder.lock() {
        *guard = Some(trimmed.to_string());
    }
}

fn normalize_sidecar_error_message(message: &str) -> String {
    message
        .trim()
        .strip_prefix("sidecar failed to start: ")
        .unwrap_or(message.trim())
        .to_string()
}

fn format_sidecar_exit_error(status_code: Option<i32>, sidecar_message: Option<&str>) -> String {
    match sidecar_message.map(normalize_sidecar_error_message) {
        Some(message) if !message.is_empty() => message,
        _ => format!("sidecar 任务执行失败，退出码 {:?}", status_code),
    }
}

fn ensure_existing_directory(path: &str) -> Result<PathBuf, String> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Err("目录路径不能为空".to_string());
    }

    let directory = PathBuf::from(trimmed);
    if !directory.exists() {
        return Err(format!("目录不存在: {}", directory.display()));
    }
    if !directory.is_dir() {
        return Err(format!("目标不是目录: {}", directory.display()));
    }

    Ok(directory)
}

fn terminate_task_process(control_file_path: &Path) -> Result<bool, String> {
    let pid_file_path = task_pid_file_path(control_file_path);
    let pid_text = match fs::read_to_string(&pid_file_path) {
        Ok(content) => content,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(false),
        Err(error) => return Err(format!("读取任务进程标记失败: {error}")),
    };

    let pid = match pid_text.trim().parse::<u32>() {
        Ok(value) => value,
        Err(_) => {
            let _ = fs::remove_file(pid_file_path);
            return Ok(false);
        }
    };

    #[cfg(target_os = "windows")]
    let output = Command::new("taskkill")
        .args(["/PID", &pid.to_string(), "/T", "/F"])
        .output()
        .map_err(|error| format!("结束后台抓取进程失败: {error}"))?;

    #[cfg(not(target_os = "windows"))]
    let output = Command::new("kill")
        .args(["-TERM", &pid.to_string()])
        .output()
        .map_err(|error| format!("结束后台抓取进程失败: {error}"))?;

    let _ = fs::remove_file(pid_file_path);

    if !output.status.success() {
        return Ok(false);
    }

    Ok(true)
}

async fn run_blocking_job<T, F>(job: F) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, String> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(job)
        .await
        .map_err(|error| format!("后台任务执行失败: {error}"))?
}

fn resolve_douban_login_cookie_status<K, V>(
    window_exists: bool,
    cookies: &[(K, V)],
) -> LoginWindowCookieStatus
where
    K: AsRef<str>,
    V: AsRef<str>,
{
    if !window_exists {
        return LoginWindowCookieStatus {
            status: "closed".to_string(),
            cookie: None,
        };
    }

    let mut has_dbcl2 = false;
    let mut has_ck = false;
    let mut cookie_parts = Vec::new();

    for (name, value) in cookies {
        let name = name.as_ref().trim();
        let value = value.as_ref().trim();
        if name.is_empty() || value.is_empty() {
            continue;
        }

        if name == "dbcl2" {
            has_dbcl2 = true;
        }
        if name == "ck" {
            has_ck = true;
        }

        cookie_parts.push(format!("{name}={value}"));
    }

    if has_dbcl2 && has_ck {
        return LoginWindowCookieStatus {
            status: "ready".to_string(),
            cookie: Some(cookie_parts.join("; ")),
        };
    }

    LoginWindowCookieStatus {
        status: "pending".to_string(),
        cookie: None,
    }
}

fn read_login_window_cookie_status_blocking(
    app: AppHandle,
    window_label: String,
) -> Result<LoginWindowCookieStatus, String> {
    let Some(window) = app.get_webview_window(&window_label) else {
        return Ok(resolve_douban_login_cookie_status::<String, String>(
            false,
            &[],
        ));
    };

    let cookies = window
        .cookies()
        .map_err(|error| format!("读取登录窗口 Cookie 失败: {error}"))?;
    let cookie_pairs = cookies
        .into_iter()
        .map(|cookie| (cookie.name().to_string(), cookie.value().to_string()))
        .collect::<Vec<_>>();

    Ok(resolve_douban_login_cookie_status(true, &cookie_pairs))
}

#[tauri::command]
fn load_persisted_state(app: AppHandle) -> Result<Option<String>, String> {
    let db_path = sqlite_db_path(&app)?;
    let snapshot = match open_state_db(&app)
        .and_then(|mut connection| {
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

fn resolve_sidecar_event_task_id(raw_task_id: Option<&str>, fallback_task_id: &str) -> String {
    match raw_task_id {
        Some(task_id) if !task_id.trim().is_empty() && task_id != "bootstrap-url-task" => {
            task_id.to_string()
        }
        _ => fallback_task_id.to_string(),
    }
}

#[tauri::command]
async fn check_login_window_cookie_status(
    app: AppHandle,
    window_label: String,
) -> Result<LoginWindowCookieStatus, String> {
    run_blocking_job(move || read_login_window_cookie_status_blocking(app, window_label)).await
}

#[tauri::command]
fn close_login_window(app: AppHandle, window_label: String) -> Result<bool, String> {
    let Some(window) = app.get_webview_window(&window_label) else {
        return Ok(false);
    };

    window
        .close()
        .map_err(|error| format!("关闭登录窗口失败: {error}"))?;
    Ok(true)
}

#[tauri::command]
fn save_persisted_state(app: AppHandle, snapshot_json: String) -> Result<(), String> {
    let snapshot = serde_json::from_str::<Value>(&snapshot_json)
        .map_err(|error| format!("解析持久化状态失败: {error}"))?;
    let db_path = sqlite_db_path(&app)?;
    save_snapshot_to_sqlite_path_with_recovery(&db_path, &snapshot)
}

#[tauri::command]
fn emit_runtime_log(app: AppHandle, payload: RuntimeLogPayload) -> Result<(), String> {
    emit_runtime_log_event(
        &app,
        &payload.level,
        &payload.scope,
        payload.message,
        payload.task_id,
        payload.timestamp,
    )
}

#[tauri::command]
fn pause_download_task(
    app: AppHandle,
    task_id: String,
    registry: tauri::State<TaskControlRegistry>,
) -> Result<bool, String> {
    registry.sync_pause_request(task_id.clone())?;
    let _ = emit_runtime_log_event(
        &app,
        "WARN",
        "queue-control",
        format!("pause requested: {task_id}"),
        Some(task_id.clone()),
        None,
    );
    Ok(true)
}

#[tauri::command]
fn resume_download_task(
    app: AppHandle,
    task_id: String,
    registry: tauri::State<TaskControlRegistry>,
) -> Result<bool, String> {
    registry.sync_resume_request(&task_id)?;
    let _ = emit_runtime_log_event(
        &app,
        "INFO",
        "queue-control",
        format!("resume requested: {task_id}"),
        Some(task_id.clone()),
        None,
    );
    Ok(true)
}

#[tauri::command]
fn clear_download_tasks(
    app: AppHandle,
    task_ids: Vec<String>,
    registry: tauri::State<TaskControlRegistry>,
) -> Result<usize, String> {
    let mut cleared = 0usize;

    for task_id in task_ids {
        let control_file_path = task_control_file_path(&app, &task_id)?;
        registry.register_control_file(task_id.clone(), control_file_path.clone())?;
        let _ = registry.sync_cancel_request(&task_id);
        let _ = terminate_task_process(&control_file_path);
        registry.unregister_task(&task_id);
        let _ = emit_runtime_log_event(
            &app,
            "WARN",
            "queue-control",
            format!("clear requested: {task_id}"),
            Some(task_id.clone()),
            None,
        );
        cleared += 1;
    }

    Ok(cleared)
}

#[tauri::command]
fn delete_directory_path(directory_path: String, root_directory_path: String) -> Result<bool, String> {
    let directory = PathBuf::from(directory_path.trim());
    if directory.as_os_str().is_empty() || !directory.exists() {
        return Ok(false);
    }
    let root_directory = PathBuf::from(root_directory_path.trim());
    if root_directory.as_os_str().is_empty() || !root_directory.exists() {
        return Err("输出根目录不存在，已取消删除".to_string());
    }

    let directory = fs::canonicalize(&directory)
        .map_err(|error| format!("解析输出目录失败: {error}"))?;
    let root_directory = fs::canonicalize(&root_directory)
        .map_err(|error| format!("解析输出根目录失败: {error}"))?;
    if !directory.is_dir() {
        return Err(format!("输出目录不是文件夹: {}", directory.display()));
    }

    if directory == root_directory {
        return Err(format!("拒绝删除输出根目录: {}", directory.display()));
    }

    if !directory.starts_with(&root_directory) {
        return Err(format!(
            "拒绝删除输出根目录外的目录: {}",
            directory.display()
        ));
    }

    fs::remove_dir_all(&directory)
        .map_err(|error| format!("删除输出目录失败 {}: {error}", directory.display()))?;
    Ok(true)
}

#[tauri::command]
fn pick_output_directory(initial_path: Option<String>) -> Result<Option<String>, String> {
    let initial_path = existing_path(initial_path);
    let selected_path = initial_path
        .as_deref()
        .map(escape_powershell_single_quote)
        .unwrap_or_default();

    let command = format!(
        "Add-Type -AssemblyName System.Windows.Forms; \
         $dialog = New-Object System.Windows.Forms.FolderBrowserDialog; \
         $dialog.Description = '选择输出目录'; \
         $dialog.ShowNewFolderButton = $true; \
         if ('{selected_path}' -ne '') {{ $dialog.SelectedPath = '{selected_path}' }}; \
         if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {{ Write-Output $dialog.SelectedPath }}"
    );

    let output = Command::new("powershell.exe")
        .args(["-NoProfile", "-STA", "-Command", &command])
        .output()
        .map_err(|error| format!("打开目录选择器失败: {error}"))?;

    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
    }

    let selected = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if selected.is_empty() {
        return Ok(None);
    }

    Ok(Some(selected))
}

fn run_download_task_blocking(
    app: AppHandle,
    payload: DownloadTaskPayload,
    control_file_path: PathBuf,
) -> Result<String, String> {
    let sidecar_root = resolve_sidecar_root(&app);
    let _sidecar_entry = resolve_sidecar_entry(&sidecar_root)?;
    let sidecar_entry_arg = resolve_sidecar_entry_arg();
    let sidecar_node = resolve_sidecar_node(&sidecar_root);
    let request_interval_ms = resolve_request_interval_ms(&payload);

    emit_runtime_log_event(
        &app,
        "INFO",
        "desktop",
        format!("开始执行真实下载任务: {}", payload.detail_url),
        Some(payload.task_id.clone()),
        None,
    )?;

    emit_runtime_log_event(
        &app,
        "INFO",
        "desktop",
        format!(
            "sidecar runtime: node={}, root={}, entry={}",
            sidecar_node.display(),
            sidecar_root.display(),
            sidecar_entry_arg
        ),
        Some(payload.task_id.clone()),
        None,
    )?;

    let mut command = Command::new(sidecar_node);
    command
        .arg(sidecar_entry_arg)
        .current_dir(&sidecar_root)
        .env("MCD_OUTPUT_DIR", &payload.output_root_dir)
        .env("MCD_BOOTSTRAP_TASK_ID", &payload.task_id)
        .env("MCD_BOOTSTRAP_TASK_URL", &payload.detail_url)
        .env("MCD_BOOTSTRAP_OUTPUT_DIR", &payload.output_root_dir)
        .env("MCD_BOOTSTRAP_SOURCE_HINT", &payload.source_hint)
        .env("MCD_DOUBAN_ASSET_TYPE", &payload.douban_asset_type)
        .env("MCD_IMAGE_COUNT_MODE", &payload.image_count_mode)
        .env("MCD_BOOTSTRAP_MAX_IMAGES", payload.max_images.to_string())
        .env("MCD_BOOTSTRAP_OUTPUT_FORMAT", &payload.output_image_format)
        .env(
            "MCD_TASK_CONTROL_FILE",
            control_file_path.to_string_lossy().into_owned(),
        )
        // 任务级请求间隔统一写进 sidecar 环境，让真实请求链路共用。
        .env("MCD_REQUEST_INTERVAL_MS", request_interval_ms.to_string())
        .env(
            "MCD_BOOTSTRAP_REQUEST_INTERVAL_MS",
            request_interval_ms.to_string(),
        )
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }

    if let Some(cookie) = payload.douban_cookie.as_ref() {
        command.env("MCD_DOUBAN_COOKIE", cookie);
    } else {
        command.env_remove("MCD_DOUBAN_COOKIE");
    }

    let mut child = command
        .spawn()
        .map_err(|error| format!("启动 sidecar 失败: {error}"))?;

    if let Some(parent) = control_file_path.parent() {
        fs::create_dir_all(parent).map_err(|error| format!("创建任务控制目录失败: {error}"))?;
    }
    fs::write(task_pid_file_path(&control_file_path), child.id().to_string())
        .map_err(|error| format!("写入任务进程标记失败: {error}"))?;

    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "无法读取 sidecar stdout".to_string())?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "无法读取 sidecar stderr".to_string())?;

    let result_holder = Arc::new(Mutex::new(None));
    let error_holder = Arc::new(Mutex::new(None));

    let stdout_app = app.clone();
    let stdout_task_id = payload.task_id.clone();
    let stdout_result_holder = Arc::clone(&result_holder);
    let stdout_error_holder = Arc::clone(&error_holder);
    let stdout_thread = thread::spawn(move || {
        for line in BufReader::new(stdout).lines().map_while(Result::ok) {
            parse_sidecar_stdout_line(
                &stdout_app,
                &stdout_task_id,
                &line,
                &stdout_result_holder,
                &stdout_error_holder,
            );
        }
    });

    let stderr_app = app.clone();
    let stderr_task_id = payload.task_id.clone();
    let stderr_error_holder = Arc::clone(&error_holder);
    let stderr_thread = thread::spawn(move || {
        for line in BufReader::new(stderr).lines().map_while(Result::ok) {
            parse_sidecar_stderr_line(&stderr_app, &stderr_task_id, &line, &stderr_error_holder);
        }
    });

    let status = child
        .wait()
        .map_err(|error| format!("等待 sidecar 任务结束失败: {error}"))?;

    let _ = stdout_thread.join();
    let _ = stderr_thread.join();

    if !status.success() {
        let sidecar_message = error_holder
            .lock()
            .map_err(|_| "读取 sidecar 错误信息失败".to_string())?
            .clone();
        return Err(format_sidecar_exit_error(
            status.code(),
            sidecar_message.as_deref(),
        ));
    }

    let result = match result_holder
        .lock()
        .map_err(|_| "读取 sidecar 结果失败".to_string())?
        .clone()
    {
        Some(result) => result,
        None => {
            let sidecar_message = error_holder
                .lock()
                .map_err(|_| "读取 sidecar 错误信息失败".to_string())?
                .clone();
            return Err(sidecar_message.unwrap_or_else(|| "sidecar 未返回任务结果".to_string()));
        }
    };

    serde_json::to_string(&result).map_err(|error| format!("序列化任务结果失败: {error}"))
}

#[tauri::command]
async fn run_download_task(
    app: AppHandle,
    payload: DownloadTaskPayload,
    registry: tauri::State<'_, TaskControlRegistry>,
) -> Result<String, String> {
    // 真实抓取链路会持续几秒到几十秒，这里必须让出桌面主线程，避免窗口假死。
    let task_id = payload.task_id.clone();
    let control_file_path = task_control_file_path(&app, &task_id)?;
    registry.register_control_file(task_id.clone(), control_file_path.clone())?;

    let result = run_blocking_job(move || run_download_task_blocking(app, payload, control_file_path)).await;
    registry.unregister_task(&task_id);
    result
}

#[tauri::command]
fn open_output_dir(app: AppHandle) -> Result<String, String> {
    let output_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("无法获取应用数据目录: {error}"))?
        .join("covers")
        .join("internal");

    fs::create_dir_all(&output_dir).map_err(|error| format!("创建输出目录失败: {error}"))?;
    Ok(output_dir.to_string_lossy().into_owned())
}

#[tauri::command]
fn open_directory_path(directory_path: String) -> Result<(), String> {
    let directory = ensure_existing_directory(&directory_path)?;

    #[cfg(target_os = "windows")]
    {
        Command::new("explorer.exe")
            .arg(&directory)
            .spawn()
            .map_err(|error| format!("打开目录失败: {error}"))?;
    }

    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .arg(&directory)
            .spawn()
            .map_err(|error| format!("打开目录失败: {error}"))?;
    }

    #[cfg(all(not(target_os = "windows"), not(target_os = "macos")))]
    {
        Command::new("xdg-open")
            .arg(&directory)
            .spawn()
            .map_err(|error| format!("打开目录失败: {error}"))?;
    }

    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(TaskControlRegistry::default())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            load_persisted_state,
            check_login_window_cookie_status,
            close_login_window,
            save_persisted_state,
            emit_runtime_log,
            pause_download_task,
            resume_download_task,
            clear_download_tasks,
            delete_directory_path,
            pick_output_directory,
            run_download_task,
            open_output_dir,
            open_directory_path
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::{
        delete_directory_path, format_sidecar_exit_error, is_recoverable_sqlite_error, load_snapshot_from_sqlite,
        next_runtime_log_seed, open_state_db_path, resolve_douban_login_cookie_status,
        resolve_sidecar_entry_arg, resolve_sidecar_event_task_id, resolve_sidecar_node,
        rotate_corrupted_state_db, run_blocking_job, save_snapshot_to_sqlite_path_with_recovery,
        TaskControlRegistry,
    };
    use std::{
        fs,
        path::PathBuf,
        sync::{
            atomic::{AtomicBool, Ordering},
            Arc,
        },
        time::{SystemTime, UNIX_EPOCH},
    };

    fn test_temp_dir(label: &str) -> PathBuf {
        let millis = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|duration| duration.as_millis())
            .unwrap_or(0);
        let dir = std::env::temp_dir().join(format!("movie-cover-downloader-{label}-{millis}"));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn run_blocking_job_executes_closure_and_returns_result() {
        tauri::async_runtime::block_on(async {
            let executed = Arc::new(AtomicBool::new(false));
            let executed_for_job = Arc::clone(&executed);

            let result = run_blocking_job(move || {
                executed_for_job.store(true, Ordering::SeqCst);
                Ok::<_, String>("ok".to_string())
            })
            .await;

            assert_eq!(result.unwrap(), "ok");
            assert!(executed.load(Ordering::SeqCst));
        });
    }

    #[test]
    fn resolve_douban_login_cookie_status_returns_closed_when_window_is_missing() {
        let empty_cookies: [(&str, &str); 0] = [];
        let status = resolve_douban_login_cookie_status(false, &empty_cookies);

        assert_eq!(status.status, "closed");
        assert_eq!(status.cookie, None);
    }

    #[test]
    fn resolve_douban_login_cookie_status_returns_pending_when_required_cookies_are_incomplete() {
        let cookies = [("dbcl2", "\"user:token\""), ("bid", "abc123")];
        let status = resolve_douban_login_cookie_status(true, &cookies);

        assert_eq!(status.status, "pending");
        assert_eq!(status.cookie, None);
    }

    #[test]
    fn resolve_douban_login_cookie_status_returns_ready_with_cookie_string() {
        let cookies = [
            ("bid", "abc123"),
            ("dbcl2", "\"user:token\""),
            ("ck", "xyz789"),
        ];
        let status = resolve_douban_login_cookie_status(true, &cookies);

        assert_eq!(status.status, "ready");
        assert_eq!(
            status.cookie.as_deref(),
            Some("bid=abc123; dbcl2=\"user:token\"; ck=xyz789")
        );
    }

    #[test]
    fn format_sidecar_exit_error_prefers_original_sidecar_message() {
        let error = format_sidecar_exit_error(
            Some(1),
            Some("douban photo category is empty|title=%E6%B6%88%E5%A4%B1%E7%9A%84%E4%BA%BA"),
        );

        assert_eq!(
            error,
            "douban photo category is empty|title=%E6%B6%88%E5%A4%B1%E7%9A%84%E4%BA%BA"
        );
    }

    #[test]
    fn format_sidecar_exit_error_falls_back_to_exit_code_when_message_is_missing() {
        let error = format_sidecar_exit_error(Some(1), None);

        assert_eq!(error, "sidecar 任务执行失败，退出码 Some(1)");
    }

    #[test]
    fn resolve_sidecar_event_task_id_maps_bootstrap_task_to_frontend_task() {
        assert_eq!(
            resolve_sidecar_event_task_id(Some("bootstrap-url-task"), "task-301"),
            "task-301"
        );
        assert_eq!(
            resolve_sidecar_event_task_id(Some("task-302"), "task-301"),
            "task-302"
        );
    }

    #[test]
    fn resolve_sidecar_entry_arg_uses_relative_entrypoint() {
        assert_eq!(resolve_sidecar_entry_arg(), "./dist/index.js");
    }

    #[test]
    fn resolve_sidecar_node_prefers_bundled_node_when_present() {
        let temp_dir = test_temp_dir("bundled-node");
        let node_path = temp_dir.join(if cfg!(windows) { "node.exe" } else { "node" });
        fs::write(&node_path, "").unwrap();

        assert_eq!(resolve_sidecar_node(&temp_dir), node_path);

        let _ = fs::remove_dir_all(temp_dir);
    }

    #[test]
    fn recoverable_sqlite_error_detection_matches_corrupted_database_keywords() {
        assert!(is_recoverable_sqlite_error(
            "打开 SQLite 状态库失败: file is not a database"
        ));
        assert!(is_recoverable_sqlite_error(
            "初始化 SQLite 状态库失败: database disk image is malformed"
        ));
        assert!(!is_recoverable_sqlite_error("写入 logs 失败: 日志缺少 id"));
    }

    #[test]
    fn rotate_corrupted_state_db_renames_main_db_and_sidecars() {
        let temp_dir = test_temp_dir("rotate-db");
        let db_path = temp_dir.join("runtime-state.sqlite");
        let wal_path = temp_dir.join("runtime-state.sqlite-wal");
        let shm_path = temp_dir.join("runtime-state.sqlite-shm");
        fs::write(&db_path, "broken").unwrap();
        fs::write(&wal_path, "wal").unwrap();
        fs::write(&shm_path, "shm").unwrap();

        let backup_path = rotate_corrupted_state_db(&db_path).unwrap();

        assert!(!db_path.exists());
        assert!(!wal_path.exists());
        assert!(!shm_path.exists());
        assert!(backup_path.exists());
        assert!(backup_path.with_extension("sqlite-wal").exists());
        assert!(backup_path.with_extension("sqlite-shm").exists());

        let _ = fs::remove_dir_all(temp_dir);
    }

    #[test]
    fn save_snapshot_with_recovery_recreates_corrupted_sqlite_database() {
        let temp_dir = test_temp_dir("save-recover");
        let db_path = temp_dir.join("runtime-state.sqlite");
        fs::write(&db_path, "not-a-sqlite-database").unwrap();

        let snapshot = serde_json::json!({
            "schemaVersion": 2,
            "tasks": [
                {
                    "id": "task-1",
                    "title": "待解析标题",
                    "target": {
                        "detailUrl": "https://movie.douban.com/subject/34780991/",
                        "outputRootDir": "D:/cover",
                        "sourceHint": "auto",
                        "doubanAssetType": "still",
                        "imageCountMode": "limited",
                        "maxImages": 50,
                        "outputImageFormat": "jpg",
                        "requestIntervalSeconds": 1
                    },
                    "lifecycle": {
                        "phase": "queued",
                        "attempts": 0,
                        "updatedAt": "2026-05-02 14:00:00"
                    },
                    "summary": "等待中"
                }
            ],
            "cookies": [
                {
                    "id": "300",
                    "source": "douban",
                    "status": "active",
                    "success": 0,
                    "failure": 0,
                    "note": "test",
                    "value": "dbcl2=test; ck=test"
                }
            ],
            "logs": [
                {
                    "id": 10001,
                    "level": "INFO",
                    "scope": "bootstrap",
                    "timestamp": "2026-05-02 14:00:00",
                    "message": "应用已就绪"
                }
            ],
            "queueConfig": {
                "batchSize": 4,
                "concurrency": 2,
                "failureCooldownMs": 10000,
                "maxAttempts": 3
            }
        });

        save_snapshot_to_sqlite_path_with_recovery(&db_path, &snapshot).unwrap();

        let sibling_files = fs::read_dir(&temp_dir)
            .unwrap()
            .map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned())
            .collect::<Vec<_>>();
        assert!(sibling_files.iter().any(|name| name.starts_with("runtime-state.corrupt-")));

        let connection = open_state_db_path(&db_path).unwrap();
        let loaded = load_snapshot_from_sqlite(&connection).unwrap().unwrap();
        assert_eq!(
            loaded["tasks"][0]["id"].as_str(),
            Some("task-1")
        );
        assert_eq!(
            loaded["cookies"][0]["id"].as_str(),
            Some("300")
        );
        assert_eq!(
            loaded["logs"][0]["id"].as_i64(),
            Some(10001)
        );

        let _ = fs::remove_dir_all(temp_dir);
    }

    #[test]
    fn load_snapshot_keeps_persisted_task_order() {
        let temp_dir = test_temp_dir("task-order");
        let db_path = temp_dir.join("runtime-state.sqlite");
        let snapshot = serde_json::json!({
            "schemaVersion": 2,
            "tasks": [
                { "id": "new-task", "payload": "new" },
                { "id": "old-task", "payload": "old" }
            ],
            "cookies": [],
            "logs": [],
            "queueConfig": {}
        });

        save_snapshot_to_sqlite_path_with_recovery(&db_path, &snapshot).unwrap();
        let connection = open_state_db_path(&db_path).unwrap();
        let loaded = load_snapshot_from_sqlite(&connection).unwrap().unwrap();

        assert_eq!(loaded["tasks"][0]["id"].as_str(), Some("new-task"));
        assert_eq!(loaded["tasks"][1]["id"].as_str(), Some("old-task"));

        let _ = fs::remove_dir_all(temp_dir);
    }

    #[test]
    fn delete_directory_path_removes_existing_output_directory() {
        let temp_dir = test_temp_dir("delete-output");
        let output_dir = temp_dir.join("Movie - 2026-05-02").join("still");
        fs::create_dir_all(&output_dir).unwrap();
        fs::write(output_dir.join("image.jpg"), "image").unwrap();

        let deleted = delete_directory_path(
            output_dir.to_string_lossy().into_owned(),
            temp_dir.to_string_lossy().into_owned(),
        )
        .unwrap();

        assert!(deleted);
        assert!(!output_dir.exists());

        let _ = fs::remove_dir_all(temp_dir);
    }

    #[test]
    fn delete_directory_path_rejects_root_directory() {
        let temp_dir = test_temp_dir("delete-root");

        let error = delete_directory_path(
            temp_dir.to_string_lossy().into_owned(),
            temp_dir.to_string_lossy().into_owned(),
        )
        .unwrap_err();

        assert!(error.contains("拒绝删除输出根目录"));
        assert!(temp_dir.exists());

        let _ = fs::remove_dir_all(temp_dir);
    }

    #[test]
    fn delete_directory_path_rejects_directory_outside_root() {
        let root_dir = test_temp_dir("delete-root-boundary");
        let outside_dir = test_temp_dir("delete-outside-boundary");

        let error = delete_directory_path(
            outside_dir.to_string_lossy().into_owned(),
            root_dir.to_string_lossy().into_owned(),
        )
        .unwrap_err();

        assert!(error.contains("拒绝删除输出根目录外的目录"));
        assert!(outside_dir.exists());

        let _ = fs::remove_dir_all(root_dir);
        let _ = fs::remove_dir_all(outside_dir);
    }

    #[test]
    fn next_runtime_log_seed_uses_loaded_log_max_id_plus_one() {
        let logs = vec![
            serde_json::json!({ "id": 1, "message": "seed" }),
            serde_json::json!({ "id": 10000, "message": "cookie imported" }),
            serde_json::json!({ "id": 10007, "message": "task queued" }),
        ];

        assert_eq!(next_runtime_log_seed(&logs), Some(10008));
    }

    #[test]
    fn task_control_registry_marks_task_as_paused() {
        let registry = TaskControlRegistry::default();
        registry.pause("task-1".to_string()).unwrap();

        assert!(registry.is_paused("task-1"));
    }

    #[test]
    fn task_control_registry_clears_pause_flag_on_resume() {
        let registry = TaskControlRegistry::default();
        registry.pause("task-1".to_string()).unwrap();
        registry.resume("task-1").unwrap();

        assert!(!registry.is_paused("task-1"));
    }
}
