// Sidecar 下载任务执行模块

use crate::constants::{CREATE_NO_WINDOW, DEFAULT_DISCOVERY_BATCH_SIZE, MIN_DISCOVERY_BATCH_SIZE, MAX_DISCOVERY_BATCH_SIZE};
use crate::sidecar::parser::{
    emit_runtime_log_event, parse_douban_photos_discover_stdout_line,
    parse_sidecar_stderr_line, parse_sidecar_stdout_line,
};
use crate::sidecar::runtime::{
    format_sidecar_exit_error, resolve_request_interval_ms, resolve_sidecar_entry,
    resolve_sidecar_entry_arg, resolve_sidecar_node, resolve_sidecar_root,
};
use crate::task_control::task_pid_file_path;
use crate::types::{DiscoverDoubanPhotosPayload, DownloadTaskPayload};
use crate::utils::validate_task_id;
use std::fs;
use std::io::{BufRead, BufReader};
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::{Arc, Mutex};
use std::thread;
use tauri::AppHandle;

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

// 阻塞下载任务负责创建 sidecar 子进程、注入环境变量、监听 stdout/stderr 并返回最终 JSON。
pub fn run_download_task_blocking(
    app: AppHandle,
    payload: DownloadTaskPayload,
    control_file_path: PathBuf,
    sidecar_command: Option<String>,
    selected_images_file_path: Option<String>,
    selected_title: Option<String>,
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
        Some(&payload.task_id),
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
        Some(&payload.task_id),
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

    if let Some(sidecar_command) = sidecar_command.as_ref() {
        command.env("MCD_COMMAND", sidecar_command);
    }
    if let Some(selected_images_file_path) = selected_images_file_path.as_ref() {
        command.env("MCD_SELECTED_IMAGES_FILE", selected_images_file_path);
    }
    if let Some(selected_title) = selected_title.as_ref() {
        command.env("MCD_SELECTED_TITLE", selected_title);
    }

    // Windows 发布包中隐藏 node.exe 控制台窗口，避免用户每次下载时看到空白命令行。
    #[cfg(target_os = "windows")]
    {
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

pub fn discover_douban_photos_blocking(
    app: AppHandle,
    payload: DiscoverDoubanPhotosPayload,
    control_file_path: PathBuf,
) -> Result<String, String> {
    let detail_url = payload.detail_url.trim().to_string();
    if detail_url.is_empty() {
        return Err("请填写豆瓣影片链接".to_string());
    }
    let douban_asset_type = match payload.douban_asset_type.as_str() {
        "still" | "poster" | "wallpaper" => payload.douban_asset_type.clone(),
        _ => "still".to_string(),
    };

    let sidecar_root = resolve_sidecar_root(&app);
    let _sidecar_entry = resolve_sidecar_entry(&sidecar_root)?;
    let sidecar_entry_arg = resolve_sidecar_entry_arg();
    let sidecar_node = resolve_sidecar_node(&sidecar_root);
    let request_interval_ms = resolve_request_interval_ms(&DownloadTaskPayload {
        task_id: payload.task_id.clone(),
        detail_url: detail_url.clone(),
        output_root_dir: payload.output_root_dir.clone(),
        source_hint: payload.source_hint.clone(),
        douban_asset_type: douban_asset_type.clone(),
        image_count_mode: "unlimited".to_string(),
        max_images: 100_000,
        output_image_format: payload.output_image_format.clone(),
        image_aspect_ratio: payload.image_aspect_ratio.clone(),
        request_interval_seconds: payload.request_interval_seconds,
        douban_cookie: payload.douban_cookie.clone(),
    });

    let mut command = Command::new(sidecar_node);
    command
        .arg(sidecar_entry_arg)
        .current_dir(&sidecar_root)
        .env("MCD_COMMAND", "douban-photos-discover")
        .env("MCD_OUTPUT_DIR", &payload.output_root_dir)
        .env("MCD_BOOTSTRAP_TASK_ID", &payload.task_id)
        .env("MCD_BOOTSTRAP_TASK_URL", &detail_url)
        .env("MCD_BOOTSTRAP_OUTPUT_DIR", &payload.output_root_dir)
        .env("MCD_BOOTSTRAP_SOURCE_HINT", &payload.source_hint)
        .env("MCD_DOUBAN_ASSET_TYPE", &douban_asset_type)
        .env("MCD_IMAGE_COUNT_MODE", "unlimited")
        .env("MCD_BOOTSTRAP_MAX_IMAGES", "100000")
        .env("MCD_BOOTSTRAP_OUTPUT_FORMAT", &payload.output_image_format)
        .env("MCD_IMAGE_ASPECT_RATIO", &payload.image_aspect_ratio)
        .env(
            "MCD_DISCOVERY_BATCH_SIZE",
            payload.batch_size.unwrap_or(DEFAULT_DISCOVERY_BATCH_SIZE).clamp(MIN_DISCOVERY_BATCH_SIZE, MAX_DISCOVERY_BATCH_SIZE).to_string(),
        )
        .env(
            "MCD_TASK_CONTROL_FILE",
            control_file_path.to_string_lossy().into_owned(),
        )
        .env("MCD_REQUEST_INTERVAL_MS", request_interval_ms.to_string())
        .env("MCD_BOOTSTRAP_REQUEST_INTERVAL_MS", request_interval_ms.to_string())
        .env("MCD_CONCURRENCY", "4")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    if let Some(cookie) = payload.douban_cookie.as_ref() {
        command.env("MCD_DOUBAN_COOKIE", cookie);
    }
    if let Some(known_title) = payload
        .known_title
        .as_ref()
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
    {
        command.env("MCD_DISCOVERY_TITLE", known_title);
    }
    if let Some(cursor) = payload.cursor.as_ref() {
        command.env("MCD_DISCOVERY_CURSOR", cursor.to_string());
    }

    #[cfg(target_os = "windows")]
    {
        command.creation_flags(0x08000000);
    }

    let mut child = command
        .spawn()
        .map_err(|error| format!("启动豆瓣图片解析失败: {error}"))?;

    if let Some(parent) = control_file_path.parent() {
        fs::create_dir_all(parent).map_err(|error| format!("创建任务控制目录失败: {error}"))?;
    }
    fs::write(
        task_pid_file_path(&control_file_path),
        child.id().to_string(),
    )
    .map_err(|error| format!("写入任务进程标记失败: {error}"))?;

    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "无法读取豆瓣图片解析 stdout".to_string())?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "无法读取豆瓣图片解析 stderr".to_string())?;
    let result_holder = Arc::new(Mutex::new(None));
    let error_holder = Arc::new(Mutex::new(None));

    let stdout_app = app.clone();
    let stdout_task_id = payload.task_id.clone();
    let stdout_result_holder = Arc::clone(&result_holder);
    let stdout_error_holder = Arc::clone(&error_holder);
    let stdout_thread = thread::spawn(move || {
        for line in BufReader::new(stdout).lines().map_while(Result::ok) {
            parse_douban_photos_discover_stdout_line(
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
        .map_err(|error| format!("等待豆瓣图片解析结束失败: {error}"))?;
    let _ = stdout_thread.join();
    let _ = stderr_thread.join();

    if !status.success() {
        let sidecar_message = error_holder
            .lock()
            .map_err(|_| "读取豆瓣图片解析错误失败".to_string())?
            .clone();
        return Err(format_sidecar_exit_error(
            status.code(),
            sidecar_message.as_deref(),
        ));
    }

    let result = match result_holder
        .lock()
        .map_err(|_| "读取豆瓣图片解析结果失败".to_string())?
        .clone()
    {
        Some(result) => result,
        None => {
            let sidecar_message = error_holder
                .lock()
                .map_err(|_| "读取豆瓣图片解析错误失败".to_string())?
                .clone();
            return Err(sidecar_message.unwrap_or_else(|| "sidecar 未返回豆瓣图片解析结果".to_string()));
        }
    };

    serde_json::to_string(&result).map_err(|error| format!("序列化豆瓣图片解析结果失败: {error}"))
}

// 每个任务一个控制文件，路径在应用数据目录下，避免写到用户选择的图片输出目录。
pub fn task_control_file_path(app: &AppHandle, task_id: &str) -> Result<PathBuf, String> {
    use tauri::Manager;
    let task_id = validate_task_id(task_id)?;
    let base_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("无法获取应用数据目录: {error}"))?;

    Ok(base_dir.join("task-control").join(format!("{task_id}.txt")))
}

pub fn selected_images_payload_file_path(app: &AppHandle, task_id: &str) -> Result<PathBuf, String> {
    use tauri::Manager;
    let task_id = validate_task_id(task_id)?;
    let base_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("无法获取应用数据目录: {error}"))?;

    Ok(base_dir
        .join("task-payload")
        .join(format!("selected-images-{task_id}.json")))
}
