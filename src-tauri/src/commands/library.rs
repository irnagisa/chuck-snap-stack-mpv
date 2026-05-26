use serde::Serialize;
use walkdir::WalkDir;
use std::path::Path;
use std::fs;

use super::settings::SharedAppSettings;

#[derive(Serialize)]
pub struct ThumbnailResult {
    pub thumbnail_path: String,
    pub duration: Option<f64>,
    pub has_audio: bool,
}

const VIDEO_EXTENSIONS: &[&str] = &["mp4", "mkv", "webm", "avi", "mov", "m4v", "flv", "wmv"];

#[derive(Serialize)]
pub struct ScannedFile {
    pub path: String,
    pub title: String,
    pub parent_dir_name: Option<String>,
}

#[tauri::command]
pub async fn scan_directory(path: String) -> Result<Vec<ScannedFile>, String> {
    let mut files = Vec::new();
    let root = Path::new(&path);

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
            let parent_dir_name = entry.path().parent().and_then(|p| {
                if p == root {
                    None
                } else {
                    p.file_name().and_then(|n| n.to_str()).map(|s| s.to_string())
                }
            });
            files.push(ScannedFile {
                path: entry.path().to_string_lossy().to_string(),
                title,
                parent_dir_name,
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

    // ffprobe で音声ストリームの有無を確認
    let has_audio = tokio::process::Command::new(&ffprobe_path)
        .args([
            "-v", "quiet",
            "-select_streams", "a:0",
            "-show_entries", "stream=codec_type",
            "-of", "default=noprint_wrappers=1:nokey=1",
            &video_path,
        ])
        .output()
        .await
        .map(|out| !out.stdout.iter().all(|b| b.is_ascii_whitespace()))
        .unwrap_or(true);

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
        return Ok(ThumbnailResult { thumbnail_path: output_path, duration, has_audio });
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
        Ok(ThumbnailResult { thumbnail_path: output_path, duration, has_audio })
    } else {
        Err("ffmpeg failed".to_string())
    }
}

/// ffprobe で音声ストリームの有無を確認する。
#[tauri::command]
pub async fn check_has_audio(
    app_settings: tauri::State<'_, SharedAppSettings>,
    video_path: String,
) -> Result<bool, String> {
    let ffprobe_path = {
        let s = app_settings.lock().map_err(|e| e.to_string())?;
        s.ffprobe_path.clone()
    };

    let out = tokio::process::Command::new(&ffprobe_path)
        .args([
            "-v", "quiet",
            "-select_streams", "a:0",
            "-show_entries", "stream=codec_type",
            "-of", "default=noprint_wrappers=1:nokey=1",
            &video_path,
        ])
        .output()
        .await
        .map_err(|e| e.to_string())?;

    Ok(!out.stdout.iter().all(|b| b.is_ascii_whitespace()))
}

/// ファイルサイズをバイト単位で返す。
#[tauri::command]
pub async fn get_file_size(path: String) -> Result<u64, String> {
    fs::metadata(&path)
        .map(|m| m.len())
        .map_err(|e| format!("ファイルサイズ取得失敗: {e}"))
}

/// 複数ファイルのサイズをバッチで返す。ファイルが存在しない場合は None。
#[tauri::command]
pub async fn get_file_sizes(paths: Vec<String>) -> Result<Vec<Option<u64>>, String> {
    let sizes = paths
        .iter()
        .map(|p| fs::metadata(p).ok().map(|m| m.len()))
        .collect();
    Ok(sizes)
}

#[derive(Serialize)]
pub struct VideoDimensions {
    pub width: u32,
    pub height: u32,
}

/// ffprobe で動画の解像度 (width × height) を取得する。
#[tauri::command]
pub async fn get_video_dimensions(
    app_settings: tauri::State<'_, SharedAppSettings>,
    path: String,
) -> Result<VideoDimensions, String> {
    let ffprobe_path = {
        let s = app_settings.lock().map_err(|e| e.to_string())?;
        s.ffprobe_path.clone()
    };

    let out = tokio::process::Command::new(&ffprobe_path)
        .args([
            "-v", "quiet",
            "-select_streams", "v:0",
            "-show_entries", "stream=width,height",
            "-of", "csv=p=0",
            &path,
        ])
        .output()
        .await
        .map_err(|e| e.to_string())?;

    let stdout = String::from_utf8_lossy(&out.stdout);
    let parts: Vec<&str> = stdout.trim().split(',').collect();
    if parts.len() < 2 {
        return Err("解像度を取得できませんでした".to_string());
    }
    let width = parts[0].parse::<u32>().map_err(|e| e.to_string())?;
    let height = parts[1].parse::<u32>().map_err(|e| e.to_string())?;
    Ok(VideoDimensions { width, height })
}

/// 動画ファイルをファイルシステムから削除する。
#[tauri::command]
pub async fn delete_video_file(path: String) -> Result<(), String> {
    fs::remove_file(&path).map_err(|e| format!("ファイル削除失敗: {e}"))
}

/// 動画ファイルを指定ディレクトリへ移動し、新しいパスを返す。
/// 移動先に同名ファイルが存在する場合は連番サフィックスを付与する。
#[tauri::command]
pub async fn move_video_file(source_path: String, dest_dir: String) -> Result<String, String> {
    let source = std::path::Path::new(&source_path);
    let filename = source.file_name()
        .ok_or_else(|| "invalid filename".to_string())?;

    // すでに正しいディレクトリにある場合はスキップ
    let source_parent = source.parent().map(|p| p.to_string_lossy().into_owned()).unwrap_or_default();
    let dest_dir_norm = dest_dir.trim_end_matches('/').to_string();
    if source_parent.trim_end_matches('/') == dest_dir_norm.as_str() {
        return Ok(source_path);
    }

    let dest_base = std::path::Path::new(&dest_dir);
    let mut dest_path = dest_base.join(filename);

    // 同名ファイルが存在する場合は連番サフィックスを付与
    if dest_path.exists() {
        let stem = dest_path.file_stem().unwrap_or_default().to_string_lossy().into_owned();
        let ext = dest_path.extension()
            .map(|e| format!(".{}", e.to_string_lossy()))
            .unwrap_or_default();
        let mut i = 2u32;
        loop {
            dest_path = dest_base.join(format!("{}_{}{}", stem, i, ext));
            if !dest_path.exists() { break; }
            i += 1;
        }
    }

    tokio::fs::create_dir_all(&dest_dir).await.map_err(|e| e.to_string())?;

    // rename が失敗する場合 (クロスデバイス) は copy + delete にフォールバック
    if tokio::fs::rename(&source, &dest_path).await.is_err() {
        tokio::fs::copy(&source, &dest_path).await.map_err(|e| e.to_string())?;
        tokio::fs::remove_file(&source).await.map_err(|e| e.to_string())?;
    }

    Ok(dest_path.to_string_lossy().into_owned())
}

/// 動画ファイルを指定ディレクトリへコピーし、新しいパスを返す。
/// コピー先に同名ファイルが存在する場合は連番サフィックスを付与する。
#[tauri::command]
pub async fn copy_video_file(source_path: String, dest_dir: String) -> Result<String, String> {
    let source = std::path::Path::new(&source_path);
    let filename = source
        .file_name()
        .ok_or_else(|| "invalid filename".to_string())?;

    let dest_base = std::path::Path::new(&dest_dir);
    let mut dest_path = dest_base.join(filename);

    // 同名ファイルが存在する場合は連番サフィックスを付与
    if dest_path.exists() {
        let stem = dest_path
            .file_stem()
            .unwrap_or_default()
            .to_string_lossy()
            .into_owned();
        let ext = dest_path
            .extension()
            .map(|e| format!(".{}", e.to_string_lossy()))
            .unwrap_or_default();
        let mut i = 2u32;
        loop {
            dest_path = dest_base.join(format!("{}_{}{}", stem, i, ext));
            if !dest_path.exists() {
                break;
            }
            i += 1;
        }
    }

    tokio::fs::create_dir_all(&dest_dir)
        .await
        .map_err(|e| e.to_string())?;
    tokio::fs::copy(&source, &dest_path)
        .await
        .map_err(|e| e.to_string())?;

    Ok(dest_path.to_string_lossy().into_owned())
}

/// 複数の動画ファイルを一括削除する。各ファイルの削除成否を (path, success) の配列で返す。
#[tauri::command]
pub async fn delete_multiple_video_files(paths: Vec<String>) -> Result<Vec<(String, bool)>, String> {
    let results = paths
        .into_iter()
        .map(|path| {
            let ok = fs::remove_file(&path).is_ok();
            (path, ok)
        })
        .collect();
    Ok(results)
}
