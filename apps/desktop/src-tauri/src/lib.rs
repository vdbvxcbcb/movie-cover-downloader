// Tauri 命令层：负责持久化、sidecar 进程、文件系统操作和前端事件转发。
//
// 这份文件是桌面端的“后端入口”，前端通过 runtime-bridge.ts 调用这里的 #[tauri::command]。
// 主要链路可以按下面理解：
// 1. 前端提交任务 -> run_download_task -> 启动 Node sidecar 执行真实抓取。
// 2. sidecar 把日志、实时进度、最终结果写到 stdout -> Rust 解析后 emit 给前端。
// 3. 前端状态快照通过 save_persisted_state/load_persisted_state 存取到 SQLite。
// 4. 删除/清空任务、打开目录、自定义裁剪保存等本地文件能力也都集中在这里。
//
// 注释里说的“前端”通常指 apps/desktop/src，“sidecar”指 apps/sidecar/src。
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use serde_json::Value;
#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;
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
#[cfg(target_os = "windows")]
use windows_sys::Win32::{
    Foundation::LocalFree,
    Security::Cryptography::{
        CryptProtectData, CryptUnprotectData, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB,
    },
};

#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x08000000;

// 日志 id 在 Rust 侧生成，避免前端批量接收时出现重复 key。
static LOG_ID_SEED: AtomicU64 = AtomicU64::new(10_000);

// 持久化快照版本号和前端 AppSeedState.schemaVersion 对齐，用来丢弃不兼容的旧状态。
const APP_STATE_SCHEMA_VERSION: i64 = 2;
const MAX_TASK_ID_LEN: usize = 96;
const PROTECTED_COOKIE_PAYLOAD_SCHEME: &str = "win32-dpapi";

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
// 前端主动写日志时传入的 payload；字段命名用 camelCase，serde 会映射到 Rust 的 snake_case。
struct RuntimeLogPayload {
    level: String,
    scope: String,
    timestamp: Option<String>,
    message: String,
    task_id: Option<String>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
// 发回前端的日志事件。Rust 会补齐 id 和 timestamp，前端日志列表直接消费这个结构。
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
// 发回前端的实时下载进度事件，专门驱动队列表格里的 saved/target 和进度条。
struct RuntimeTaskProgressEvent {
    task_id: String,
    phase: String,
    target_count: u32,
    saved_count: u32,
    timestamp: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
// 前端创建下载任务时传给 Rust 的完整参数，Rust 再转换成 sidecar 的环境变量。
struct DownloadTaskPayload {
    // 前端任务 id，用于日志、进度、暂停/取消控制文件和最终结果回填。
    task_id: String,
    // 用户输入的豆瓣详情页链接，sidecar 会由它解析片名和图片分类页。
    detail_url: String,
    // 用户选择的输出根目录，例如 D:/cover；具体影片/分类目录由 sidecar 继续拼接。
    output_root_dir: String,
    // 当前界面默认 auto，保留字段是为了和前端类型/sidecar 契约兼容。
    source_hint: String,
    // 豆瓣图片分类：still/poster/wallpaper，对应剧照、海报、壁纸。
    douban_asset_type: String,
    // limited/unlimited，决定 max_images 是否作为下载数量上限。
    image_count_mode: String,
    max_images: u32,
    // 最终保存格式：jpg 或 png。sidecar 会负责必要的转码。
    output_image_format: String,
    // 图片比例策略：original 保持原图，9:16/3:4 由 sidecar 居中裁剪。
    image_aspect_ratio: String,
    // 用户设置的请求间隔秒数，进入 sidecar 前会被限制在 1-5 秒。
    request_interval_seconds: Option<u32>,
    // 可选豆瓣 Cookie；登录页导入或手动导入后由前端传入。
    douban_cookie: Option<String>,
}

#[derive(Debug, Serialize, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
// 豆瓣登录小窗口的 Cookie 检查结果：pending 表示继续等，ready 表示可以导入，closed 表示用户关窗。
struct LoginWindowCookieStatus {
    status: String,
    cookie: Option<String>,
}

#[derive(Default)]
// 任务控制注册表把前端的暂停/继续/取消意图写入控制文件，sidecar 轮询该文件响应。
struct TaskControlRegistry {
    paused: Mutex<HashSet<String>>,
    control_files: Mutex<HashMap<String, PathBuf>>,
}

// Registry 的内存状态负责“当前前端希望暂停哪些任务”，控制文件负责通知已经启动的 sidecar 进程。
impl TaskControlRegistry {
    // 只更新内存暂停集合，不直接写文件；写文件由 sync_pause_request 统一完成。
    fn pause(&self, task_id: String) -> Result<(), String> {
        if let Ok(mut paused) = self.paused.lock() {
            paused.insert(task_id);
            return Ok(());
        }

        Err("无法写入暂停状态".to_string())
    }

    // 从暂停集合移除任务，下一次写控制文件时 sidecar 会看到 resume。
    fn resume(&self, task_id: &str) -> Result<(), String> {
        if let Ok(mut paused) = self.paused.lock() {
            paused.remove(task_id);
            return Ok(());
        }

        Err("无法清理暂停状态".to_string())
    }

    fn is_paused(&self, task_id: &str) -> bool {
        self.paused
            .lock()
            .map(|paused| paused.contains(task_id))
            .unwrap_or(false)
    }

    // 任务开始前注册控制文件路径，并立即写入当前动作，避免 sidecar 启动后读不到初始状态。
    fn register_control_file(&self, task_id: String, control_file: PathBuf) -> Result<(), String> {
        {
            let mut control_files = self
                .control_files
                .lock()
                .map_err(|_| "无法注册任务控制文件".to_string())?;
            control_files.insert(task_id.clone(), control_file.clone());
        }

        self.write_control_action(&task_id)
    }

    // 任务结束、失败、删除或清空时清理控制文件和 pid 文件，避免旧控制信号影响下次同名任务。
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

    // 前端点击暂停时调用：先改内存，再把 pause 写到控制文件。
    fn sync_pause_request(&self, task_id: String) -> Result<(), String> {
        self.pause(task_id.clone())?;
        self.write_control_action(&task_id)
    }

    // 前端点击继续时调用：先移除暂停标记，再把 resume 写到控制文件。
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

    // 删除/清空任务时调用：写 cancel 给 sidecar，让下载循环主动中止。
    fn sync_cancel_request(&self, task_id: &str) -> Result<(), String> {
        if let Ok(mut paused) = self.paused.lock() {
            paused.remove(task_id);
        }

        self.write_control_action_value(task_id, "cancel")
    }

    // 控制文件只有简单文本值 pause/resume/cancel，sidecar 轮询读取，比跨进程 IPC 更轻量。
    fn write_control_action_value(&self, task_id: &str, action: &str) -> Result<(), String> {
        let control_file = self
            .control_files
            .lock()
            .map_err(|_| "无法读取任务控制文件".to_string())?
            .get(task_id)
            .cloned();

        let Some(control_file) = control_file else {
            return Ok(());
        };

        if let Some(parent) = control_file.parent() {
            fs::create_dir_all(parent).map_err(|error| format!("创建任务控制目录失败: {error}"))?;
        }

        fs::write(&control_file, action).map_err(|error| format!("写入任务控制文件失败: {error}"))
    }
}

// 把前端秒级请求间隔转成毫秒，并硬性限制范围，防止过快请求触发站点风控。
fn resolve_request_interval_ms(payload: &DownloadTaskPayload) -> u32 {
    let interval_ms = payload
        .request_interval_seconds
        .map(|seconds| seconds.saturating_mul(1000))
        .unwrap_or(1000);

    interval_ms.clamp(1000, 5000)
}

fn validate_task_id(task_id: &str) -> Result<&str, String> {
    let trimmed = task_id.trim();
    if trimmed.is_empty() {
        return Err("任务 id 不能为空".to_string());
    }
    if trimmed != task_id {
        return Err("任务 id 不能包含首尾空白".to_string());
    }
    if trimmed.len() > MAX_TASK_ID_LEN {
        return Err("任务 id 过长".to_string());
    }
    if !trimmed
        .bytes()
        .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_')
    {
        return Err("任务 id 只能包含字母、数字、短横线和下划线".to_string());
    }

    Ok(trimmed)
}

fn hex_encode(bytes: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut encoded = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        encoded.push(HEX[(byte >> 4) as usize] as char);
        encoded.push(HEX[(byte & 0x0f) as usize] as char);
    }
    encoded
}

fn hex_decode(value: &str) -> Result<Vec<u8>, String> {
    let bytes = value.as_bytes();
    if bytes.len() % 2 != 0 {
        return Err("受保护 Cookie 数据格式无效".to_string());
    }

    bytes
        .chunks_exact(2)
        .map(|chunk| {
            let high = hex_nibble(chunk[0])?;
            let low = hex_nibble(chunk[1])?;
            Ok((high << 4) | low)
        })
        .collect()
}

fn hex_nibble(byte: u8) -> Result<u8, String> {
    match byte {
        b'0'..=b'9' => Ok(byte - b'0'),
        b'a'..=b'f' => Ok(byte - b'a' + 10),
        b'A'..=b'F' => Ok(byte - b'A' + 10),
        _ => Err("解析受保护 Cookie 数据失败: 不是十六进制字符".to_string()),
    }
}

#[cfg(target_os = "windows")]
fn protect_bytes(plain: &[u8]) -> Result<Vec<u8>, String> {
    let mut input = CRYPT_INTEGER_BLOB {
        cbData: plain.len() as u32,
        pbData: plain.as_ptr() as *mut u8,
    };
    let mut output = CRYPT_INTEGER_BLOB {
        cbData: 0,
        pbData: std::ptr::null_mut(),
    };

    let ok = unsafe {
        CryptProtectData(
            &mut input,
            std::ptr::null(),
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            CRYPTPROTECT_UI_FORBIDDEN,
            &mut output,
        )
    };
    if ok == 0 {
        return Err("加密 Cookie 失败".to_string());
    }

    let protected =
        unsafe { std::slice::from_raw_parts(output.pbData, output.cbData as usize).to_vec() };
    unsafe {
        LocalFree(output.pbData as _);
    }
    Ok(protected)
}

#[cfg(target_os = "windows")]
fn unprotect_bytes(protected: &[u8]) -> Result<Vec<u8>, String> {
    let mut input = CRYPT_INTEGER_BLOB {
        cbData: protected.len() as u32,
        pbData: protected.as_ptr() as *mut u8,
    };
    let mut output = CRYPT_INTEGER_BLOB {
        cbData: 0,
        pbData: std::ptr::null_mut(),
    };

    let ok = unsafe {
        CryptUnprotectData(
            &mut input,
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            CRYPTPROTECT_UI_FORBIDDEN,
            &mut output,
        )
    };
    if ok == 0 {
        return Err("解密 Cookie 失败".to_string());
    }

    let plain =
        unsafe { std::slice::from_raw_parts(output.pbData, output.cbData as usize).to_vec() };
    unsafe {
        LocalFree(output.pbData as _);
    }
    Ok(plain)
}

#[cfg(not(target_os = "windows"))]
fn protect_bytes(plain: &[u8]) -> Result<Vec<u8>, String> {
    Ok(plain.to_vec())
}

#[cfg(not(target_os = "windows"))]
fn unprotect_bytes(protected: &[u8]) -> Result<Vec<u8>, String> {
    Ok(protected.to_vec())
}

fn serialize_cookie_payload(cookie: &Value) -> Result<String, String> {
    let payload =
        serde_json::to_vec(cookie).map_err(|error| format!("序列化 cookie 失败: {error}"))?;
    let protected = protect_bytes(&payload)?;
    serde_json::to_string(&serde_json::json!({
        "protected": true,
        "scheme": PROTECTED_COOKIE_PAYLOAD_SCHEME,
        "payload": hex_encode(&protected)
    }))
    .map_err(|error| format!("序列化受保护 cookie 失败: {error}"))
}

fn deserialize_cookie_payload(payload: &str) -> Result<Value, String> {
    let parsed = serde_json::from_str::<Value>(payload)
        .map_err(|error| format!("解析 cookie 失败: {error}"))?;
    let is_protected = parsed
        .get("protected")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    if !is_protected {
        return Ok(parsed);
    }

    if parsed.get("scheme").and_then(Value::as_str) != Some(PROTECTED_COOKIE_PAYLOAD_SCHEME) {
        return Err("不支持的 Cookie 保护格式".to_string());
    }
    let encrypted = parsed
        .get("payload")
        .and_then(Value::as_str)
        .ok_or_else(|| "受保护 Cookie 缺少 payload".to_string())
        .and_then(hex_decode)?;
    let decrypted = unprotect_bytes(&encrypted)?;
    serde_json::from_slice::<Value>(&decrypted)
        .map_err(|error| format!("解析解密后的 cookie 失败: {error}"))
}

// 这里用毫秒时间戳字符串，前端 runtime-bridge 会再格式化成中文时间。
fn timestamp_now() -> String {
    let millis = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or(0);
    millis.to_string()
}

// 旧版 JSON 快照路径，仅用于迁移；新版本主要使用 SQLite。
fn state_file_path(app: &AppHandle) -> Result<PathBuf, String> {
    let base_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("无法获取应用数据目录: {error}"))?;

    Ok(base_dir.join("runtime-state.json"))
}

// SQLite 状态库放在 Tauri 应用数据目录，不会被打进安装包，也不会污染用户输出目录。
fn sqlite_db_path(app: &AppHandle) -> Result<PathBuf, String> {
    let base_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("无法获取应用数据目录: {error}"))?;

    Ok(base_dir.join("runtime-state.sqlite"))
}

// 本地状态存入 SQLite，并启用 WAL 以降低频繁日志写入时的锁冲突。
fn open_state_db_path(db_path: &Path) -> Result<Connection, String> {
    if let Some(parent) = db_path.parent() {
        fs::create_dir_all(parent).map_err(|error| format!("创建状态目录失败: {error}"))?;
    }

    let connection =
        Connection::open(&db_path).map_err(|error| format!("打开 SQLite 状态库失败: {error}"))?;
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

fn open_state_db(app: &AppHandle) -> Result<Connection, String> {
    let db_path = sqlite_db_path(app)?;
    open_state_db_path(&db_path)
}

// 这些错误通常表示状态库不可继续使用，可以备份后重建，避免应用启动失败。
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

// SQLite WAL 模式会产生 -wal 和 -shm 侧文件，备份/恢复时必须和主库一起处理。
fn sqlite_sidecar_paths(db_path: &Path) -> [PathBuf; 3] {
    [
        db_path.to_path_buf(),
        db_path.with_extension("sqlite-wal"),
        db_path.with_extension("sqlite-shm"),
    ]
}

// 状态库损坏时先把主库和 WAL/SHM 侧文件整体改名备份，再创建干净库继续运行。
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

// 只对固定表名调用该函数，避免把用户输入拼进 SQL。
fn count_rows(connection: &Connection, table_name: &str) -> Result<i64, String> {
    let sql = format!("SELECT COUNT(*) FROM {table_name}");
    connection
        .query_row(&sql, [], |row| row.get::<_, i64>(0))
        .map_err(|error| format!("统计 {table_name} 行数失败: {error}"))
}

// 判断是否已有真实状态，用来决定是否需要从旧 JSON 迁移。
fn sqlite_has_any_state(connection: &Connection) -> Result<bool, String> {
    let tasks = count_rows(connection, "tasks")?;
    let cookies = count_rows(connection, "cookies")?;
    let logs = count_rows(connection, "app_logs")?;
    let meta = count_rows(connection, "app_meta")?;

    Ok(tasks > 0 || cookies > 0 || logs > 0 || meta > 0)
}

// 从快照根对象读取数组字段；字段缺失时返回空数组，让旧快照也能被温和处理。
fn value_array_from_root<'a>(root: &'a Value, key: &str) -> &'a [Value] {
    root.get(key)
        .and_then(Value::as_array)
        .map(Vec::as_slice)
        .unwrap_or(&[])
}

// 重新启动后继续使用已有最大日志 id，避免新日志和历史日志 id 重复。
fn next_runtime_log_seed(logs: &[Value]) -> Option<u64> {
    logs.iter()
        .filter_map(|log| log.get("id").and_then(Value::as_u64))
        .max()
        .map(|max_id| max_id.saturating_add(1))
}

// 前端仍以整体快照保存，Rust 侧在一个事务内拆分写入任务、Cookie、日志和配置表。
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
    let create_task_output_root_dir = snapshot
        .get("createTaskOutputRootDir")
        .cloned()
        .unwrap_or_else(|| Value::String(String::new()));
    let image_process_output_root_dir = snapshot
        .get("imageProcessOutputRootDir")
        .cloned()
        .unwrap_or_else(|| Value::String(String::new()));

    // 整体快照写入采用“先清空再重建”的事务模型，保证任务/Cookie/日志始终来自同一版本快照。
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
        // 任务表按前端数组顺序写入，读取时用 rowid ASC 保留用户看到的队列顺序。
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
            let payload = serialize_cookie_payload(cookie)?;
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
    let create_task_output_root_dir_json = serde_json::to_string(&create_task_output_root_dir)
        .map_err(|error| format!("序列化 createTaskOutputRootDir 失败: {error}"))?;
    let image_process_output_root_dir_json = serde_json::to_string(&image_process_output_root_dir)
        .map_err(|error| format!("序列化 imageProcessOutputRootDir 失败: {error}"))?;

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
        .execute(
            "INSERT OR REPLACE INTO app_meta (key, value_json) VALUES (?1, ?2)",
            params!["createTaskOutputRootDir", create_task_output_root_dir_json],
        )
        .map_err(|error| format!("写入 createTaskOutputRootDir 失败: {error}"))?;
    transaction
        .execute(
            "INSERT OR REPLACE INTO app_meta (key, value_json) VALUES (?1, ?2)",
            params![
                "imageProcessOutputRootDir",
                image_process_output_root_dir_json
            ],
        )
        .map_err(|error| format!("写入 imageProcessOutputRootDir 失败: {error}"))?;

    transaction
        .commit()
        .map_err(|error| format!("提交 SQLite 事务失败: {error}"))
}

// 兼容旧版 JSON 状态文件：只有 SQLite 为空时才迁移，避免覆盖新状态。
fn migrate_json_snapshot_if_needed(
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

// 从 SQLite 重新组装成前端熟悉的 AppSeedState JSON，前端无需关心底层表结构。
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
    let create_task_output_root_dir_json = connection
        .query_row(
            "SELECT value_json FROM app_meta WHERE key = ?1",
            params!["createTaskOutputRootDir"],
            |row| row.get::<_, String>(0),
        )
        .ok();
    let image_process_output_root_dir_json = connection
        .query_row(
            "SELECT value_json FROM app_meta WHERE key = ?1",
            params!["imageProcessOutputRootDir"],
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
    let create_task_output_root_dir = create_task_output_root_dir_json
        .as_deref()
        .and_then(|raw| serde_json::from_str::<Value>(raw).ok())
        .unwrap_or_else(|| Value::String(String::new()));
    let image_process_output_root_dir = image_process_output_root_dir_json
        .as_deref()
        .and_then(|raw| serde_json::from_str::<Value>(raw).ok())
        .unwrap_or_else(|| Value::String(String::new()));

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

    // Cookie 保存时已经按前端数组顺序写入，读取也按写入顺序恢复，避免重启后优先级反转。
    let mut cookies_statement = connection
        .prepare("SELECT payload_json FROM cookies ORDER BY rowid ASC")
        .map_err(|error| format!("读取 cookies 失败: {error}"))?;
    let cookie_rows = cookies_statement
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(|error| format!("遍历 cookies 失败: {error}"))?;
    let mut cookies = Vec::new();
    for row in cookie_rows {
        let payload = row.map_err(|error| format!("读取 cookie 行失败: {error}"))?;
        let parsed = deserialize_cookie_payload(&payload)?;
        cookies.push(parsed);
    }

    // 日志按 id 倒序读取，界面默认最新日志在上。
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
    root.insert(
        "createTaskOutputRootDir".to_string(),
        create_task_output_root_dir,
    );
    root.insert(
        "imageProcessOutputRootDir".to_string(),
        image_process_output_root_dir,
    );

    Ok(Some(Value::Object(root)))
}

fn save_snapshot_to_sqlite_path(db_path: &Path, snapshot: &Value) -> Result<(), String> {
    let mut connection = open_state_db_path(db_path)?;
    write_snapshot_to_sqlite(&mut connection, snapshot)
}

// 保存失败且判断为可恢复损坏时，会自动备份旧库并重试一次写入。
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

// 每个任务一个控制文件，路径在应用数据目录下，避免写到用户选择的图片输出目录。
fn task_control_file_path(app: &AppHandle, task_id: &str) -> Result<PathBuf, String> {
    let task_id = validate_task_id(task_id)?;
    let base_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("无法获取应用数据目录: {error}"))?;

    Ok(base_dir.join("task-control").join(format!("{task_id}.txt")))
}

// pid 文件和控制文件同名不同扩展名，用于清空/删除任务时找到后台 sidecar 进程。
fn task_pid_file_path(control_file_path: &Path) -> PathBuf {
    control_file_path.with_extension("pid")
}

// 所有 Rust/sidecar 日志最终都转成 runtime-log 事件，由前端统一展示和持久化。
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

// 实时进度不只写日志，还单独发 task-progress 事件，保证进度条不等日志批量刷新。
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

// 开发环境直接从仓库的 apps/sidecar 读取 dist/index.js。
fn resolve_dev_sidecar_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("..")
        .join("sidecar")
}

#[cfg(not(debug_assertions))]
// 发布包环境优先从 resources/sidecar 读取已打包的 Node、dist 和依赖。
fn resolve_bundled_sidecar_root(app: &AppHandle) -> Option<PathBuf> {
    let root = app.path().resource_dir().ok()?.join("sidecar");
    root.join("dist").join("index.js").exists().then_some(root)
}

#[cfg(debug_assertions)]
fn resolve_sidecar_root(_app: &AppHandle) -> PathBuf {
    resolve_dev_sidecar_root()
}

#[cfg(not(debug_assertions))]
fn resolve_sidecar_root(app: &AppHandle) -> PathBuf {
    resolve_bundled_sidecar_root(app).unwrap_or_else(resolve_dev_sidecar_root)
}

// 开发环境和安装包环境的 sidecar 路径不同，这里统一解析入口文件并给出清晰错误。
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

// 传给 node 的入口参数固定使用相对路径，避免 Windows 盘符路径被 node 误解析。
fn resolve_sidecar_entry_arg() -> &'static str {
    "./dist/index.js"
}

// 安装包内如果带有 node.exe 就优先使用它；开发环境才回退到系统 node。
fn resolve_sidecar_node(sidecar_root: &Path) -> PathBuf {
    let bundled_node = sidecar_root.join(if cfg!(windows) { "node.exe" } else { "node" });
    if bundled_node.exists() {
        return bundled_node;
    }

    PathBuf::from("node")
}

// sidecar stdout 同时承载日志、进度和最终结果，解析时必须按 kind 分流。
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

    // sidecar 正常输出是 JSON；如果第三方库输出普通文本，也会作为普通日志显示出来。
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

// stderr 一律按错误日志处理，并记住最后一条错误，供 sidecar 异常退出时返回给前端。
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

// Windows 目录选择器通过 PowerShell 调用，单引号需要转义，避免路径里有特殊字符时命令失败。
fn escape_powershell_single_quote(input: &str) -> String {
    input.replace('\'', "''")
}

// 目录选择器只接受真实存在的初始目录，空值或不存在路径都不预填。
fn existing_path(path: Option<String>) -> Option<String> {
    path.filter(|value| !value.trim().is_empty())
        .filter(|value| Path::new(value).exists())
}

// 多线程读取 stdout/stderr 时用 Mutex 保存最近错误，最后统一决定返回给前端的失败原因。
fn remember_sidecar_error_message(error_holder: &Arc<Mutex<Option<String>>>, message: &str) {
    let trimmed = message.trim();
    if trimmed.is_empty() {
        return;
    }

    if let Ok(mut guard) = error_holder.lock() {
        *guard = Some(trimmed.to_string());
    }
}

// sidecar 顶层错误会带固定前缀，返回给用户前去掉它，让错误文案更直接。
fn normalize_sidecar_error_message(message: &str) -> String {
    message
        .trim()
        .strip_prefix("sidecar failed to start: ")
        .unwrap_or(message.trim())
        .to_string()
}

// sidecar 非 0 退出时优先展示业务错误；没有业务错误才展示进程退出码。
fn format_sidecar_exit_error(status_code: Option<i32>, sidecar_message: Option<&str>) -> String {
    match sidecar_message.map(normalize_sidecar_error_message) {
        Some(message) if !message.is_empty() => message,
        _ => format!("sidecar 任务执行失败，退出码 {:?}", status_code),
    }
}

// 打开目录前做存在性和类型校验，避免把错误路径直接交给系统 shell。
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

// 清空或删除任务时会优先读取 pid 文件终止 sidecar 子进程，避免后台继续写图片。
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

// Tauri command 默认在异步运行时里执行，阻塞 IO/进程等待必须放进 spawn_blocking。
async fn run_blocking_job<T, F>(job: F) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, String> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(job)
        .await
        .map_err(|error| format!("后台任务执行失败: {error}"))?
}

// 豆瓣登录导入只把 dbcl2 和 ck 都存在视为登录成功，其他 Cookie 会一起拼成请求头。
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

// 读取 WebView Cookie 是同步/阻塞操作，因此外层命令会通过 run_blocking_job 调用。
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

// 前端启动时调用：读取 SQLite，如果发现库损坏则自动备份并重建。
#[tauri::command]
fn load_persisted_state(app: AppHandle) -> Result<Option<String>, String> {
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

// sidecar 内部默认任务 id 是 bootstrap-url-task，这里把它映射回前端真实 taskId。
fn resolve_sidecar_event_task_id(raw_task_id: Option<&str>, fallback_task_id: &str) -> String {
    match raw_task_id {
        Some(task_id) if !task_id.trim().is_empty() && task_id != "bootstrap-url-task" => {
            task_id.to_string()
        }
        _ => fallback_task_id.to_string(),
    }
}

// 前端轮询登录窗口状态时调用；返回 ready 后前端会关闭窗口并保存 Cookie。
#[tauri::command]
async fn check_login_window_cookie_status(
    app: AppHandle,
    window_label: String,
) -> Result<LoginWindowCookieStatus, String> {
    run_blocking_job(move || read_login_window_cookie_status_blocking(app, window_label)).await
}

// 用户取消或 Cookie 导入完成后关闭豆瓣登录窗口。
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

// 前端状态有变化时调用：传入完整 JSON 快照，由 Rust 写入 SQLite。
#[tauri::command]
fn save_persisted_state(app: AppHandle, snapshot_json: String) -> Result<(), String> {
    let snapshot = serde_json::from_str::<Value>(&snapshot_json)
        .map_err(|error| format!("解析持久化状态失败: {error}"))?;
    let db_path = sqlite_db_path(&app)?;
    save_snapshot_to_sqlite_path_with_recovery(&db_path, &snapshot)
}

// 前端也可以主动写日志，最终仍走同一条 runtime-log 事件管道。
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

// 暂停不会直接杀进程，而是写 pause 控制文件，让 sidecar 在安全检查点停下。
#[tauri::command]
fn pause_download_task(
    app: AppHandle,
    task_id: String,
    registry: tauri::State<TaskControlRegistry>,
) -> Result<bool, String> {
    let task_id = validate_task_id(&task_id)?.to_string();
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

// 继续任务会写 resume；前端随后把任务重新放回队列。
#[tauri::command]
fn resume_download_task(
    app: AppHandle,
    task_id: String,
    registry: tauri::State<TaskControlRegistry>,
) -> Result<bool, String> {
    let task_id = validate_task_id(&task_id)?.to_string();
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

// 删除单任务或清空队列都会走这里：写 cancel、尝试杀进程、清理控制文件。
#[tauri::command]
fn clear_download_tasks(
    app: AppHandle,
    task_ids: Vec<String>,
    registry: tauri::State<TaskControlRegistry>,
) -> Result<usize, String> {
    let mut cleared = 0usize;

    for task_id in task_ids {
        let task_id = validate_task_id(&task_id)?.to_string();
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

// 删除输出目录前必须确认目标在输出根目录内，避免误删用户其他文件。
#[tauri::command]
fn delete_directory_path(
    directory_path: String,
    root_directory_path: String,
) -> Result<bool, String> {
    let directory = PathBuf::from(directory_path.trim());
    if directory.as_os_str().is_empty() || !directory.exists() {
        return Ok(false);
    }
    let root_directory = PathBuf::from(root_directory_path.trim());
    if root_directory.as_os_str().is_empty() || !root_directory.exists() {
        return Err("输出根目录不存在，已取消删除".to_string());
    }

    let directory =
        fs::canonicalize(&directory).map_err(|error| format!("解析输出目录失败: {error}"))?;
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
    if let Some(parent) = directory.parent() {
        let removed_dir_name = directory
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("");
        let parent_dir_name = parent
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("");
        let is_sized_category_dir = ["original", "9x16", "3x4"]
            .iter()
            .any(|suffix| removed_dir_name == format!("{parent_dir_name}-{suffix}"));
        let mut parent_movie_dir = None;

        if parent != root_directory.as_path()
            && parent.starts_with(&root_directory)
            && parent.is_dir()
            && is_sized_category_dir
            && fs::read_dir(parent)
                .map_err(|error| format!("读取输出目录失败 {}: {error}", parent.display()))?
                .next()
                .is_none()
        {
            parent_movie_dir = parent.parent().map(Path::to_path_buf);
            fs::remove_dir(parent)
                .map_err(|error| format!("删除空输出目录失败 {}: {error}", parent.display()))?;
        }
        if let Some(movie_dir) = parent_movie_dir {
            if movie_dir != root_directory
                && movie_dir.starts_with(&root_directory)
                && movie_dir.is_dir()
                && fs::read_dir(&movie_dir)
                    .map_err(|error| format!("读取输出目录失败 {}: {error}", movie_dir.display()))?
                    .next()
                    .is_none()
            {
                fs::remove_dir(&movie_dir).map_err(|error| {
                    format!("删除空输出目录失败 {}: {error}", movie_dir.display())
                })?;
            }
        }
    }

    Ok(true)
}

// 清空输出目录下的所有子目录和文件，但保留输出目录本身。
#[tauri::command]
fn clear_directory_contents(
    directory_path: String,
    root_directory_path: String,
) -> Result<usize, String> {
    let directory = PathBuf::from(directory_path.trim());
    if directory.as_os_str().is_empty() {
        return Err("输出目录不能为空，已取消清空".to_string());
    }
    let root_directory = PathBuf::from(root_directory_path.trim());
    if root_directory.as_os_str().is_empty() {
        return Err("输出根目录不能为空，已取消清空".to_string());
    }
    if !directory.exists() {
        return Ok(0);
    }
    if !root_directory.exists() {
        return Err("输出根目录不存在，已取消清空".to_string());
    }

    let directory =
        fs::canonicalize(&directory).map_err(|error| format!("解析输出目录失败: {error}"))?;
    let root_directory = fs::canonicalize(&root_directory)
        .map_err(|error| format!("解析输出根目录失败: {error}"))?;
    if !directory.is_dir() {
        return Err(format!("输出目录不是文件夹: {}", directory.display()));
    }
    if !root_directory.is_dir() {
        return Err(format!(
            "输出根目录不是文件夹: {}",
            root_directory.display()
        ));
    }
    if directory.parent().is_none() {
        return Err(format!("拒绝清空磁盘根目录: {}", directory.display()));
    }
    if directory != root_directory && !directory.starts_with(&root_directory) {
        return Err(format!(
            "拒绝清空输出根目录外的目录: {}",
            directory.display()
        ));
    }

    let mut cleared = 0usize;
    for entry in fs::read_dir(&directory)
        .map_err(|error| format!("读取输出目录失败 {}: {error}", directory.display()))?
    {
        let entry = entry.map_err(|error| format!("读取输出目录项失败: {error}"))?;
        let path = entry.path();
        let file_type = entry
            .file_type()
            .map_err(|error| format!("读取输出目录项类型失败 {}: {error}", path.display()))?;

        if file_type.is_dir() {
            fs::remove_dir_all(&path)
                .map_err(|error| format!("删除输出子目录失败 {}: {error}", path.display()))?;
        } else {
            fs::remove_file(&path)
                .map_err(|error| format!("删除输出文件失败 {}: {error}", path.display()))?;
        }
        cleared += 1;
    }

    Ok(cleared)
}
// 打开系统目录选择器；Windows 上使用 FolderBrowserDialog，因为 Tauri 这里没有直接引入 dialog 插件。
#[tauri::command]
fn pick_output_directory(initial_path: Option<String>) -> Result<Option<String>, String> {
    let initial_path = existing_path(initial_path);
    let selected_path = initial_path
        .as_deref()
        .map(escape_powershell_single_quote)
        .unwrap_or_default();

    let command = format!(
        "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; \
         Add-Type -AssemblyName System.Windows.Forms; \
         $dialog = New-Object System.Windows.Forms.FolderBrowserDialog; \
         $dialog.Description = '选择输出目录'; \
         $dialog.ShowNewFolderButton = $true; \
         if ('{selected_path}' -ne '') {{ $dialog.SelectedPath = '{selected_path}' }}; \
         if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {{ Write-Output $dialog.SelectedPath }}"
    );

    let mut picker_command = Command::new("powershell.exe");
    picker_command.args(["-NoProfile", "-STA", "-Command", &command]);

    #[cfg(target_os = "windows")]
    {
        picker_command.creation_flags(CREATE_NO_WINDOW);
    }

    let output = picker_command
        .output()
        .map_err(|error| format!("打开目录选择器失败: {error}"))?;

    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
    }

    let selected = String::from_utf8(output.stdout)
        .map_err(|error| format!("目录选择器返回了无法识别的路径编码: {error}"))?
        .trim_start_matches('\u{feff}')
        .trim()
        .to_string();
    if selected.is_empty() {
        return Ok(None);
    }

    Ok(Some(selected))
}

// 阻塞下载任务负责创建 sidecar 子进程、注入环境变量、监听 stdout/stderr 并返回最终 JSON。
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

    // sidecar 作为独立 Node 进程运行，所有任务参数通过环境变量注入，避免复杂命令行转义。
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
        .env("MCD_IMAGE_ASPECT_RATIO", &payload.image_aspect_ratio)
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

    // Windows 发布包中隐藏 node.exe 控制台窗口，避免用户每次下载时看到空白命令行。
    #[cfg(windows)]
    {
        #[cfg(target_os = "windows")]
        use std::os::windows::process::CommandExt;
        command.creation_flags(CREATE_NO_WINDOW);
    }

    // Cookie 只在当前子进程环境中传递，不写入 sidecar 命令行，减少泄露风险。
    if let Some(cookie) = payload.douban_cookie.as_ref() {
        command.env("MCD_DOUBAN_COOKIE", cookie);
    } else {
        command.env_remove("MCD_DOUBAN_COOKIE");
    }

    // 真正启动 sidecar；后续 stdout/stderr 都必须被读取，否则子进程可能因管道阻塞卡住。
    let mut child = command
        .spawn()
        .map_err(|error| format!("启动 sidecar 失败: {error}"))?;

    if let Some(parent) = control_file_path.parent() {
        fs::create_dir_all(parent).map_err(|error| format!("创建任务控制目录失败: {error}"))?;
    }
    // 记录 pid 是为了删除/清空队列时能终止仍在后台运行的下载进程。
    fs::write(
        task_pid_file_path(&control_file_path),
        child.id().to_string(),
    )
    .map_err(|error| format!("写入任务进程标记失败: {error}"))?;

    // stdout 解析结构化 JSON：日志、进度和最终任务结果都从这里回来。
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "无法读取 sidecar stdout".to_string())?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "无法读取 sidecar stderr".to_string())?;

    // 两个读取线程和主线程共享最终结果/错误信息，因此用 Arc<Mutex<...>> 包起来。
    let result_holder = Arc::new(Mutex::new(None));
    let error_holder = Arc::new(Mutex::new(None));

    let stdout_app = app.clone();
    let stdout_task_id = payload.task_id.clone();
    let stdout_result_holder = Arc::clone(&result_holder);
    let stdout_error_holder = Arc::clone(&error_holder);
    // 单独线程持续读取 stdout，确保实时进度能边下载边发给前端。
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
    // stderr 也必须单独读取，否则大量错误输出可能让子进程阻塞。
    let stderr_thread = thread::spawn(move || {
        for line in BufReader::new(stderr).lines().map_while(Result::ok) {
            parse_sidecar_stderr_line(&stderr_app, &stderr_task_id, &line, &stderr_error_holder);
        }
    });

    // 等待 sidecar 主进程退出；退出后再合并两个读取线程的解析结果。
    let status = child
        .wait()
        .map_err(|error| format!("等待 sidecar 任务结束失败: {error}"))?;

    let _ = stdout_thread.join();
    let _ = stderr_thread.join();

    // 非 0 退出视为任务失败，优先返回 sidecar 输出的业务错误。
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

    // 正常退出但没有 task-result 也算失败，避免前端把未知状态当成成功。
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

// 前端执行真实下载任务的主入口：注册控制文件，转到阻塞线程运行，最后清理注册表。
#[tauri::command]
async fn run_download_task(
    app: AppHandle,
    payload: DownloadTaskPayload,
    registry: tauri::State<'_, TaskControlRegistry>,
) -> Result<String, String> {
    // 真实抓取链路会持续几秒到几十秒，这里必须让出桌面主线程，避免窗口假死。
    let task_id = validate_task_id(&payload.task_id)?.to_string();
    let control_file_path = task_control_file_path(&app, &task_id)?;
    registry.register_control_file(task_id.clone(), control_file_path.clone())?;

    let result =
        run_blocking_job(move || run_download_task_blocking(app, payload, control_file_path)).await;
    registry.unregister_task(&task_id);
    result
}

// 阻塞搜索命令复用打包好的 sidecar Node 运行时，只允许执行固定的豆瓣搜索模式。
fn search_douban_movies_blocking(
    app: AppHandle,
    query: String,
    page: u32,
) -> Result<String, String> {
    let query = query.trim().to_string();
    if query.is_empty() {
        return Err("请输入要搜索的影片名称".to_string());
    }

    let sidecar_root = resolve_sidecar_root(&app);
    let _sidecar_entry = resolve_sidecar_entry(&sidecar_root)?;
    let sidecar_entry_arg = resolve_sidecar_entry_arg();
    let sidecar_node = resolve_sidecar_node(&sidecar_root);
    let page = page.max(1);

    let mut command = Command::new(sidecar_node);
    command
        .arg(sidecar_entry_arg)
        .current_dir(&sidecar_root)
        .env("MCD_COMMAND", "douban-search")
        .env("MCD_SEARCH_QUERY", &query)
        .env("MCD_SEARCH_PAGE", page.to_string())
        .env("MCD_SEARCH_PAGE_SIZE", "15")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    #[cfg(target_os = "windows")]
    {
        command.creation_flags(0x08000000);
    }

    let output = command
        .output()
        .map_err(|error| format!("启动豆瓣搜索失败: {error}"))?;
    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    let mut sidecar_error: Option<String> = None;

    for line in stdout.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }

        let Ok(parsed) = serde_json::from_str::<Value>(trimmed) else {
            continue;
        };

        if parsed.get("kind").and_then(Value::as_str) == Some("douban-search-result") {
            if let Some(payload) = parsed.get("payload") {
                return serde_json::to_string(payload)
                    .map_err(|error| format!("序列化豆瓣搜索结果失败: {error}"));
            }
        }

        if parsed
            .get("level")
            .and_then(Value::as_str)
            .is_some_and(|level| level.eq_ignore_ascii_case("ERROR"))
        {
            if let Some(message) = parsed.get("message").and_then(Value::as_str) {
                sidecar_error = Some(message.to_string());
            }
        }
    }

    if !output.status.success() {
        return Err(sidecar_error
            .or_else(|| (!stderr.is_empty()).then_some(stderr))
            .unwrap_or_else(|| "豆瓣搜索进程异常退出".to_string()));
    }

    Err(sidecar_error.unwrap_or_else(|| "sidecar 未返回豆瓣搜索结果".to_string()))
}

// 前端搜索弹窗调用的命令：转到阻塞线程执行，避免网络请求卡住桌面主线程。
#[tauri::command]
async fn search_douban_movies(app: AppHandle, query: String, page: u32) -> Result<String, String> {
    run_blocking_job(move || search_douban_movies_blocking(app, query, page)).await
}

// 阻塞片名解析命令复用 sidecar，只允许解析固定的豆瓣 subject 详情页。
fn resolve_douban_movie_title_blocking(
    app: AppHandle,
    detail_url: String,
) -> Result<String, String> {
    let detail_url = detail_url.trim().to_string();
    if detail_url.is_empty() {
        return Err("请填写豆瓣详情页链接".to_string());
    }

    let sidecar_root = resolve_sidecar_root(&app);
    let _sidecar_entry = resolve_sidecar_entry(&sidecar_root)?;
    let sidecar_entry_arg = resolve_sidecar_entry_arg();
    let sidecar_node = resolve_sidecar_node(&sidecar_root);

    let mut command = Command::new(sidecar_node);
    command
        .arg(sidecar_entry_arg)
        .current_dir(&sidecar_root)
        .env("MCD_COMMAND", "douban-title")
        .env("MCD_TITLE_DETAIL_URL", &detail_url)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    #[cfg(target_os = "windows")]
    {
        command.creation_flags(0x08000000);
    }

    let output = command
        .output()
        .map_err(|error| format!("启动豆瓣片名解析失败: {error}"))?;
    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    let mut sidecar_error: Option<String> = None;

    for line in stdout.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }

        let Ok(parsed) = serde_json::from_str::<Value>(trimmed) else {
            continue;
        };

        if parsed.get("kind").and_then(Value::as_str) == Some("douban-title-result") {
            if let Some(title) = parsed
                .get("payload")
                .and_then(|payload| payload.get("title"))
                .and_then(Value::as_str)
            {
                return Ok(title.to_string());
            }
        }

        if parsed
            .get("level")
            .and_then(Value::as_str)
            .is_some_and(|level| level.eq_ignore_ascii_case("ERROR"))
        {
            if let Some(message) = parsed.get("message").and_then(Value::as_str) {
                sidecar_error = Some(message.to_string());
            }
        }
    }

    if !output.status.success() {
        return Err(sidecar_error
            .or_else(|| (!stderr.is_empty()).then_some(stderr))
            .unwrap_or_else(|| "豆瓣片名解析进程异常退出".to_string()));
    }

    Err(sidecar_error.unwrap_or_else(|| "sidecar 未返回豆瓣片名".to_string()))
}

// 新增任务弹窗手动粘贴链接时调用：解析片名只影响显示，不影响任务提交的纯 URL。
#[tauri::command]
async fn resolve_douban_movie_title(app: AppHandle, detail_url: String) -> Result<String, String> {
    run_blocking_job(move || resolve_douban_movie_title_blocking(app, detail_url)).await
}

// 队列表格封面列使用的影片预览信息：返回片名和搜索结果同款封面缩略图。
fn resolve_douban_movie_preview_blocking(
    app: AppHandle,
    detail_url: String,
) -> Result<String, String> {
    let detail_url = detail_url.trim().to_string();
    if detail_url.is_empty() {
        return Err("请填写豆瓣详情页链接".to_string());
    }

    let sidecar_root = resolve_sidecar_root(&app);
    let _sidecar_entry = resolve_sidecar_entry(&sidecar_root)?;
    let sidecar_entry_arg = resolve_sidecar_entry_arg();
    let sidecar_node = resolve_sidecar_node(&sidecar_root);

    let mut command = Command::new(sidecar_node);
    command
        .arg(sidecar_entry_arg)
        .current_dir(&sidecar_root)
        .env("MCD_COMMAND", "douban-title")
        .env("MCD_TITLE_DETAIL_URL", &detail_url)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    #[cfg(target_os = "windows")]
    {
        command.creation_flags(0x08000000);
    }

    let output = command
        .output()
        .map_err(|error| format!("启动豆瓣影片预览解析失败: {error}"))?;
    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    let mut sidecar_error: Option<String> = None;

    for line in stdout.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }

        let Ok(parsed) = serde_json::from_str::<Value>(trimmed) else {
            continue;
        };

        if parsed.get("kind").and_then(Value::as_str) == Some("douban-title-result") {
            if let Some(payload) = parsed.get("payload") {
                return serde_json::to_string(payload)
                    .map_err(|error| format!("序列化豆瓣影片预览失败: {error}"));
            }
        }

        if parsed
            .get("level")
            .and_then(Value::as_str)
            .is_some_and(|level| level.eq_ignore_ascii_case("ERROR"))
        {
            if let Some(message) = parsed.get("message").and_then(Value::as_str) {
                sidecar_error = Some(message.to_string());
            }
        }
    }

    if !output.status.success() {
        return Err(sidecar_error
            .or_else(|| (!stderr.is_empty()).then_some(stderr))
            .unwrap_or_else(|| "豆瓣影片预览解析进程异常退出".to_string()));
    }

    Err(sidecar_error.unwrap_or_else(|| "sidecar 未返回豆瓣影片预览".to_string()))
}

#[tauri::command]
async fn resolve_douban_movie_preview(
    app: AppHandle,
    detail_url: String,
) -> Result<String, String> {
    run_blocking_job(move || resolve_douban_movie_preview_blocking(app, detail_url)).await
}
// 自定义裁剪上传只允许常见图片扩展名，提前挡掉不可预览或危险的文件类型。
fn is_supported_local_image_path(path: &Path) -> bool {
    path.extension()
        .and_then(|value| value.to_str())
        .map(|extension| {
            matches!(
                extension.to_ascii_lowercase().as_str(),
                "jpg" | "jpeg" | "png" | "webp" | "gif" | "bmp"
            )
        })
        .unwrap_or(false)
}

#[tauri::command]
// 自定义裁剪拖拽本地文件时通过该命令读取图片字节，并限制文件类型和大小。
fn read_local_image_file(
    file_path: String,
    root_directory_path: String,
) -> Result<Vec<u8>, String> {
    let root_directory = PathBuf::from(root_directory_path.trim());
    if root_directory.as_os_str().is_empty() {
        return Err("输出根目录不能为空".to_string());
    }
    if !root_directory.is_dir() {
        return Err("输出根目录不存在或不是文件夹".to_string());
    }
    let root_directory = fs::canonicalize(&root_directory)
        .map_err(|error| format!("解析输出根目录失败: {error}"))?;

    let path = PathBuf::from(file_path.trim());
    if !path.is_file() {
        return Err("拖拽的不是可读取的图片文件".to_string());
    }
    let path = fs::canonicalize(&path).map_err(|error| format!("解析图片路径失败: {error}"))?;
    if !path.starts_with(&root_directory) {
        return Err("只能读取输出根目录内的本地图片".to_string());
    }

    if !is_supported_local_image_path(&path) {
        return Err("仅支持 JPG、PNG、WEBP、GIF、BMP 图片文件".to_string());
    }

    let metadata = fs::metadata(&path).map_err(|error| format!("读取图片信息失败: {error}"))?;
    if metadata.len() > 100 * 1024 * 1024 {
        return Err("图片文件超过 100MB，暂不支持拖拽上传".to_string());
    }

    fs::read(&path).map_err(|error| format!("读取拖拽图片失败: {error}"))
}

#[tauri::command]
fn read_dropped_image_file(file_path: String) -> Result<Vec<u8>, String> {
    let path = PathBuf::from(file_path.trim());
    if !path.is_file() {
        return Err("拖拽的不是可读取的图片文件".to_string());
    }
    let path = fs::canonicalize(&path).map_err(|error| format!("解析图片路径失败: {error}"))?;

    if !is_supported_local_image_path(&path) {
        return Err("仅支持 JPG、PNG、WEBP、GIF、BMP 图片文件".to_string());
    }

    let metadata = fs::metadata(&path).map_err(|error| format!("读取图片信息失败: {error}"))?;
    if metadata.len() > 100 * 1024 * 1024 {
        return Err("图片文件超过 100MB，暂不支持拖拽上传".to_string());
    }

    fs::read(&path).map_err(|error| format!("读取拖拽图片失败: {error}"))
}
// 保存自定义裁剪图片前清理 Windows/macOS/Linux 都不适合出现在文件名里的字符。
fn sanitize_output_file_name(file_name: &str) -> String {
    let sanitized = file_name
        .chars()
        .map(|ch| match ch {
            '\\' | '/' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => ' ',
            _ => ch,
        })
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");

    if sanitized.is_empty() {
        "custom-crop.png".to_string()
    } else {
        sanitized
    }
}

// 自定义裁剪保存命令：固定写到输出根目录/custom-crop-photo 下。
fn sanitize_processed_image_file_name(file_name: &str) -> Result<String, String> {
    let sanitized = sanitize_output_file_name(file_name)
        .trim()
        .trim_end_matches(['.', ' '])
        .to_string();
    let path = PathBuf::from(&sanitized);
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| value.to_ascii_lowercase())
        .ok_or_else(|| "图片文件名必须包含 jpg 或 png 扩展名".to_string())?;
    if !matches!(extension.as_str(), "jpg" | "jpeg" | "png") {
        return Err("图片文件名只支持 jpg 或 png 扩展名".to_string());
    }

    let raw_stem = path
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .trim();
    let stem = raw_stem.trim_matches('.').trim();
    let reserved_names = [
        "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8",
        "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
    ];
    let safe_stem = if stem.is_empty()
        || stem == "."
        || stem == ".."
        || raw_stem.contains("..")
        || reserved_names.contains(&stem.to_ascii_uppercase().as_str())
    {
        "processed-image"
    } else {
        stem
    };

    Ok(format!("{safe_stem}.{extension}"))
}

#[tauri::command]
fn save_custom_cropped_image(
    output_root_dir: String,
    file_name: String,
    image_bytes: Vec<u8>,
) -> Result<String, String> {
    if image_bytes.is_empty() {
        return Err("裁剪图片内容为空".to_string());
    }

    let output_dir = PathBuf::from(output_root_dir).join("custom-crop-photo");
    fs::create_dir_all(&output_dir).map_err(|error| format!("创建输出目录失败: {error}"))?;

    let output_path = output_dir.join(sanitize_output_file_name(&file_name));
    fs::write(&output_path, image_bytes).map_err(|error| format!("保存裁剪图片失败: {error}"))?;

    Ok(output_path.to_string_lossy().into_owned())
}
// 保存图片处理弹窗导出的成品图。
#[tauri::command]
fn save_processed_image(
    output_root_dir: String,
    file_name: String,
    image_bytes: Vec<u8>,
) -> Result<String, String> {
    if image_bytes.is_empty() {
        return Err("图片内容为空".to_string());
    }

    let output_dir = PathBuf::from(output_root_dir.trim());
    if output_dir.as_os_str().is_empty() {
        return Err("图片输出目录不能为空".to_string());
    }

    if !output_dir.is_absolute() {
        return Err("图片输出目录必须是绝对路径".to_string());
    }

    fs::create_dir_all(&output_dir).map_err(|error| format!("创建图片输出目录失败: {error}"))?;
    let output_dir =
        fs::canonicalize(&output_dir).map_err(|error| format!("解析图片输出目录失败: {error}"))?;
    let output_path = output_dir.join(sanitize_processed_image_file_name(&file_name)?);
    fs::write(&output_path, image_bytes).map_err(|error| format!("保存图片失败: {error}"))?;

    Ok(output_path.to_string_lossy().into_owned())
}

// 早期内部输出目录命令，仍保留在 handler 中以兼容已有前端调用。
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

// 打开某个已存在目录，用于任务完成后打开输出目录。
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

// 打开文件所在目录并选中文件，用于自定义裁剪保存后的路径提示。
#[tauri::command]
fn reveal_file_path(file_path: String) -> Result<(), String> {
    let path = PathBuf::from(file_path.trim());
    if !path.is_file() {
        return Err("图片文件不存在，无法定位".to_string());
    }

    #[cfg(target_os = "windows")]
    {
        let reveal_path = path.to_string_lossy().replace('/', "\\");
        Command::new("explorer.exe")
            .raw_arg(format!("/select,\"{}\"", reveal_path))
            .spawn()
            .map_err(|error| format!("定位图片失败: {error}"))?;
    }

    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .arg("-R")
            .arg(&path)
            .spawn()
            .map_err(|error| format!("定位图片失败: {error}"))?;
    }

    #[cfg(all(not(target_os = "windows"), not(target_os = "macos")))]
    {
        let parent = path
            .parent()
            .ok_or_else(|| "无法获取图片所在目录".to_string())?;
        Command::new("xdg-open")
            .arg(parent)
            .spawn()
            .map_err(|error| format!("打开图片所在目录失败: {error}"))?;
    }

    Ok(())
}
// Tauri builder 注册所有前端可调用命令，并托管任务控制注册表。
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(TaskControlRegistry::default())
        .plugin(tauri_plugin_opener::init())
        // 只有登记在 generate_handler! 里的函数，前端 invoke(...) 才能调用。
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
            clear_directory_contents,
            pick_output_directory,
            read_local_image_file,
            read_dropped_image_file,
            save_custom_cropped_image,
            save_processed_image,
            run_download_task,
            search_douban_movies,
            resolve_douban_movie_title,
            resolve_douban_movie_preview,
            open_output_dir,
            open_directory_path,
            reveal_file_path
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
// 单元测试集中保护 lib.rs 中最容易出事故的边界：进程参数、状态库恢复、目录删除和任务控制。
mod tests {
    use super::{
        clear_directory_contents, delete_directory_path, format_sidecar_exit_error, hex_decode,
        is_recoverable_sqlite_error, load_snapshot_from_sqlite, next_runtime_log_seed,
        open_state_db_path, read_dropped_image_file, read_local_image_file,
        resolve_douban_login_cookie_status, resolve_sidecar_entry_arg,
        resolve_sidecar_event_task_id, resolve_sidecar_node, rotate_corrupted_state_db,
        run_blocking_job, save_processed_image, save_snapshot_to_sqlite_path_with_recovery,
        validate_task_id, TaskControlRegistry,
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

    // 每个测试使用独立临时目录，并先删除同名目录，避免上次测试残留影响结果。
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
    fn validate_task_id_accepts_safe_ids_and_rejects_path_segments() {
        assert_eq!(validate_task_id("task-123_abc").unwrap(), "task-123_abc");

        for task_id in ["", " task-1", "task-1 ", "../escape", "task/1", "task.1"] {
            assert!(validate_task_id(task_id).is_err());
        }

        assert!(validate_task_id(&"a".repeat(97)).is_err());
    }

    #[test]
    fn hex_decode_rejects_non_ascii_payload_without_panicking() {
        assert!(hex_decode("💥").is_err());
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
                        "imageAspectRatio": "original",
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
        assert!(sibling_files
            .iter()
            .any(|name| name.starts_with("runtime-state.corrupt-")));

        let connection = open_state_db_path(&db_path).unwrap();
        let loaded = load_snapshot_from_sqlite(&connection).unwrap().unwrap();
        assert_eq!(loaded["tasks"][0]["id"].as_str(), Some("task-1"));
        assert_eq!(loaded["cookies"][0]["id"].as_str(), Some("300"));
        assert_eq!(loaded["logs"][0]["id"].as_i64(), Some(10001));

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
    fn load_snapshot_restores_image_process_output_root_dir_without_rows() {
        let temp_dir = test_temp_dir("image-process-meta");
        let db_path = temp_dir.join("runtime-state.sqlite");
        let snapshot = serde_json::json!({
            "schemaVersion": 2,
            "tasks": [],
            "cookies": [],
            "logs": [],
            "queueConfig": {},
            "imageProcessOutputRootDir": "D:/image-output"
        });

        save_snapshot_to_sqlite_path_with_recovery(&db_path, &snapshot).unwrap();
        let connection = open_state_db_path(&db_path).unwrap();
        let loaded = load_snapshot_from_sqlite(&connection).unwrap().unwrap();

        assert_eq!(
            loaded["imageProcessOutputRootDir"].as_str(),
            Some("D:/image-output")
        );

        let _ = fs::remove_dir_all(temp_dir);
    }

    #[test]
    fn load_snapshot_keeps_persisted_cookie_order() {
        let temp_dir = test_temp_dir("cookie-order");
        let db_path = temp_dir.join("runtime-state.sqlite");
        let snapshot = serde_json::json!({
            "schemaVersion": 2,
            "tasks": [],
            "cookies": [
                { "id": "new-cookie", "value": "new" },
                { "id": "old-cookie", "value": "old" }
            ],
            "logs": [],
            "queueConfig": {}
        });

        save_snapshot_to_sqlite_path_with_recovery(&db_path, &snapshot).unwrap();
        let connection = open_state_db_path(&db_path).unwrap();
        let loaded = load_snapshot_from_sqlite(&connection).unwrap().unwrap();

        assert_eq!(loaded["cookies"][0]["id"].as_str(), Some("new-cookie"));
        assert_eq!(loaded["cookies"][1]["id"].as_str(), Some("old-cookie"));

        let _ = fs::remove_dir_all(temp_dir);
    }

    #[test]
    fn load_snapshot_accepts_legacy_plaintext_cookie_payload() {
        let temp_dir = test_temp_dir("legacy-cookie");
        let db_path = temp_dir.join("runtime-state.sqlite");
        let connection = open_state_db_path(&db_path).unwrap();
        connection
            .execute(
                "INSERT INTO cookies (id, payload_json) VALUES (?1, ?2)",
                (
                    "legacy-cookie",
                    serde_json::json!({
                        "id": "legacy-cookie",
                        "value": "dbcl2=test; ck=test"
                    })
                    .to_string(),
                ),
            )
            .unwrap();

        let loaded = load_snapshot_from_sqlite(&connection).unwrap().unwrap();

        assert_eq!(loaded["cookies"][0]["id"].as_str(), Some("legacy-cookie"));
        assert_eq!(
            loaded["cookies"][0]["value"].as_str(),
            Some("dbcl2=test; ck=test")
        );

        let _ = fs::remove_dir_all(temp_dir);
    }

    #[test]
    fn saved_cookie_payload_round_trips_without_plaintext_on_windows() {
        let temp_dir = test_temp_dir("protected-cookie");
        let db_path = temp_dir.join("runtime-state.sqlite");
        let snapshot = serde_json::json!({
            "schemaVersion": 2,
            "tasks": [],
            "cookies": [
                {
                    "id": "protected-cookie",
                    "source": "douban",
                    "value": "dbcl2=test; ck=test"
                }
            ],
            "logs": [],
            "queueConfig": {}
        });

        save_snapshot_to_sqlite_path_with_recovery(&db_path, &snapshot).unwrap();
        let connection = open_state_db_path(&db_path).unwrap();
        let payload: String = connection
            .query_row(
                "SELECT payload_json FROM cookies WHERE id = ?1",
                ["protected-cookie"],
                |row| row.get(0),
            )
            .unwrap();

        assert!(payload.contains("\"protected\":true"));
        if cfg!(target_os = "windows") {
            assert!(!payload.contains("dbcl2=test; ck=test"));
        }

        let loaded = load_snapshot_from_sqlite(&connection).unwrap().unwrap();
        assert_eq!(
            loaded["cookies"][0]["value"].as_str(),
            Some("dbcl2=test; ck=test")
        );

        let _ = fs::remove_dir_all(temp_dir);
    }

    #[test]
    fn delete_directory_path_removes_existing_output_directory() {
        let temp_dir = test_temp_dir("delete-output");
        let movie_dir = temp_dir.join("Movie - 2026-05-02");
        let output_dir = movie_dir.join("still");
        fs::create_dir_all(&output_dir).unwrap();
        fs::write(output_dir.join("image.jpg"), "image").unwrap();

        let deleted = delete_directory_path(
            output_dir.to_string_lossy().into_owned(),
            temp_dir.to_string_lossy().into_owned(),
        )
        .unwrap();

        assert!(deleted);
        assert!(!output_dir.exists());
        assert!(movie_dir.exists());

        let _ = fs::remove_dir_all(temp_dir);
    }

    #[test]
    fn delete_directory_path_removes_empty_parent_directory() {
        let temp_dir = test_temp_dir("delete-empty-parent");
        let movie_dir = temp_dir.join("Movie - 2026-05-02");
        let category_dir = movie_dir.join("still");
        let output_dir = category_dir.join("still-original");
        fs::create_dir_all(&output_dir).unwrap();
        fs::write(output_dir.join("image.jpg"), "image").unwrap();

        let deleted = delete_directory_path(
            output_dir.to_string_lossy().into_owned(),
            temp_dir.to_string_lossy().into_owned(),
        )
        .unwrap();

        assert!(deleted);
        assert!(!output_dir.exists());
        assert!(!category_dir.exists());
        assert!(!movie_dir.exists());

        let _ = fs::remove_dir_all(temp_dir);
    }

    #[test]
    fn delete_directory_path_keeps_non_empty_movie_directory() {
        let temp_dir = test_temp_dir("delete-non-empty-movie");
        let movie_dir = temp_dir.join("Movie - 2026-05-02");
        let category_dir = movie_dir.join("still");
        let output_dir = category_dir.join("still-original");
        let sibling_category_dir = movie_dir.join("poster");
        fs::create_dir_all(&output_dir).unwrap();
        fs::create_dir_all(&sibling_category_dir).unwrap();
        fs::write(output_dir.join("image.jpg"), "image").unwrap();

        let deleted = delete_directory_path(
            output_dir.to_string_lossy().into_owned(),
            temp_dir.to_string_lossy().into_owned(),
        )
        .unwrap();

        assert!(deleted);
        assert!(!output_dir.exists());
        assert!(!category_dir.exists());
        assert!(movie_dir.exists());
        assert!(sibling_category_dir.exists());

        let _ = fs::remove_dir_all(temp_dir);
    }

    #[test]
    fn delete_directory_path_keeps_non_empty_parent_directory() {
        let temp_dir = test_temp_dir("delete-non-empty-parent");
        let category_dir = temp_dir.join("Movie - 2026-05-02").join("still");
        let output_dir = category_dir.join("still-original");
        let sibling_dir = category_dir.join("still-9x16");
        fs::create_dir_all(&output_dir).unwrap();
        fs::create_dir_all(&sibling_dir).unwrap();
        fs::write(output_dir.join("image.jpg"), "image").unwrap();
        fs::write(sibling_dir.join("image.jpg"), "image").unwrap();

        let deleted = delete_directory_path(
            output_dir.to_string_lossy().into_owned(),
            temp_dir.to_string_lossy().into_owned(),
        )
        .unwrap();

        assert!(deleted);
        assert!(!output_dir.exists());
        assert!(category_dir.exists());
        assert!(sibling_dir.exists());

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
    fn clear_directory_contents_removes_children_but_keeps_root() {
        let temp_dir = test_temp_dir("clear-output-root");
        let child_dir = temp_dir.join("Movie - 2026-05-02").join("still");
        fs::create_dir_all(&child_dir).unwrap();
        fs::write(child_dir.join("image.jpg"), "image").unwrap();
        fs::write(temp_dir.join("root-file.txt"), "root").unwrap();

        let temp_dir_string = temp_dir.to_string_lossy().into_owned();
        let cleared = clear_directory_contents(temp_dir_string.clone(), temp_dir_string).unwrap();

        assert_eq!(cleared, 2);
        assert!(temp_dir.exists());
        assert!(!child_dir.exists());
        assert!(!temp_dir.join("root-file.txt").exists());

        let _ = fs::remove_dir_all(temp_dir);
    }

    #[test]
    fn clear_directory_contents_rejects_empty_path() {
        let error =
            clear_directory_contents("   ".to_string(), "D:/cover".to_string()).unwrap_err();

        assert!(error.contains("输出目录不能为空"));
    }

    #[test]
    fn clear_directory_contents_removes_children_but_keeps_task_directory() {
        let temp_dir = test_temp_dir("clear-task-output");
        let child_dir = temp_dir.join("child");
        let nested_dir = child_dir.join("nested");
        fs::create_dir_all(&nested_dir).unwrap();
        fs::write(child_dir.join("image.jpg"), "image").unwrap();
        fs::write(nested_dir.join("thumb.jpg"), "thumb").unwrap();

        let cleared = clear_directory_contents(
            child_dir.to_string_lossy().into_owned(),
            temp_dir.to_string_lossy().into_owned(),
        )
        .unwrap();

        assert_eq!(cleared, 2);
        assert!(child_dir.exists());
        assert!(!child_dir.join("image.jpg").exists());
        assert!(!nested_dir.exists());

        let _ = fs::remove_dir_all(temp_dir);
    }

    #[test]
    fn clear_directory_contents_rejects_directory_outside_root() {
        let temp_dir = test_temp_dir("clear-root-boundary");
        let outside_dir = test_temp_dir("clear-root-outside");
        let child_dir = outside_dir.join("child");
        fs::create_dir_all(&child_dir).unwrap();

        let error = clear_directory_contents(
            child_dir.to_string_lossy().into_owned(),
            temp_dir.to_string_lossy().into_owned(),
        )
        .unwrap_err();

        assert!(error.contains("拒绝清空输出根目录外的目录"));
        assert!(child_dir.exists());

        let _ = fs::remove_dir_all(temp_dir);
        let _ = fs::remove_dir_all(outside_dir);
    }

    #[test]
    fn read_local_image_file_accepts_image_inside_root() {
        let temp_dir = test_temp_dir("read-image-root");
        let image_path = temp_dir.join("cover.jpg");
        fs::write(&image_path, b"image").unwrap();

        let bytes = read_local_image_file(
            image_path.to_string_lossy().into_owned(),
            temp_dir.to_string_lossy().into_owned(),
        )
        .unwrap();

        assert_eq!(bytes, b"image");

        let _ = fs::remove_dir_all(temp_dir);
    }

    #[test]
    fn read_local_image_file_rejects_image_outside_root() {
        let root_dir = test_temp_dir("read-image-root-boundary");
        let outside_dir = test_temp_dir("read-image-outside-boundary");
        let image_path = outside_dir.join("cover.jpg");
        fs::write(&image_path, b"image").unwrap();

        let error = read_local_image_file(
            image_path.to_string_lossy().into_owned(),
            root_dir.to_string_lossy().into_owned(),
        )
        .unwrap_err();

        assert!(error.contains("只能读取输出根目录内的本地图片"));

        let _ = fs::remove_dir_all(root_dir);
        let _ = fs::remove_dir_all(outside_dir);
    }

    #[test]
    fn read_dropped_image_file_accepts_image_without_output_root() {
        let temp_dir = test_temp_dir("read-dropped-image");
        let image_path = temp_dir.join("cover.png");
        fs::write(&image_path, b"image").unwrap();

        let bytes = read_dropped_image_file(image_path.to_string_lossy().into_owned()).unwrap();

        assert_eq!(bytes, b"image");

        let _ = fs::remove_dir_all(temp_dir);
    }

    #[test]
    fn save_processed_image_rejects_relative_output_dir() {
        let error = save_processed_image(
            "relative-output".to_string(),
            "processed.png".to_string(),
            vec![1, 2, 3],
        )
        .unwrap_err();

        assert!(error.contains("绝对路径"));
    }

    #[test]
    fn save_processed_image_sanitizes_reserved_file_name() {
        let temp_dir = test_temp_dir("save-processed");

        let output_path = save_processed_image(
            temp_dir.to_string_lossy().into_owned(),
            "../CON .png".to_string(),
            vec![1, 2, 3],
        )
        .unwrap();

        let output_path = PathBuf::from(output_path);
        assert_eq!(
            output_path.file_name().and_then(|value| value.to_str()),
            Some("processed-image.png")
        );
        assert!(output_path.exists());

        let _ = fs::remove_dir_all(temp_dir);
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
