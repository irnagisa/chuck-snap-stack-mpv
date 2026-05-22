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
            mpv_path: detect_mpv_path(),
            ffmpeg_path: "ffmpeg".to_string(),
            ffprobe_path: "ffprobe".to_string(),
        }))
    }
}

/// macOS の一般的なインストール場所を順に試し、最初に見つかったパスを返す。
/// 見つからない場合は "mpv"（PATH 依存）を返す。
fn detect_mpv_path() -> String {
    const CANDIDATES: &[&str] = &[
        "/opt/homebrew/bin/mpv",  // Apple Silicon Homebrew
        "/usr/local/bin/mpv",     // Intel Homebrew
        "/usr/bin/mpv",
    ];
    for path in CANDIDATES {
        if std::path::Path::new(path).exists() {
            return path.to_string();
        }
    }
    "mpv".to_string()
}

/// 自動検出した mpv パスをフロントエンドに返す。
#[tauri::command]
pub async fn get_default_mpv_path() -> String {
    detect_mpv_path()
}

/// 指定パスがファイルとして存在するか確認する。
#[tauri::command]
pub async fn path_exists(path: String) -> bool {
    std::path::Path::new(&path).exists()
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
