// 任务控制注册表模块

use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

#[derive(Default)]
// 任务控制注册表把前端的暂停/继续/取消意图写入控制文件，sidecar 轮询该文件响应。
pub struct TaskControlRegistry {
    paused: Mutex<HashSet<String>>,
    control_files: Mutex<HashMap<String, PathBuf>>,
}

// Registry 的内存状态负责"当前前端希望暂停哪些任务"，控制文件负责通知已经启动的 sidecar 进程。
impl TaskControlRegistry {
    // 只更新内存暂停集合，不直接写文件；写文件由 sync_pause_request 统一完成。
    pub fn pause(&self, task_id: String) -> Result<(), String> {
        if let Ok(mut paused) = self.paused.lock() {
            paused.insert(task_id);
            return Ok(());
        }

        Err("无法写入暂停状态".to_string())
    }

    // 从暂停集合移除任务，下一次写控制文件时 sidecar 会看到 resume。
    pub fn resume(&self, task_id: &str) -> Result<(), String> {
        if let Ok(mut paused) = self.paused.lock() {
            paused.remove(task_id);
            return Ok(());
        }

        Err("无法清理暂停状态".to_string())
    }

    pub fn is_paused(&self, task_id: &str) -> bool {
        self.paused
            .lock()
            .map(|paused| paused.contains(task_id))
            .unwrap_or(false)
    }

    // 任务开始前注册控制文件路径，并立即写入当前动作，避免 sidecar 启动后读不到初始状态。
    pub fn register_control_file(&self, task_id: String, control_file: PathBuf) -> Result<(), String> {
        {
            let mut control_files = self
                .control_files
                .lock()
                .map_err(|_| "无法注册任务控制文件".to_string())?;
            control_files.insert(task_id.clone(), control_file.clone());
        }

        self.write_control_action(&task_id)
    }

    // 任务结束、失败、删除或清空时清理控制文件和 pid 文件，避免旧控制信号影响下次同名任务。
    pub fn unregister_task(&self, task_id: &str) {
        if let Ok(mut control_files) = self.control_files.lock() {
            if let Some(control_file) = control_files.remove(task_id) {
                let _ = fs::remove_file(&control_file);
                let _ = fs::remove_file(task_pid_file_path(&control_file));
            }
        }

        if let Ok(mut paused) = self.paused.lock() {
            paused.remove(task_id);
        }
    }

    // 前端点击暂停时调用：先改内存，再把 pause 写到控制文件。
    pub fn sync_pause_request(&self, task_id: String) -> Result<(), String> {
        self.pause(task_id.clone())?;
        self.write_control_action(&task_id)
    }

    // 前端点击继续时调用：先移除暂停标记，再把 resume 写到控制文件。
    pub fn sync_resume_request(&self, task_id: &str) -> Result<(), String> {
        self.resume(task_id)?;
        self.write_control_action(task_id)
    }

    fn write_control_action(&self, task_id: &str) -> Result<(), String> {
        let action = if self.is_paused(task_id) {
            "pause"
        } else {
            "resume"
        };

        self.write_control_action_value(task_id, action)
    }

    // 删除/清空任务时调用：写 cancel 给 sidecar，让下载循环主动中止。
    pub fn sync_cancel_request(&self, task_id: &str) -> Result<(), String> {
        if let Ok(mut paused) = self.paused.lock() {
            paused.remove(task_id);
        }

        self.write_control_action_value(task_id, "cancel")
    }

    // 控制文件只有简单文本值 pause/resume/cancel，sidecar 轮询读取，比跨进程 IPC 更轻量。
    fn write_control_action_value(&self, task_id: &str, action: &str) -> Result<(), String> {
        let control_file = self
            .control_files
            .lock()
            .map_err(|_| "无法读取任务控制文件".to_string())?
            .get(task_id)
            .cloned();

        let Some(control_file) = control_file else {
            return Ok(());
        };

        if let Some(parent) = control_file.parent() {
            fs::create_dir_all(parent).map_err(|error| format!("创建任务控制目录失败: {error}"))?;
        }

        fs::write(&control_file, action).map_err(|error| format!("写入任务控制文件失败: {error}"))
    }
}

// pid 文件和控制文件同名不同扩展名，用于清空/删除任务时找到后台 sidecar 进程。
pub fn task_pid_file_path(control_file_path: &Path) -> PathBuf {
    control_file_path.with_extension("pid")
}

// 清空或删除任务时会优先读取 pid 文件终止 sidecar 子进程，避免后台继续写图片。
pub fn terminate_task_process(control_file_path: &Path) -> Result<bool, String> {
    let pid_file_path = task_pid_file_path(control_file_path);
    let pid_text = match fs::read_to_string(&pid_file_path) {
        Ok(content) => content,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(false),
        Err(error) => return Err(format!("读取任务进程标记失败: {error}")),
    };

    let pid = match pid_text.trim().parse::<u32>() {
        Ok(value) => value,
        Err(_) => {
            let _ = fs::remove_file(pid_file_path);
            return Ok(false);
        }
    };

    #[cfg(target_os = "windows")]
    let output = {
        use crate::constants::CREATE_NO_WINDOW;
        use std::os::windows::process::CommandExt;
        use std::process::Command;
        Command::new("taskkill")
            .args(["/PID", &pid.to_string(), "/T", "/F"])
            .creation_flags(CREATE_NO_WINDOW)
            .output()
            .map_err(|error| format!("结束后台抓取进程失败: {error}"))?
    };

    #[cfg(not(target_os = "windows"))]
    let output = {
        use std::process::Command;
        Command::new("kill")
            .args(["-TERM", &pid.to_string()])
            .output()
            .map_err(|error| format!("结束后台抓取进程失败: {error}"))?
    };

    let _ = fs::remove_file(pid_file_path);

    if !output.status.success() {
        return Ok(false);
    }

    Ok(true)
}
