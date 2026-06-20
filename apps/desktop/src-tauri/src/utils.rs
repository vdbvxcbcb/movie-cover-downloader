// 工具函数模块

use crate::constants::MAX_TASK_ID_LEN;
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

// 任务 ID 验证
pub fn validate_task_id(task_id: &str) -> Result<&str, String> {
    let trimmed = task_id.trim();
    if trimmed.is_empty() {
        return Err("任务 id 不能为空".to_string());
    }
    if trimmed != task_id {
        return Err("任务 id 不能包含首尾空白".to_string());
    }
    if trimmed.len() > MAX_TASK_ID_LEN {
        return Err("任务 id 过长".to_string());
    }
    if !trimmed
        .bytes()
        .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_')
    {
        return Err("任务 id 只能包含字母、数字、短横线和下划线".to_string());
    }

    Ok(trimmed)
}

// 时间戳生成
pub fn timestamp_now() -> String {
    let millis = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or(0);
    millis.to_string()
}

// 十六进制编码
pub fn hex_encode(bytes: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut encoded = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        encoded.push(HEX[(byte >> 4) as usize] as char);
        encoded.push(HEX[(byte & 0x0f) as usize] as char);
    }
    encoded
}

// 十六进制解码
pub fn hex_decode(value: &str) -> Result<Vec<u8>, String> {
    let bytes = value.as_bytes();
    if !bytes.len().is_multiple_of(2) {
        return Err("受保护 Cookie 数据格式无效".to_string());
    }

    bytes
        .chunks_exact(2)
        .map(|chunk| {
            let high = hex_nibble(chunk[0])?;
            let low = hex_nibble(chunk[1])?;
            Ok((high << 4) | low)
        })
        .collect()
}

fn hex_nibble(byte: u8) -> Result<u8, String> {
    match byte {
        b'0'..=b'9' => Ok(byte - b'0'),
        b'a'..=b'f' => Ok(byte - b'a' + 10),
        b'A'..=b'F' => Ok(byte - b'A' + 10),
        _ => Err("解析受保护 Cookie 数据失败: 不是十六进制字符".to_string()),
    }
}

// PowerShell 单引号转义
pub fn escape_powershell_single_quote(input: &str) -> String {
    input.replace('\'', "''")
}

// 文件路径验证
pub fn existing_path(path: Option<String>) -> Option<String> {
    path.filter(|value| !value.trim().is_empty())
        .filter(|value| Path::new(value).exists())
}

// 文件名清理
pub fn sanitize_output_file_name(file_name: &str) -> String {
    let sanitized = file_name
        .chars()
        .map(|ch| match ch {
            '\\' | '/' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => ' ',
            _ => ch,
        })
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");

    if sanitized.is_empty() {
        "custom-crop.png".to_string()
    } else {
        sanitized
    }
}

// 处理后图片文件名清理
pub fn sanitize_processed_image_file_name(file_name: &str) -> Result<String, String> {
    let sanitized = sanitize_output_file_name(file_name)
        .trim()
        .trim_end_matches(['.', ' '])
        .to_string();
    let path = std::path::PathBuf::from(&sanitized);
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| value.to_ascii_lowercase())
        .ok_or_else(|| "图片文件名必须包含 jpg 或 png 扩展名".to_string())?;
    if !matches!(extension.as_str(), "jpg" | "jpeg" | "png") {
        return Err("图片文件名只支持 jpg 或 png 扩展名".to_string());
    }

    let raw_stem = path
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .trim();
    let stem = raw_stem.trim_matches('.').trim();
    let reserved_names = [
        "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8",
        "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
    ];
    let safe_stem = if stem.is_empty()
        || stem == "."
        || stem == ".."
        || raw_stem.contains("..")
        || reserved_names.contains(&stem.to_ascii_uppercase().as_str())
    {
        "processed-image"
    } else {
        stem
    };

    Ok(format!("{safe_stem}.{extension}"))
}

// 支持的图片格式检查
pub fn is_supported_local_image_path(path: &Path) -> bool {
    path.extension()
        .and_then(|value| value.to_str())
        .map(|extension| {
            matches!(
                extension.to_ascii_lowercase().as_str(),
                "jpg" | "jpeg" | "png" | "webp" | "gif" | "bmp"
            )
        })
        .unwrap_or(false)
}

// Tauri 异步任务包装
pub async fn run_blocking_job<T, F>(job: F) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, String> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(job)
        .await
        .map_err(|error| format!("后台任务执行失败: {error}"))?
}
