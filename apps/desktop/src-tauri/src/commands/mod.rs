// Commands 模块导出

pub mod state;
pub mod login;
pub mod task;
pub mod fs;
pub mod image;

// 重新导出所有命令函数
pub use state::{load_persisted_state, save_persisted_state, emit_runtime_log};
pub use login::{check_login_window_cookie_status, close_login_window};

// 仅供测试使用，不公开导出
#[cfg(test)]
pub use login::resolve_douban_login_cookie_status;
pub use task::{
    pause_download_task, resume_download_task, clear_download_tasks,
    run_download_task, run_selected_photo_download, discover_douban_photos,
    search_douban_movies, resolve_douban_movie_title, resolve_douban_movie_preview,
};
pub use fs::{
    delete_directory_path, clear_directory_contents, pick_output_directory,
    open_output_dir, open_directory_path, reveal_file_path,
};
pub use image::{
    read_dropped_image_file, save_custom_cropped_image,
    save_processed_image, read_local_image_file,
};
