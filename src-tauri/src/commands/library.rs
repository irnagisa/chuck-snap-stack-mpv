use serde::Serialize;
use walkdir::WalkDir;
use std::path::Path;
use std::fs;

use super::settings::SharedAppSettings;

#[derive(Serialize)]
pub struct ThumbnailResult {
    pub thumbnail_path: String,
    pub duration: Option<f64>,
}

const VIDEO_EXTENSIONS: &[&str] = &["mp4", "mkv", "webm", "avi", "mov", "m4v", "flv", "wmv"];

#[derive(Serialize)]
pub struct ScannedFile {
    pub path: String,
    pub title: String,
}

#[tauri::command]
pub async fn scan_directory(path: String) -> Result<Vec<ScannedFile>, String> {
    let mut files = Vec::new();

    for entry in WalkDir::new(&path).follow_links(true) {
        let entry = entry.map_err(|e| e.to_string())?;
        if !entry.file_type().is_file() {
            continue;
        }
        let ext = entry
            .path()
            .extension()
            .and_then(|e| e.to_str())
            .map(|e| e.to_lowercase())
            .unwrap_or_default();
        if VIDEO_EXTENSIONS.contains(&ext.as_str()) {
            let title = entry
                .path()
                .file_stem()
                .and_then(|s| s.to_str())
                .unwrap_or("")
                .to_string();
            files.push(ScannedFile {
                path: entry.path().to_string_lossy().to_string(),
                title,
            });
        }
    }

    Ok(files)
}

#[tauri::command]
pub async fn generate_thumbnail(
    app_settings: tauri::State<'_, SharedAppSettings>,
    video_path: String,
    output_path: String,
) -> Result<ThumbnailResult, String> {
    let (ffmpeg_path, ffprobe_path) = {
        let s = app_settings.lock().map_err(|e| e.to_string())?;
        (s.ffmpeg_path.clone(), s.ffprobe_path.clone())
    };

    if let Some(parent) = Path::new(&output_path).parent() {
        tokio::fs::create_dir_all(parent)
            .await
            .map_err(|e| e.to_string())?;
    }

    // ffprobe で動画の長さを取得
    let duration = tokio::process::Command::new(&ffprobe_path)
        .args([
            "-v", "quiet",
            "-show_entries", "format=duration",
            "-of", "default=noprint_wrappers=1:nokey=1",
            &video_path,
        ])
        .output()
        .await
        .ok()
        .and_then(|out| String::from_utf8(out.stdout).ok())
        .and_then(|s| s.trim().parse::<f64>().ok());

    // 5秒地点からフレームを抽出 (高速シーク)
    let status = tokio::process::Command::new(&ffmpeg_path)
        .args([
            "-y", "-ss", "5", "-i", &video_path,
            "-frames:v", "1", "-vf", "scale=320:-1", "-q:v", "2",
            &output_path,
        ])
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status()
        .await
        .map_err(|e| e.to_string())?;

    if status.success() {
        return Ok(ThumbnailResult { thumbnail_path: output_path, duration });
    }

    // 動画が5秒未満の場合は先頭フレームで再試行
    let status2 = tokio::process::Command::new(&ffmpeg_path)
        .args([
            "-y", "-i", &video_path,
            "-frames:v", "1", "-vf", "scale=320:-1", "-q:v", "2",
            &output_path,
        ])
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status()
        .await
        .map_err(|e| e.to_string())?;

    if status2.success() {
        Ok(ThumbnailResult { thumbnail_path: output_path, duration })
    } else {
        Err("ffmpeg failed".to_string())
    }
}

/// 動画ファイルをファイルシステムから削除する。
#[tauri::command]
pub async fn delete_video_file(path: String) -> Result<(), String> {
    fs::remove_file(&path).map_err(|e| format!("ファイル削除失敗: {e}"))
}
