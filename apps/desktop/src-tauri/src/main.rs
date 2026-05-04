// Tauri 程序入口：启动 Rust 命令层和桌面窗口运行时。
// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    movie_cover_downloader_desktop_lib::run()
}
