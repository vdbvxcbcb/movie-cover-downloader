// Sidecar 运行时管理模块

use crate::constants::{MAX_REQUEST_INTERVAL_MS, MIN_REQUEST_INTERVAL_MS, DEFAULT_REQUEST_INTERVAL_MS};
use crate::types::DownloadTaskPayload;
use std::path::{Path, PathBuf};
use tauri::AppHandle;

// 把前端秒级请求间隔转成毫秒，并硬性限制范围，防止过快请求触发站点风控。
pub fn resolve_request_interval_ms(payload: &DownloadTaskPayload) -> u32 {
    let interval_ms = payload
        .request_interval_seconds
        .map(|seconds| seconds.saturating_mul(1000))
        .unwrap_or(DEFAULT_REQUEST_INTERVAL_MS);

    interval_ms.clamp(MIN_REQUEST_INTERVAL_MS, MAX_REQUEST_INTERVAL_MS)
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
    use tauri::Manager;
    let root = app.path().resource_dir().ok()?.join("sidecar");
    root.join("dist").join("index.js").exists().then_some(root)
}

#[cfg(debug_assertions)]
pub fn resolve_sidecar_root(_app: &AppHandle) -> PathBuf {
    resolve_dev_sidecar_root()
}

#[cfg(not(debug_assertions))]
pub fn resolve_sidecar_root(app: &AppHandle) -> PathBuf {
    resolve_bundled_sidecar_root(app).unwrap_or_else(resolve_dev_sidecar_root)
}

// 开发环境和安装包环境的 sidecar 路径不同，这里统一解析入口文件并给出清晰错误。
pub fn resolve_sidecar_entry(sidecar_root: &Path) -> Result<PathBuf, String> {
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
pub fn resolve_sidecar_entry_arg() -> &'static str {
    "./dist/index.js"
}

// 安装包内如果带有 node.exe 就优先使用它；开发环境才回退到系统 node。
pub fn resolve_sidecar_node(sidecar_root: &Path) -> PathBuf {
    let bundled_node = sidecar_root.join(if cfg!(windows) { "node.exe" } else { "node" });
    if bundled_node.exists() {
        return bundled_node;
    }

    PathBuf::from("node")
}

// sidecar 非 0 退出时优先展示业务错误；没有业务错误才展示进程退出码。
pub fn format_sidecar_exit_error(status_code: Option<i32>, sidecar_message: Option<&str>) -> String {
    match sidecar_message.map(normalize_sidecar_error_message) {
        Some(message) if !message.is_empty() => message,
        _ => format!("sidecar 任务执行失败，退出码 {:?}", status_code),
    }
}

// sidecar 顶层错误会带固定前缀，返回给用户前去掉它，让错误文案更直接。
fn normalize_sidecar_error_message(message: &str) -> String {
    let trimmed = message.trim();
    trimmed
        .strip_prefix("sidecar failed to start: ")
        .or_else(|| trimmed.strip_prefix("sidecar command failed: "))
        .unwrap_or(trimmed)
        .to_string()
}

// sidecar 内部默认任务 id 是 bootstrap-url-task，这里把它映射回前端真实 taskId。
pub fn resolve_sidecar_event_task_id(raw_task_id: Option<&str>, fallback_task_id: &str) -> String {
    match raw_task_id {
        Some(task_id) if !task_id.trim().is_empty() && task_id != "bootstrap-url-task" => {
            task_id.to_string()
        }
        _ => fallback_task_id.to_string(),
    }
}
