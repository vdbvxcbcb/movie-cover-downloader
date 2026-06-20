// 文件系统操作命令模块

use crate::constants::CREATE_NO_WINDOW;
use crate::utils::{escape_powershell_single_quote, existing_path};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use tauri::{AppHandle, Manager};

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

// 打开目录前做存在性和类型校验，避免把错误路径直接交给系统 shell。
fn ensure_existing_directory(path: &str) -> Result<PathBuf, String> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Err("目录路径不能为空".to_string());
    }

    let directory = PathBuf::from(trimmed);
    if !directory.exists() {
        return Err(format!("目录不存在: {}", directory.display()));
    }
    if !directory.is_dir() {
        return Err(format!("目标不是目录: {}", directory.display()));
    }

    Ok(directory)
}

// 删除输出目录前必须确认目标在输出根目录内，避免误删用户其他文件。
#[tauri::command]
pub fn delete_directory_path(
    directory_path: String,
    root_directory_path: String,
) -> Result<bool, String> {
    let directory = PathBuf::from(directory_path.trim());
    if directory.as_os_str().is_empty() || !directory.exists() {
        return Ok(false);
    }
    let root_directory = PathBuf::from(root_directory_path.trim());
    if root_directory.as_os_str().is_empty() || !root_directory.exists() {
        return Err("输出根目录不存在，已取消删除".to_string());
    }

    let directory =
        fs::canonicalize(&directory).map_err(|error| format!("解析输出目录失败: {error}"))?;
    let root_directory = fs::canonicalize(&root_directory)
        .map_err(|error| format!("解析输出根目录失败: {error}"))?;
    if !directory.is_dir() {
        return Err(format!("输出目录不是文件夹: {}", directory.display()));
    }

    if directory == root_directory {
        return Err(format!("拒绝删除输出根目录: {}", directory.display()));
    }

    if !directory.starts_with(&root_directory) {
        return Err(format!(
            "拒绝删除输出根目录外的目录: {}",
            directory.display()
        ));
    }

    fs::remove_dir_all(&directory)
        .map_err(|error| format!("删除输出目录失败 {}: {error}", directory.display()))?;
    if let Some(parent) = directory.parent() {
        let removed_dir_name = directory
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("");
        let parent_dir_name = parent
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("");
        let is_sized_category_dir = ["original", "9x16", "3x4"]
            .iter()
            .any(|suffix| removed_dir_name == format!("{parent_dir_name}-{suffix}"));
        let mut parent_movie_dir = None;

        if parent != root_directory.as_path()
            && parent.starts_with(&root_directory)
            && parent.is_dir()
            && is_sized_category_dir
            && fs::read_dir(parent)
                .map_err(|error| format!("读取输出目录失败 {}: {error}", parent.display()))?
                .next()
                .is_none()
        {
            parent_movie_dir = parent.parent().map(Path::to_path_buf);
            fs::remove_dir(parent)
                .map_err(|error| format!("删除空输出目录失败 {}: {error}", parent.display()))?;
        }
        if let Some(movie_dir) = parent_movie_dir {
            if movie_dir != root_directory
                && movie_dir.starts_with(&root_directory)
                && movie_dir.is_dir()
                && fs::read_dir(&movie_dir)
                    .map_err(|error| format!("读取输出目录失败 {}: {error}", movie_dir.display()))?
                    .next()
                    .is_none()
            {
                fs::remove_dir(&movie_dir).map_err(|error| {
                    format!("删除空输出目录失败 {}: {error}", movie_dir.display())
                })?;
            }
        }
    }

    Ok(true)
}

// 清空输出目录下的所有子目录和文件，但保留输出目录本身。
#[tauri::command]
pub fn clear_directory_contents(
    directory_path: String,
    root_directory_path: String,
) -> Result<usize, String> {
    let directory = PathBuf::from(directory_path.trim());
    if directory.as_os_str().is_empty() {
        return Err("输出目录不能为空，已取消清空".to_string());
    }
    let root_directory = PathBuf::from(root_directory_path.trim());
    if root_directory.as_os_str().is_empty() {
        return Err("输出根目录不能为空，已取消清空".to_string());
    }
    if !directory.exists() {
        return Ok(0);
    }
    if !root_directory.exists() {
        return Err("输出根目录不存在，已取消清空".to_string());
    }

    let directory =
        fs::canonicalize(&directory).map_err(|error| format!("解析输出目录失败: {error}"))?;
    let root_directory = fs::canonicalize(&root_directory)
        .map_err(|error| format!("解析输出根目录失败: {error}"))?;
    if !directory.is_dir() {
        return Err(format!("输出目录不是文件夹: {}", directory.display()));
    }
    if !root_directory.is_dir() {
        return Err(format!(
            "输出根目录不是文件夹: {}",
            root_directory.display()
        ));
    }
    if directory.parent().is_none() {
        return Err(format!("拒绝清空磁盘根目录: {}", directory.display()));
    }
    if directory != root_directory && !directory.starts_with(&root_directory) {
        return Err(format!(
            "拒绝清空输出根目录外的目录: {}",
            directory.display()
        ));
    }

    let mut cleared = 0usize;
    for entry in fs::read_dir(&directory)
        .map_err(|error| format!("读取输出目录失败 {}: {error}", directory.display()))?
    {
        let entry = entry.map_err(|error| format!("读取输出目录项失败: {error}"))?;
        let path = entry.path();
        let file_type = entry
            .file_type()
            .map_err(|error| format!("读取输出目录项类型失败 {}: {error}", path.display()))?;

        if file_type.is_dir() {
            fs::remove_dir_all(&path)
                .map_err(|error| format!("删除输出子目录失败 {}: {error}", path.display()))?;
        } else {
            fs::remove_file(&path)
                .map_err(|error| format!("删除输出文件失败 {}: {error}", path.display()))?;
        }
        cleared += 1;
    }

    Ok(cleared)
}

// 打开系统目录选择器；Windows 上使用 FolderBrowserDialog，因为 Tauri 这里没有直接引入 dialog 插件。
#[tauri::command]
pub fn pick_output_directory(initial_path: Option<String>) -> Result<Option<String>, String> {
    let initial_path = existing_path(initial_path);
    let selected_path = initial_path
        .as_deref()
        .map(escape_powershell_single_quote)
        .unwrap_or_default();

    let command = format!(
        "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; \
         Add-Type -AssemblyName System.Windows.Forms; \
         $dialog = New-Object System.Windows.Forms.FolderBrowserDialog; \
         $dialog.Description = '选择输出目录'; \
         $dialog.ShowNewFolderButton = $true; \
         if ('{selected_path}' -ne '') {{ $dialog.SelectedPath = '{selected_path}' }}; \
         if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {{ Write-Output $dialog.SelectedPath }}"
    );

    let mut picker_command = Command::new("powershell.exe");
    picker_command.args(["-NoProfile", "-STA", "-Command", &command]);

    #[cfg(target_os = "windows")]
    {
        picker_command.creation_flags(CREATE_NO_WINDOW);
    }

    let output = picker_command
        .output()
        .map_err(|error| format!("打开目录选择器失败: {error}"))?;

    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
    }

    let selected = String::from_utf8(output.stdout)
        .map_err(|error| format!("目录选择器返回了无法识别的路径编码: {error}"))?
        .trim_start_matches('\u{feff}')
        .trim()
        .to_string();
    if selected.is_empty() {
        return Ok(None);
    }

    Ok(Some(selected))
}

// 早期内部输出目录命令，仍保留在 handler 中以兼容已有前端调用。
#[tauri::command]
pub fn open_output_dir(app: AppHandle) -> Result<String, String> {
    let output_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("无法获取应用数据目录: {error}"))?
        .join("covers")
        .join("internal");

    fs::create_dir_all(&output_dir).map_err(|error| format!("创建输出目录失败: {error}"))?;
    Ok(output_dir.to_string_lossy().into_owned())
}

// 打开某个已存在目录，用于任务完成后打开输出目录。
#[tauri::command]
pub fn open_directory_path(directory_path: String) -> Result<(), String> {
    let directory = ensure_existing_directory(&directory_path)?;

    #[cfg(target_os = "windows")]
    {
        Command::new("explorer.exe")
            .arg(&directory)
            .spawn()
            .map_err(|error| format!("打开目录失败: {error}"))?;
    }

    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .arg(&directory)
            .spawn()
            .map_err(|error| format!("打开目录失败: {error}"))?;
    }

    #[cfg(all(not(target_os = "windows"), not(target_os = "macos")))]
    {
        Command::new("xdg-open")
            .arg(&directory)
            .spawn()
            .map_err(|error| format!("打开目录失败: {error}"))?;
    }

    Ok(())
}

// 打开文件所在目录并选中文件，用于自定义裁剪保存后的路径提示。
#[tauri::command]
pub fn reveal_file_path(file_path: String) -> Result<(), String> {
    let path = PathBuf::from(file_path.trim());
    if !path.is_file() {
        return Err("图片文件不存在，无法定位".to_string());
    }

    #[cfg(target_os = "windows")]
    {
        let reveal_path = path.to_string_lossy().replace('/', "\\");
        Command::new("explorer.exe")
            .args(["/select,", &reveal_path])
            .spawn()
            .map_err(|error| format!("打开文件位置失败: {error}"))?;
    }

    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .args(["-R", &path.to_string_lossy()])
            .spawn()
            .map_err(|error| format!("打开文件位置失败: {error}"))?;
    }

    #[cfg(all(not(target_os = "windows"), not(target_os = "macos")))]
    {
        if let Some(parent) = path.parent() {
            Command::new("xdg-open")
                .arg(parent)
                .spawn()
                .map_err(|error| format!("打开文件位置失败: {error}"))?;
        } else {
            return Err("图片文件路径无效".to_string());
        }
    }

    Ok(())
}
