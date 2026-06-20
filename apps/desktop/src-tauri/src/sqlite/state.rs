// SQLite 状态读写模块

use crate::constants::{APP_STATE_SCHEMA_VERSION, LOG_ID_SEED};
use crate::crypto::{deserialize_cookie_payload, serialize_cookie_payload};
use crate::types::TableName;
use rusqlite::{params, Connection};
use serde_json::Value;
use std::sync::atomic::Ordering;

// 只对固定表名调用该函数，避免把用户输入拼进 SQL。
pub fn count_rows(connection: &Connection, table: TableName) -> Result<i64, String> {
    let table_name = table.as_str();
    let sql = format!("SELECT COUNT(*) FROM {table_name}");
    connection
        .query_row(&sql, [], |row| row.get::<_, i64>(0))
        .map_err(|error| format!("统计 {table_name} 行数失败: {error}"))
}

// 判断是否已有真实状态，用来决定是否需要从旧 JSON 迁移。
pub fn sqlite_has_any_state(connection: &Connection) -> Result<bool, String> {
    let tasks = count_rows(connection, TableName::Tasks)?;
    let cookies = count_rows(connection, TableName::Cookies)?;
    let logs = count_rows(connection, TableName::AppLogs)?;
    let meta = count_rows(connection, TableName::AppMeta)?;

    Ok(tasks > 0 || cookies > 0 || logs > 0 || meta > 0)
}

// 从快照根对象读取数组字段；字段缺失时返回空数组，让旧快照也能被温和处理。
pub fn value_array_from_root<'a>(root: &'a Value, key: &str) -> &'a [Value] {
    root.get(key)
        .and_then(Value::as_array)
        .map(Vec::as_slice)
        .unwrap_or(&[])
}

// 重新启动后继续使用已有最大日志 id，避免新日志和历史日志 id 重复。
pub fn next_runtime_log_seed(logs: &[Value]) -> Option<u64> {
    logs.iter()
        .filter_map(|log| log.get("id").and_then(Value::as_u64))
        .max()
        .map(|max_id| max_id.saturating_add(1))
}

// 前端仍以整体快照保存，Rust 侧在一个事务内拆分写入任务、Cookie、日志和配置表。
pub fn write_snapshot_to_sqlite(connection: &mut Connection, snapshot: &Value) -> Result<(), String> {
    let tasks = value_array_from_root(snapshot, "tasks");
    let cookies = value_array_from_root(snapshot, "cookies");
    let logs = value_array_from_root(snapshot, "logs");
    let schema_version = snapshot
        .get("schemaVersion")
        .and_then(Value::as_i64)
        .unwrap_or(APP_STATE_SCHEMA_VERSION);
    let queue_config = snapshot
        .get("queueConfig")
        .cloned()
        .unwrap_or_else(|| Value::Object(serde_json::Map::new()));
    let create_task_output_root_dir = snapshot
        .get("createTaskOutputRootDir")
        .cloned()
        .unwrap_or_else(|| Value::String(String::new()));
    let image_process_output_root_dir = snapshot
        .get("imageProcessOutputRootDir")
        .cloned()
        .unwrap_or_else(|| Value::String(String::new()));

    // 整体快照写入采用"先清空再重建"的事务模型，保证任务/Cookie/日志始终来自同一版本快照。
    let transaction = connection
        .transaction()
        .map_err(|error| format!("开启 SQLite 事务失败: {error}"))?;

    transaction
        .execute("DELETE FROM tasks", [])
        .map_err(|error| format!("清理 tasks 失败: {error}"))?;
    transaction
        .execute("DELETE FROM cookies", [])
        .map_err(|error| format!("清理 cookies 失败: {error}"))?;
    transaction
        .execute("DELETE FROM app_logs", [])
        .map_err(|error| format!("清理 app_logs 失败: {error}"))?;

    {
        // 任务表按前端数组顺序写入，读取时用 rowid ASC 保留用户看到的队列顺序。
        let mut statement = transaction
            .prepare("INSERT OR REPLACE INTO tasks (id, payload_json) VALUES (?1, ?2)")
            .map_err(|error| format!("准备写入 tasks 语句失败: {error}"))?;
        for task in tasks {
            let task_id = task
                .get("id")
                .and_then(Value::as_str)
                .ok_or_else(|| "写入 tasks 失败: 任务缺少 id".to_string())?;
            let payload = serde_json::to_string(task)
                .map_err(|error| format!("序列化 task 失败: {error}"))?;
            statement
                .execute(params![task_id, payload])
                .map_err(|error| format!("写入 task 失败: {error}"))?;
        }
    }

    {
        let mut statement = transaction
            .prepare("INSERT OR REPLACE INTO cookies (id, payload_json) VALUES (?1, ?2)")
            .map_err(|error| format!("准备写入 cookies 语句失败: {error}"))?;
        for cookie in cookies {
            let cookie_id = cookie
                .get("id")
                .and_then(Value::as_str)
                .ok_or_else(|| "写入 cookies 失败: Cookie 缺少 id".to_string())?;
            let payload = serialize_cookie_payload(cookie)?;
            statement
                .execute(params![cookie_id, payload])
                .map_err(|error| format!("写入 cookie 失败: {error}"))?;
        }
    }

    {
        let mut statement = transaction
            .prepare("INSERT OR REPLACE INTO app_logs (id, payload_json) VALUES (?1, ?2)")
            .map_err(|error| format!("准备写入 app_logs 语句失败: {error}"))?;
        for log in logs {
            let log_id = log
                .get("id")
                .and_then(Value::as_i64)
                .ok_or_else(|| "写入 app_logs 失败: 日志缺少 id".to_string())?;
            let payload =
                serde_json::to_string(log).map_err(|error| format!("序列化日志失败: {error}"))?;
            statement
                .execute(params![log_id, payload])
                .map_err(|error| format!("写入日志失败: {error}"))?;
        }
    }

    let schema_version_json = serde_json::to_string(&schema_version)
        .map_err(|error| format!("序列化 schemaVersion 失败: {error}"))?;
    let queue_config_json = serde_json::to_string(&queue_config)
        .map_err(|error| format!("序列化 queueConfig 失败: {error}"))?;
    let create_task_output_root_dir_json = serde_json::to_string(&create_task_output_root_dir)
        .map_err(|error| format!("序列化 createTaskOutputRootDir 失败: {error}"))?;
    let image_process_output_root_dir_json = serde_json::to_string(&image_process_output_root_dir)
        .map_err(|error| format!("序列化 imageProcessOutputRootDir 失败: {error}"))?;

    transaction
        .execute(
            "INSERT OR REPLACE INTO app_meta (key, value_json) VALUES (?1, ?2)",
            params!["schemaVersion", schema_version_json],
        )
        .map_err(|error| format!("写入 schemaVersion 失败: {error}"))?;
    transaction
        .execute(
            "INSERT OR REPLACE INTO app_meta (key, value_json) VALUES (?1, ?2)",
            params!["queueConfig", queue_config_json],
        )
        .map_err(|error| format!("写入 queueConfig 失败: {error}"))?;
    transaction
        .execute(
            "INSERT OR REPLACE INTO app_meta (key, value_json) VALUES (?1, ?2)",
            params!["createTaskOutputRootDir", create_task_output_root_dir_json],
        )
        .map_err(|error| format!("写入 createTaskOutputRootDir 失败: {error}"))?;
    transaction
        .execute(
            "INSERT OR REPLACE INTO app_meta (key, value_json) VALUES (?1, ?2)",
            params![
                "imageProcessOutputRootDir",
                image_process_output_root_dir_json
            ],
        )
        .map_err(|error| format!("写入 imageProcessOutputRootDir 失败: {error}"))?;

    transaction
        .commit()
        .map_err(|error| format!("提交 SQLite 事务失败: {error}"))
}

// 从 SQLite 重新组装成前端熟悉的 AppSeedState JSON，前端无需关心底层表结构。
pub fn load_snapshot_from_sqlite(connection: &Connection) -> Result<Option<Value>, String> {
    if !sqlite_has_any_state(connection)? {
        return Ok(None);
    }

    let schema_version_json = connection
        .query_row(
            "SELECT value_json FROM app_meta WHERE key = ?1",
            params!["schemaVersion"],
            |row| row.get::<_, String>(0),
        )
        .ok();
    let queue_config_json = connection
        .query_row(
            "SELECT value_json FROM app_meta WHERE key = ?1",
            params!["queueConfig"],
            |row| row.get::<_, String>(0),
        )
        .ok();
    let create_task_output_root_dir_json = connection
        .query_row(
            "SELECT value_json FROM app_meta WHERE key = ?1",
            params!["createTaskOutputRootDir"],
            |row| row.get::<_, String>(0),
        )
        .ok();
    let image_process_output_root_dir_json = connection
        .query_row(
            "SELECT value_json FROM app_meta WHERE key = ?1",
            params!["imageProcessOutputRootDir"],
            |row| row.get::<_, String>(0),
        )
        .ok();

    let schema_version = schema_version_json
        .as_deref()
        .and_then(|raw| serde_json::from_str::<i64>(raw).ok())
        .unwrap_or(APP_STATE_SCHEMA_VERSION);
    let queue_config = queue_config_json
        .as_deref()
        .and_then(|raw| serde_json::from_str::<Value>(raw).ok())
        .unwrap_or_else(|| Value::Object(serde_json::Map::new()));
    let create_task_output_root_dir = create_task_output_root_dir_json
        .as_deref()
        .and_then(|raw| serde_json::from_str::<Value>(raw).ok())
        .unwrap_or_else(|| Value::String(String::new()));
    let image_process_output_root_dir = image_process_output_root_dir_json
        .as_deref()
        .and_then(|raw| serde_json::from_str::<Value>(raw).ok())
        .unwrap_or_else(|| Value::String(String::new()));

    let mut tasks_statement = connection
        .prepare("SELECT payload_json FROM tasks ORDER BY rowid ASC")
        .map_err(|error| format!("读取 tasks 失败: {error}"))?;
    let tasks_rows = tasks_statement
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(|error| format!("遍历 tasks 失败: {error}"))?;
    let mut tasks = Vec::new();
    for row in tasks_rows {
        let payload = row.map_err(|error| format!("读取 task 行失败: {error}"))?;
        let parsed = serde_json::from_str::<Value>(&payload)
            .map_err(|error| format!("解析 task 失败: {error}"))?;
        tasks.push(parsed);
    }

    // Cookie 保存时已经按前端数组顺序写入，读取也按写入顺序恢复，避免重启后优先级反转。
    let mut cookies_statement = connection
        .prepare("SELECT payload_json FROM cookies ORDER BY rowid ASC")
        .map_err(|error| format!("读取 cookies 失败: {error}"))?;
    let cookie_rows = cookies_statement
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(|error| format!("遍历 cookies 失败: {error}"))?;
    let mut cookies = Vec::new();
    for row in cookie_rows {
        let payload = row.map_err(|error| format!("读取 cookie 行失败: {error}"))?;
        let parsed = deserialize_cookie_payload(&payload)?;
        cookies.push(parsed);
    }

    // 日志按 id 倒序读取，界面默认最新日志在上。
    let mut logs_statement = connection
        .prepare("SELECT payload_json FROM app_logs ORDER BY id DESC")
        .map_err(|error| format!("读取 app_logs 失败: {error}"))?;
    let log_rows = logs_statement
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(|error| format!("遍历 app_logs 失败: {error}"))?;
    let mut logs = Vec::new();
    for row in log_rows {
        let payload = row.map_err(|error| format!("读取日志行失败: {error}"))?;
        let parsed = serde_json::from_str::<Value>(&payload)
            .map_err(|error| format!("解析日志失败: {error}"))?;
        logs.push(parsed);
    }

    if let Some(next_seed) = next_runtime_log_seed(&logs) {
        LOG_ID_SEED.fetch_max(next_seed, Ordering::Relaxed);
    }

    let mut root = serde_json::Map::new();
    root.insert("schemaVersion".to_string(), Value::from(schema_version));
    root.insert("tasks".to_string(), Value::Array(tasks));
    root.insert("cookies".to_string(), Value::Array(cookies));
    root.insert("logs".to_string(), Value::Array(logs));
    root.insert("queueConfig".to_string(), queue_config);
    root.insert(
        "createTaskOutputRootDir".to_string(),
        create_task_output_root_dir,
    );
    root.insert(
        "imageProcessOutputRootDir".to_string(),
        image_process_output_root_dir,
    );

    Ok(Some(Value::Object(root)))
}
