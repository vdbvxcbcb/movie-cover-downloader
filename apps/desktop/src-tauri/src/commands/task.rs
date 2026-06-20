// 任务控制和执行命令模块

use crate::sidecar::{
    discover_douban_photos_blocking, emit_runtime_log_event, run_download_task_blocking,
    search_douban_movies_blocking, resolve_douban_movie_preview_blocking,
    resolve_douban_movie_title_blocking, selected_images_payload_file_path,
    task_control_file_path,
};
use crate::task_control::{TaskControlRegistry, terminate_task_process};
use crate::types::{DiscoverDoubanPhotosPayload, DownloadTaskPayload, SelectedPhotoDownloadPayload};
use crate::utils::{run_blocking_job, validate_task_id};
use std::fs;
use tauri::AppHandle;

// 暂停不会直接杀进程，而是写 pause 控制文件，让 sidecar 在安全检查点停下。
#[tauri::command]
pub fn pause_download_task(
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
        Some(&task_id),
        None,
    );
    Ok(true)
}

// 继续任务会写 resume；前端随后把任务重新放回队列。
#[tauri::command]
pub fn resume_download_task(
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
        Some(&task_id),
        None,
    );
    Ok(true)
}

// 删除单任务或清空队列都会走这里：写 cancel、尝试杀进程、清理控制文件。
#[tauri::command]
pub fn clear_download_tasks(
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
            Some(&task_id),
            None,
        );
        cleared += 1;
    }

    Ok(cleared)
}

// 前端执行真实下载任务的主入口：注册控制文件，转到阻塞线程运行，最后清理注册表。
#[tauri::command]
pub async fn run_download_task(
    app: AppHandle,
    payload: DownloadTaskPayload,
    registry: tauri::State<'_, TaskControlRegistry>,
) -> Result<String, String> {
    // 真实抓取链路会持续几秒到几十秒，这里必须让出桌面主线程，避免窗口假死。
    let task_id = validate_task_id(&payload.task_id)?.to_string();
    let control_file_path = task_control_file_path(&app, &task_id)?;
    registry.register_control_file(task_id.clone(), control_file_path.clone())?;

    let result =
        run_blocking_job(move || run_download_task_blocking(app, payload, control_file_path, None, None, None)).await;
    registry.unregister_task(&task_id);
    result
}

#[tauri::command]
pub async fn run_selected_photo_download(
    app: AppHandle,
    payload: SelectedPhotoDownloadPayload,
    registry: tauri::State<'_, TaskControlRegistry>,
) -> Result<String, String> {
    let task_id = validate_task_id(&payload.task.task_id)?.to_string();
    let control_file_path = task_control_file_path(&app, &task_id)?;
    let selected_images_file_path = selected_images_payload_file_path(&app, &task_id)?;
    let selected_images_json = serde_json::to_string(&payload.selected_images)
        .map_err(|error| format!("序列化选中图片失败: {error}"))?;
    if let Some(parent) = selected_images_file_path.parent() {
        fs::create_dir_all(parent).map_err(|error| format!("创建选中图片参数目录失败: {error}"))?;
    }
    fs::write(&selected_images_file_path, selected_images_json)
        .map_err(|error| format!("写入选中图片参数失败: {error}"))?;
    if let Err(error) = registry.register_control_file(task_id.clone(), control_file_path.clone()) {
        let _ = fs::remove_file(&selected_images_file_path);
        return Err(error);
    }
    let selected_title = payload.selected_photo_title.clone();
    let task = payload.task;
    let selected_images_file_path_for_child = selected_images_file_path.to_string_lossy().into_owned();

    let result = run_blocking_job(move || {
        run_download_task_blocking(
            app,
            task,
            control_file_path,
            Some("douban-selected-download".to_string()),
            Some(selected_images_file_path_for_child),
            selected_title,
        )
    })
    .await;
    registry.unregister_task(&task_id);
    let _ = fs::remove_file(selected_images_file_path);
    result
}

#[tauri::command]
pub async fn discover_douban_photos(
    app: AppHandle,
    payload: DiscoverDoubanPhotosPayload,
    registry: tauri::State<'_, TaskControlRegistry>,
) -> Result<String, String> {
    let task_id = validate_task_id(&payload.task_id)?.to_string();
    let control_file_path = task_control_file_path(&app, &task_id)?;
    registry.register_control_file(task_id.clone(), control_file_path.clone())?;
    let result = run_blocking_job(move || discover_douban_photos_blocking(app, payload, control_file_path)).await;
    registry.unregister_task(&task_id);
    result
}

#[tauri::command]
pub async fn search_douban_movies(
    app: AppHandle,
    query: String,
    page: u32,
    douban_cookie: Option<String>,
) -> Result<String, String> {
    run_blocking_job(move || search_douban_movies_blocking(app, query, page, douban_cookie)).await
}

#[tauri::command]
pub async fn resolve_douban_movie_title(app: AppHandle, detail_url: String) -> Result<String, String> {
    run_blocking_job(move || resolve_douban_movie_title_blocking(app, detail_url)).await
}

#[tauri::command]
pub async fn resolve_douban_movie_preview(
    app: AppHandle,
    detail_url: String,
) -> Result<String, String> {
    run_blocking_job(move || resolve_douban_movie_preview_blocking(app, detail_url)).await
}
