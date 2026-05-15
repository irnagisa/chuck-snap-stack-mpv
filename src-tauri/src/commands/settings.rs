// アプリ設定の保持・更新コマンド

use std::sync::{Arc, Mutex};

pub struct AppSettings {
    pub mpv_path: String,
    pub ffmpeg_path: String,
    pub ffprobe_path: String,
}

pub type SharedAppSettings = Arc<Mutex<AppSettings>>;

impl AppSettings {
    pub fn new() -> SharedAppSettings {
        Arc::new(Mutex::new(AppSettings {
            mpv_path: "/opt/homebrew/bin/mpv".to_string(),
            ffmpeg_path: "ffmpeg".to_string(),
            ffprobe_path: "ffprobe".to_string(),
        }))
    }
}

/// フロントエンドから設定値を受け取り、Rust 側の状態を更新する。
#[tauri::command]
pub async fn update_settings(
    state: tauri::State<'_, SharedAppSettings>,
    mpv_path: String,
    ffmpeg_path: String,
    ffprobe_path: String,
) -> Result<(), String> {
    let mut s = state.lock().map_err(|e| e.to_string())?;
    s.mpv_path = mpv_path;
    s.ffmpeg_path = ffmpeg_path;
    s.ffprobe_path = ffprobe_path;
    Ok(())
}
