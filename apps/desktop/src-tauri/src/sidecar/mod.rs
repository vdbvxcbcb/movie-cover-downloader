// Sidecar 模块导出

pub mod runtime;
pub mod parser;
pub mod download;
pub mod douban;

// 重新导出常用函数
pub use parser::emit_runtime_log_event;
pub use download::{
    run_download_task_blocking, discover_douban_photos_blocking,
    task_control_file_path, selected_images_payload_file_path,
};
pub use douban::{
    search_douban_movies_blocking, resolve_douban_movie_title_blocking,
    resolve_douban_movie_preview_blocking,
};
