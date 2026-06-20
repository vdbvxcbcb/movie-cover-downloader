// 类型定义模块

use serde::{Deserialize, Serialize};
use serde_json::Value;

// SQLite 表名枚举，防止 SQL 注入
#[derive(Debug, Clone, Copy)]
pub enum TableName {
    Tasks,
    Cookies,
    AppLogs,
    AppMeta,
}

impl TableName {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Tasks => "tasks",
            Self::Cookies => "cookies",
            Self::AppLogs => "app_logs",
            Self::AppMeta => "app_meta",
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
// 前端主动写日志时传入的 payload；字段命名用 camelCase，serde 会映射到 Rust 的 snake_case。
pub struct RuntimeLogPayload {
    pub level: String,
    pub scope: String,
    pub timestamp: Option<String>,
    pub message: String,
    pub task_id: Option<String>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
// 发回前端的日志事件。Rust 会补齐 id 和 timestamp，前端日志列表直接消费这个结构。
pub struct RuntimeLogEvent {
    pub id: u64,
    pub level: String,
    pub scope: String,
    pub timestamp: String,
    pub message: String,
    pub task_id: Option<String>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
// 发回前端的实时下载进度事件，专门驱动队列表格里的 saved/target 和进度条。
pub struct RuntimeTaskProgressEvent {
    pub task_id: String,
    pub phase: String,
    pub target_count: u32,
    pub saved_count: u32,
    pub timestamp: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
// 前端创建下载任务时传给 Rust 的完整参数，Rust 再转换成 sidecar 的环境变量。
pub struct DownloadTaskPayload {
    pub task_id: String,
    pub detail_url: String,
    pub output_root_dir: String,
    pub source_hint: String,
    pub douban_asset_type: String,
    pub image_count_mode: String,
    pub max_images: u32,
    pub output_image_format: String,
    pub image_aspect_ratio: String,
    pub request_interval_seconds: Option<u32>,
    pub douban_cookie: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SelectedPhotoPayload {
    pub id: String,
    pub source: String,
    pub title: String,
    pub image_url: String,
    pub page_url: Option<String>,
    pub category: String,
    pub douban_asset_type: String,
    pub orientation: String,
    pub width: Option<u32>,
    pub height: Option<u32>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiscoverDoubanPhotosPayload {
    pub task_id: String,
    pub detail_url: String,
    pub output_root_dir: String,
    pub source_hint: String,
    pub douban_asset_type: String,
    pub output_image_format: String,
    pub image_aspect_ratio: String,
    pub request_interval_seconds: Option<u32>,
    pub douban_cookie: Option<String>,
    pub cursor: Option<Value>,
    pub batch_size: Option<u32>,
    pub known_title: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SelectedPhotoDownloadPayload {
    #[serde(flatten)]
    pub task: DownloadTaskPayload,
    pub selected_images: Vec<SelectedPhotoPayload>,
    pub selected_photo_title: Option<String>,
}

#[derive(Debug, Serialize, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
// 豆瓣登录小窗口的 Cookie 检查结果：pending 表示继续等，ready 表示可以导入，closed 表示用户关窗。
pub struct LoginWindowCookieStatus {
    pub status: String,
    pub cookie: Option<String>,
}
