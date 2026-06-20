// Cookie 加密解密模块

use crate::constants::PROTECTED_COOKIE_PAYLOAD_SCHEME;
use crate::utils::{hex_decode, hex_encode};
use serde_json::Value;

#[cfg(target_os = "windows")]
use windows_sys::Win32::{
    Foundation::LocalFree,
    Security::Cryptography::{
        CryptProtectData, CryptUnprotectData, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB,
    },
};

#[cfg(target_os = "windows")]
pub fn protect_bytes(plain: &[u8]) -> Result<Vec<u8>, String> {
    let input = CRYPT_INTEGER_BLOB {
        cbData: plain.len() as u32,
        pbData: plain.as_ptr() as *mut u8,
    };
    let mut output = CRYPT_INTEGER_BLOB {
        cbData: 0,
        pbData: std::ptr::null_mut(),
    };

    let ok = unsafe {
        CryptProtectData(
            &input,
            std::ptr::null(),
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            CRYPTPROTECT_UI_FORBIDDEN,
            &mut output,
        )
    };
    if ok == 0 {
        return Err("加密 Cookie 失败".to_string());
    }

    let protected =
        unsafe { std::slice::from_raw_parts(output.pbData, output.cbData as usize).to_vec() };
    unsafe {
        LocalFree(output.pbData as _);
    }
    Ok(protected)
}

#[cfg(target_os = "windows")]
pub fn unprotect_bytes(protected: &[u8]) -> Result<Vec<u8>, String> {
    let input = CRYPT_INTEGER_BLOB {
        cbData: protected.len() as u32,
        pbData: protected.as_ptr() as *mut u8,
    };
    let mut output = CRYPT_INTEGER_BLOB {
        cbData: 0,
        pbData: std::ptr::null_mut(),
    };

    let ok = unsafe {
        CryptUnprotectData(
            &input,
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            CRYPTPROTECT_UI_FORBIDDEN,
            &mut output,
        )
    };
    if ok == 0 {
        return Err("解密 Cookie 失败".to_string());
    }

    let plain =
        unsafe { std::slice::from_raw_parts(output.pbData, output.cbData as usize).to_vec() };
    unsafe {
        LocalFree(output.pbData as _);
    }
    Ok(plain)
}

#[cfg(not(target_os = "windows"))]
pub fn protect_bytes(plain: &[u8]) -> Result<Vec<u8>, String> {
    Ok(plain.to_vec())
}

#[cfg(not(target_os = "windows"))]
pub fn unprotect_bytes(protected: &[u8]) -> Result<Vec<u8>, String> {
    Ok(protected.to_vec())
}

pub fn serialize_cookie_payload(cookie: &Value) -> Result<String, String> {
    let payload =
        serde_json::to_vec(cookie).map_err(|error| format!("序列化 cookie 失败: {error}"))?;
    let protected = protect_bytes(&payload)?;
    serde_json::to_string(&serde_json::json!({
        "protected": true,
        "scheme": PROTECTED_COOKIE_PAYLOAD_SCHEME,
        "payload": hex_encode(&protected)
    }))
    .map_err(|error| format!("序列化受保护 cookie 失败: {error}"))
}

pub fn deserialize_cookie_payload(payload: &str) -> Result<Value, String> {
    let parsed = serde_json::from_str::<Value>(payload)
        .map_err(|error| format!("解析 cookie 失败: {error}"))?;
    let is_protected = parsed
        .get("protected")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    if !is_protected {
        return Ok(parsed);
    }

    if parsed.get("scheme").and_then(Value::as_str) != Some(PROTECTED_COOKIE_PAYLOAD_SCHEME) {
        return Err("不支持的 Cookie 保护格式".to_string());
    }
    let encrypted = parsed
        .get("payload")
        .and_then(Value::as_str)
        .ok_or_else(|| "受保护 Cookie 缺少 payload".to_string())
        .and_then(hex_decode)?;
    let decrypted = unprotect_bytes(&encrypted)?;
    serde_json::from_slice::<Value>(&decrypted)
        .map_err(|error| format!("解析解密后的 cookie 失败: {error}"))
}
