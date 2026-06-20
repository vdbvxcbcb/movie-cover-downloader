// 图片处理命令模块

use crate::constants::MAX_DROPPABLE_IMAGE_SIZE_BYTES;
use crate::utils::{is_supported_local_image_path, sanitize_processed_image_file_name};
use std::fs;
use std::path::PathBuf;

// 自定义裁剪拖拽本地文件时通过该命令读取图片字节，并限制文件类型和大小。
#[tauri::command]
pub fn read_local_image_file(
    file_path: String,
    root_directory_path: String,
) -> Result<Vec<u8>, String> {
    let root_directory = PathBuf::from(root_directory_path.trim());
    if root_directory.as_os_str().is_empty() {
        return Err("输出根目录不能为空".to_string());
    }
    if !root_directory.is_dir() {
        return Err("输出根目录不存在或不是文件夹".to_string());
    }
    let root_directory = fs::canonicalize(&root_directory)
        .map_err(|error| format!("解析输出根目录失败: {error}"))?;

    let path = PathBuf::from(file_path.trim());
    if !path.is_file() {
        return Err("拖拽的不是可读取的图片文件".to_string());
    }
    let path = fs::canonicalize(&path).map_err(|error| format!("解析图片路径失败: {error}"))?;
    if !path.starts_with(&root_directory) {
        return Err("只能读取输出根目录内的本地图片".to_string());
    }

    if !is_supported_local_image_path(&path) {
        return Err("仅支持 JPG、PNG、WEBP、GIF、BMP 图片文件".to_string());
    }

    let metadata = fs::metadata(&path).map_err(|error| format!("读取图片信息失败: {error}"))?;
    if metadata.len() > MAX_DROPPABLE_IMAGE_SIZE_BYTES {
        return Err(format!("图片文件超过 {}MB，暂不支持拖拽上传", MAX_DROPPABLE_IMAGE_SIZE_BYTES / (1024 * 1024)));
    }

    fs::read(&path).map_err(|error| format!("读取拖拽图片失败: {error}"))
}

// 图片处理弹窗拖拽外部图片时读取字节。
#[tauri::command]
pub fn read_dropped_image_file(file_path: String) -> Result<Vec<u8>, String> {
    let path = PathBuf::from(file_path.trim());
    if !path.is_file() {
        return Err("拖拽的不是可读取的图片文件".to_string());
    }
    let path = fs::canonicalize(&path).map_err(|error| format!("解析图片路径失败: {error}"))?;

    if !is_supported_local_image_path(&path) {
        return Err("仅支持 JPG、PNG、WEBP、GIF、BMP 图片文件".to_string());
    }

    let metadata = fs::metadata(&path).map_err(|error| format!("读取图片信息失败: {error}"))?;
    if metadata.len() > MAX_DROPPABLE_IMAGE_SIZE_BYTES {
        return Err(format!("图片文件超过 {}MB，暂不支持拖拽上传", MAX_DROPPABLE_IMAGE_SIZE_BYTES / (1024 * 1024)));
    }

    fs::read(&path).map_err(|error| format!("读取拖拽图片失败: {error}"))
}

// 保存自定义裁剪的图片到输出根目录下的 custom-crop-photo 子目录。
#[tauri::command]
pub fn save_custom_cropped_image(
    output_root_dir: String,
    file_name: String,
    image_bytes: Vec<u8>,
) -> Result<String, String> {
    if image_bytes.is_empty() {
        return Err("裁剪图片内容为空".to_string());
    }

    let output_root_dir = PathBuf::from(output_root_dir.trim());
    if output_root_dir.as_os_str().is_empty() {
        return Err("输出根目录不能为空".to_string());
    }
    if !output_root_dir.is_absolute() {
        return Err("输出根目录必须是绝对路径".to_string());
    }

    fs::create_dir_all(&output_root_dir).map_err(|error| format!("创建输出根目录失败: {error}"))?;
    let output_root_dir = fs::canonicalize(&output_root_dir)
        .map_err(|error| format!("解析输出根目录失败: {error}"))?;

    let output_dir = output_root_dir.join("custom-crop-photo");
    fs::create_dir_all(&output_dir).map_err(|error| format!("创建输出目录失败: {error}"))?;
    let output_dir =
        fs::canonicalize(&output_dir).map_err(|error| format!("解析输出目录失败: {error}"))?;
    if !output_dir.starts_with(&output_root_dir) {
        return Err("输出目录必须位于输出根目录内".to_string());
    }

    let output_path = output_dir.join(sanitize_processed_image_file_name(&file_name)?);
    fs::write(&output_path, image_bytes).map_err(|error| format!("保存裁剪图片失败: {error}"))?;

    Ok(output_path.to_string_lossy().into_owned())
}

// 保存图片处理弹窗导出的成品图。
#[tauri::command]
pub fn save_processed_image(
    output_root_dir: String,
    file_name: String,
    image_bytes: Vec<u8>,
) -> Result<String, String> {
    if image_bytes.is_empty() {
        return Err("图片内容为空".to_string());
    }

    let output_dir = PathBuf::from(output_root_dir.trim());
    if output_dir.as_os_str().is_empty() {
        return Err("图片输出目录不能为空".to_string());
    }

    if !output_dir.is_absolute() {
        return Err("图片输出目录必须是绝对路径".to_string());
    }

    fs::create_dir_all(&output_dir).map_err(|error| format!("创建输出目录失败: {error}"))?;
    let output_dir =
        fs::canonicalize(&output_dir).map_err(|error| format!("解析输出目录失败: {error}"))?;

    let output_path = output_dir.join(sanitize_processed_image_file_name(&file_name)?);
    fs::write(&output_path, image_bytes).map_err(|error| format!("保存图片失败: {error}"))?;

    Ok(output_path.to_string_lossy().into_owned())
}
