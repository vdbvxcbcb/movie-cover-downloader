// Tauri 命令层：负责持久化、sidecar 进程、文件系统操作和前端事件转发。
//
// 这份文件是桌面端的”后端入口”，前端通过 runtime-bridge.ts 调用这里的 #[tauri::command]。
// 主要链路可以按下面理解：
// 1. 前端提交任务 -> run_download_task -> 启动 Node sidecar 执行真实抓取。
// 2. sidecar 把日志、实时进度、最终结果写到 stdout -> Rust 解析后 emit 给前端。
// 3. 前端状态快照通过 save_persisted_state/load_persisted_state 存取到 SQLite。
// 4. 删除/清空任务、打开目录、自定义裁剪保存等本地文件能力也都集中在这里。
//
// 注释里说的”前端”通常指 apps/desktop/src，”sidecar”指 apps/sidecar/src。

mod constants;
mod types;
mod utils;
mod crypto;
mod task_control;
mod sqlite;
mod sidecar;
mod commands;

use task_control::TaskControlRegistry;
use commands::*;

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
            discover_douban_photos,
            run_selected_photo_download,
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
        clear_directory_contents, delete_directory_path,
        read_dropped_image_file, read_local_image_file,
        resolve_douban_login_cookie_status,
        save_custom_cropped_image, save_processed_image,
        TaskControlRegistry,
    };
    use crate::sidecar::runtime::{
        format_sidecar_exit_error, resolve_sidecar_entry_arg,
        resolve_sidecar_event_task_id, resolve_sidecar_node,
    };
    use crate::sqlite::{
        is_recoverable_sqlite_error, load_snapshot_from_sqlite,
        rotate_corrupted_state_db, save_snapshot_to_sqlite_path_with_recovery,
    };
    use crate::sqlite::connection::open_state_db_path;
    use crate::sqlite::state::next_runtime_log_seed;
    use crate::utils::{hex_decode, validate_task_id, run_blocking_job};
    use std::{
        fs,
        path::{Path, PathBuf},
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

    #[cfg(unix)]
    fn create_directory_symlink(target: &Path, link: &Path) -> std::io::Result<()> {
        std::os::unix::fs::symlink(target, link)
    }

    #[cfg(windows)]
    fn create_directory_symlink(target: &Path, link: &Path) -> std::io::Result<()> {
        std::os::windows::fs::symlink_dir(target, link)
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
    fn save_custom_cropped_image_rejects_relative_output_dir() {
        let error = save_custom_cropped_image(
            "relative-output".to_string(),
            "custom.png".to_string(),
            vec![1, 2, 3],
        )
        .unwrap_err();

        assert!(error.contains("绝对路径"));
    }

    #[test]
    fn save_custom_cropped_image_sanitizes_reserved_file_name() {
        let temp_dir = test_temp_dir("save-custom-crop");

        let output_path = save_custom_cropped_image(
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
        assert_eq!(
            output_path
                .parent()
                .and_then(|value| value.file_name())
                .and_then(|value| value.to_str()),
            Some("custom-crop-photo")
        );
        assert!(output_path.exists());

        let _ = fs::remove_dir_all(temp_dir);
    }

    #[test]
    fn save_custom_cropped_image_rejects_canonical_output_escape() {
        let root_dir = test_temp_dir("save-custom-crop-root-boundary");
        let outside_dir = test_temp_dir("save-custom-crop-outside-boundary");
        let custom_crop_dir = root_dir.join("custom-crop-photo");

        if create_directory_symlink(&outside_dir, &custom_crop_dir).is_ok() {
            let error = save_custom_cropped_image(
                root_dir.to_string_lossy().into_owned(),
                "custom.png".to_string(),
                vec![1, 2, 3],
            )
            .unwrap_err();

            assert!(error.contains("输出根目录内"));
            assert!(!outside_dir.join("custom.png").exists());
        }

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
