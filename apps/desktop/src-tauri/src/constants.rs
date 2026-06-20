// 应用级常量定义

use std::sync::atomic::AtomicU64;

// 日志 id 在 Rust 侧生成，避免前端批量接收时出现重复 key。
pub const LOG_ID_SEED_INITIAL: u64 = 10_000;
pub static LOG_ID_SEED: AtomicU64 = AtomicU64::new(LOG_ID_SEED_INITIAL);

// 持久化快照版本号和前端 AppSeedState.schemaVersion 对齐，用来丢弃不兼容的旧状态。
pub const APP_STATE_SCHEMA_VERSION: i64 = 2;
pub const MAX_TASK_ID_LEN: usize = 96;
pub const PROTECTED_COOKIE_PAYLOAD_SCHEME: &str = "win32-dpapi";

// 队列配置常量
pub const MIN_REQUEST_INTERVAL_MS: u32 = 1000;
pub const MAX_REQUEST_INTERVAL_MS: u32 = 5000;
pub const DEFAULT_REQUEST_INTERVAL_MS: u32 = 1000;
pub const MAX_DROPPABLE_IMAGE_SIZE_BYTES: u64 = 100 * 1024 * 1024; // 100 MB
pub const MIN_DISCOVERY_BATCH_SIZE: u32 = 1;
pub const MAX_DISCOVERY_BATCH_SIZE: u32 = 60;
pub const DEFAULT_DISCOVERY_BATCH_SIZE: u32 = 28;

#[cfg(target_os = "windows")]
pub const CREATE_NO_WINDOW: u32 = 0x08000000;
