// SQLite 模块导出

pub mod connection;
pub mod migration;
pub mod state;

// 重新导出常用函数
pub use connection::{
    is_recoverable_sqlite_error, open_state_db, rotate_corrupted_state_db,
    sqlite_db_path,
};
pub use migration::{
    migrate_json_snapshot_if_needed, save_snapshot_to_sqlite_path_with_recovery,
};
pub use state::load_snapshot_from_sqlite;
