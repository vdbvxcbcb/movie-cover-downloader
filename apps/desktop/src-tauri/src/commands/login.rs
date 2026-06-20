// 登录窗口管理命令模块

use crate::types::LoginWindowCookieStatus;
use crate::utils::run_blocking_job;
use tauri::{AppHandle, Manager};

// 豆瓣登录导入只把 dbcl2 和 ck 都存在视为登录成功，其他 Cookie 会一起拼成请求头。
pub fn resolve_douban_login_cookie_status<K, V>(
    window_exists: bool,
    cookies: &[(K, V)],
) -> LoginWindowCookieStatus
where
    K: AsRef<str>,
    V: AsRef<str>,
{
    if !window_exists {
        return LoginWindowCookieStatus {
            status: "closed".to_string(),
            cookie: None,
        };
    }

    let mut has_dbcl2 = false;
    let mut has_ck = false;
    let mut cookie_parts = Vec::new();

    for (name, value) in cookies {
        let name = name.as_ref().trim();
        let value = value.as_ref().trim();
        if name.is_empty() || value.is_empty() {
            continue;
        }

        if name == "dbcl2" {
            has_dbcl2 = true;
        }
        if name == "ck" {
            has_ck = true;
        }

        cookie_parts.push(format!("{name}={value}"));
    }

    if has_dbcl2 && has_ck {
        return LoginWindowCookieStatus {
            status: "ready".to_string(),
            cookie: Some(cookie_parts.join("; ")),
        };
    }

    LoginWindowCookieStatus {
        status: "pending".to_string(),
        cookie: None,
    }
}

// 读取 WebView Cookie 是同步/阻塞操作，因此外层命令会通过 run_blocking_job 调用。
fn read_login_window_cookie_status_blocking(
    app: AppHandle,
    window_label: String,
) -> Result<LoginWindowCookieStatus, String> {
    let Some(window) = app.get_webview_window(&window_label) else {
        return Ok(resolve_douban_login_cookie_status::<String, String>(
            false,
            &[],
        ));
    };

    let cookies = window
        .cookies()
        .map_err(|error| format!("读取登录窗口 Cookie 失败: {error}"))?;
    let cookie_pairs = cookies
        .into_iter()
        .map(|cookie| (cookie.name().to_string(), cookie.value().to_string()))
        .collect::<Vec<_>>();

    Ok(resolve_douban_login_cookie_status(true, &cookie_pairs))
}

// 前端轮询登录窗口状态时调用；返回 ready 后前端会关闭窗口并保存 Cookie。
#[tauri::command]
pub async fn check_login_window_cookie_status(
    app: AppHandle,
    window_label: String,
) -> Result<LoginWindowCookieStatus, String> {
    run_blocking_job(move || read_login_window_cookie_status_blocking(app, window_label)).await
}

// 用户取消或 Cookie 导入完成后关闭豆瓣登录窗口。
#[tauri::command]
pub fn close_login_window(app: AppHandle, window_label: String) -> Result<bool, String> {
    let Some(window) = app.get_webview_window(&window_label) else {
        return Ok(false);
    };

    window
        .close()
        .map_err(|error| format!("关闭登录窗口失败: {error}"))?;
    Ok(true)
}
