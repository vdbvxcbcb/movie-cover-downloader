// Sidecar 豆瓣相关操作模块

use crate::sidecar::parser::parse_sidecar_json_result;
use crate::sidecar::runtime::{
    resolve_sidecar_entry, resolve_sidecar_entry_arg, resolve_sidecar_node, resolve_sidecar_root,
};
use crate::constants::CREATE_NO_WINDOW;
use serde_json::Value;
use std::process::{Command, Stdio};
use tauri::AppHandle;

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

// 豆瓣搜索：根据关键词分页查找影片，用于用户选择前的模糊匹配。
pub fn search_douban_movies_blocking(
    app: AppHandle,
    query: String,
    page: u32,
    douban_cookie: Option<String>,
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

    if let Some(cookie) = douban_cookie.as_ref() {
        command.env("MCD_DOUBAN_COOKIE", cookie);
    }

    #[cfg(target_os = "windows")]
    {
        command.creation_flags(CREATE_NO_WINDOW);
    }

    let output = command
        .output()
        .map_err(|error| format!("启动豆瓣搜索失败: {error}"))?;

    let result = parse_sidecar_json_result(&output, "豆瓣搜索结果", |parsed| {
        if parsed.get("kind").and_then(Value::as_str) == Some("douban-search-result") {
            parsed.get("payload").cloned()
        } else {
            None
        }
    })?;

    serde_json::to_string(&result).map_err(|error| format!("序列化豆瓣搜索结果失败: {error}"))
}

// 豆瓣片名解析：给定详情页 URL，只提取片名，用于输出文件夹默认命名。
pub fn resolve_douban_movie_title_blocking(
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
        command.creation_flags(CREATE_NO_WINDOW);
    }

    let output = command
        .output()
        .map_err(|error| format!("启动豆瓣片名解析失败: {error}"))?;

    parse_sidecar_json_result(&output, "豆瓣片名结果", |parsed| {
        if parsed.get("kind").and_then(Value::as_str) == Some("douban-title-result") {
            parsed
                .get("payload")
                .and_then(|payload| payload.get("title"))
                .and_then(Value::as_str)
                .map(|s| s.to_string())
        } else {
            None
        }
    })
}

// 豆瓣影片预览解析：返回完整影片元数据（含片名、海报等），用于下载前预览卡片。
pub fn resolve_douban_movie_preview_blocking(
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
        command.creation_flags(CREATE_NO_WINDOW);
    }

    let output = command
        .output()
        .map_err(|error| format!("启动豆瓣影片预览解析失败: {error}"))?;

    let result = parse_sidecar_json_result(&output, "豆瓣影片预览结果", |parsed| {
        if parsed.get("kind").and_then(Value::as_str) == Some("douban-title-result") {
            parsed.get("payload").cloned()
        } else {
            None
        }
    })?;

    serde_json::to_string(&result).map_err(|error| format!("序列化豆瓣影片预览失败: {error}"))
}
