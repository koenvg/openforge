use std::sync::Mutex;
use tauri::State;
use serde::Serialize;
use crate::db;

#[derive(Serialize)]
pub struct OpenCodeInstallStatus {
    pub installed: bool,
    pub path: Option<String>,
    pub version: Option<String>,
}

#[tauri::command]
pub async fn check_opencode_installed() -> Result<OpenCodeInstallStatus, String> {
    let output = std::process::Command::new("which")
        .arg("opencode")
        .output();

    match output {
        Ok(out) if out.status.success() => {
            let path = String::from_utf8_lossy(&out.stdout).trim().to_string();
            let version = std::process::Command::new("opencode")
                .arg("--version")
                .output()
                .ok()
                .and_then(|v| {
                    if v.status.success() {
                        Some(String::from_utf8_lossy(&v.stdout).trim().to_string())
                    } else {
                        None
                    }
                });
            Ok(OpenCodeInstallStatus {
                installed: true,
                path: Some(path),
                version,
            })
        }
        _ => Ok(OpenCodeInstallStatus {
            installed: false,
            path: None,
            version: None,
        }),
    }
}

#[tauri::command]
pub async fn get_config(
    db: State<'_, Mutex<db::Database>>,
    key: String,
) -> Result<Option<String>, String> {
    let db_lock = db.lock().unwrap();
    db_lock.get_config(&key)
        .map_err(|e| format!("Failed to get config: {}", e))
}

#[tauri::command]
pub async fn set_config(
    db: State<'_, Mutex<db::Database>>,
    key: String,
    value: String,
) -> Result<(), String> {
    let db_lock = db.lock().unwrap();
    db_lock.set_config(&key, &value)
        .map_err(|e| format!("Failed to set config: {}", e))
}
