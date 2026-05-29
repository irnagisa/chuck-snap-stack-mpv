use serde::Serialize;
use walkdir::WalkDir;
use std::path::Path;
use std::fs;

use super::settings::SharedAppSettings;
use super::utils::{validate_image_output_path, validate_path, validate_video_path};

#[derive(Serialize)]
pub struct Chapter {
    pub title: String,
    pub start_time: f64,
    pub end_time: f64,
}

#[derive(Serialize)]
pub struct SubtitleFile {
    pub path: String,
    pub name: String,
    pub ext: String,
}

const SUBTITLE_EXTENSIONS: &[&str] = &["srt", "ass", "vtt", "sub", "ssa"];

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
    let files = tokio::task::spawn_blocking(move || -> Result<Vec<ScannedFile>, String> {
        let mut files = Vec::new();
        let root = std::path::PathBuf::from(&path);

        // 深さ・件数の上限を設けて DoS を防ぐ
        const MAX_DEPTH: usize = 10;
        const MAX_FILES: usize = 50_000;

        for entry in WalkDir::new(&path)
            .follow_links(false)
            .max_depth(MAX_DEPTH)
        {
            if files.len() >= MAX_FILES {
                break;
            }
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
    })
    .await
    .map_err(|e| e.to_string())??;

    Ok(files)
}

#[tauri::command]
pub async fn generate_thumbnail(
    app_settings: tauri::State<'_, SharedAppSettings>,
    video_path: String,
    output_path: String,
) -> Result<ThumbnailResult, String> {
    // パス検証
    validate_video_path(&video_path)?;
    validate_image_output_path(&output_path)?;

    let (ffmpeg_path, ffprobe_path) = {
        let s = app_settings.lock().map_err(|e| e.to_string())?;
        (s.ffmpeg_path.clone(), s.ffprobe_path.clone())
    };

    if let Some(parent) = Path::new(&output_path).parent() {
        tokio::fs::create_dir_all(parent)
            .await
            .map_err(|e| e.to_string())?;
    }

    // ffprobe で duration と音声ストリーム有無を一括取得 (1プロセス)
    let probe = tokio::process::Command::new(&ffprobe_path)
        .args([
            "-v", "quiet",
            "-print_format", "json",
            "-show_format",
            "-show_streams",
            &video_path,
        ])
        .output()
        .await
        .ok()
        .and_then(|out| serde_json::from_slice::<serde_json::Value>(&out.stdout).ok());

    let duration = probe.as_ref()
        .and_then(|v| v["format"]["duration"].as_str())
        .and_then(|s| s.parse::<f64>().ok());

    let has_audio = probe.as_ref()
        .and_then(|v| v["streams"].as_array())
        .map(|streams| {
            streams.iter().any(|s| s["codec_type"].as_str() == Some("audio"))
        })
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
    validate_video_path(&path)?;
    fs::remove_file(&path).map_err(|e| format!("ファイル削除失敗: {e}"))
}

/// 動画ファイルを指定ディレクトリへ移動し、新しいパスを返す。
/// 移動先に同名ファイルが存在する場合は連番サフィックスを付与する。
#[tauri::command]
pub async fn move_video_file(source_path: String, dest_dir: String) -> Result<String, String> {
    // パス検証
    validate_video_path(&source_path)?;
    validate_path(&dest_dir)?;

    let source = std::path::Path::new(&source_path);
    let filename = source.file_name()
        .ok_or_else(|| "invalid filename".to_string())?;

    // ファイル名にパス区切り文字・NULL バイトが含まれていないことを確認 (パストラバーサル対策)
    let filename_str = filename.to_string_lossy();
    if filename_str.contains('/') || filename_str.contains('\\') || filename_str.contains('\0') {
        return Err("ファイル名にパス区切り文字が含まれています".to_string());
    }

    // すでに正しいディレクトリにある場合はスキップ
    let source_parent = source.parent().map(|p| p.to_string_lossy().into_owned()).unwrap_or_default();
    let dest_dir_norm = dest_dir.trim_end_matches('/').to_string();
    if source_parent.trim_end_matches('/') == dest_dir_norm.as_str() {
        return Ok(source_path);
    }

    let dest_base = std::path::Path::new(&dest_dir);
    let mut dest_path = dest_base.join(&*filename_str);

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

    // 最終的な移動先が dest_base の配下にあることを確認 (パストラバーサル対策)
    if let Ok(canon_base) = dest_base.canonicalize() {
        let check_parent = dest_path.parent().unwrap_or(&dest_path);
        let canon_parent = check_parent.canonicalize().unwrap_or_else(|_| check_parent.to_path_buf());
        if !canon_parent.starts_with(&canon_base) {
            return Err("移動先がディレクトリ外です".to_string());
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
    // パス検証
    validate_video_path(&source_path)?;
    validate_path(&dest_dir)?;

    let source = std::path::Path::new(&source_path);
    let filename = source
        .file_name()
        .ok_or_else(|| "invalid filename".to_string())?;

    // ファイル名にパス区切り文字・NULL バイトが含まれていないことを確認 (パストラバーサル対策)
    let filename_str = filename.to_string_lossy();
    if filename_str.contains('/') || filename_str.contains('\\') || filename_str.contains('\0') {
        return Err("ファイル名にパス区切り文字が含まれています".to_string());
    }

    let dest_base = std::path::Path::new(&dest_dir);
    let mut dest_path = dest_base.join(&*filename_str);

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

    // 最終的なコピー先が dest_base の配下にあることを確認 (パストラバーサル対策)
    if let Ok(canon_base) = dest_base.canonicalize() {
        let check_parent = dest_path.parent().unwrap_or(&dest_path);
        let canon_parent = check_parent.canonicalize().unwrap_or_else(|_| check_parent.to_path_buf());
        if !canon_parent.starts_with(&canon_base) {
            return Err("コピー先がディレクトリ外です".to_string());
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
            // 動画パス検証に失敗した場合は削除せず false を返す
            if validate_video_path(&path).is_err() {
                return (path, false);
            }
            let ok = fs::remove_file(&path).is_ok();
            (path, ok)
        })
        .collect();
    Ok(results)
}

/// ffprobe で動画のチャプター情報を取得する。
#[tauri::command]
pub async fn get_chapters(
    app_settings: tauri::State<'_, SharedAppSettings>,
    video_path: String,
) -> Result<Vec<Chapter>, String> {
    validate_video_path(&video_path)?;

    let ffprobe_path = {
        let s = app_settings.lock().map_err(|e| e.to_string())?;
        s.ffprobe_path.clone()
    };

    let out = tokio::process::Command::new(&ffprobe_path)
        .args([
            "-v", "quiet",
            "-print_format", "json",
            "-show_chapters",
            &video_path,
        ])
        .output()
        .await
        .map_err(|e| e.to_string())?;

    let json: serde_json::Value = serde_json::from_slice(&out.stdout)
        .unwrap_or(serde_json::json!({"chapters": []}));

    let chapters = json["chapters"]
        .as_array()
        .map(|arr| {
            arr.iter()
                .map(|ch| {
                    let title = ch["tags"]["title"]
                        .as_str()
                        .unwrap_or("")
                        .to_string();
                    let start_time = ch["start_time"]
                        .as_str()
                        .and_then(|s| s.parse::<f64>().ok())
                        .unwrap_or(0.0);
                    let end_time = ch["end_time"]
                        .as_str()
                        .and_then(|s| s.parse::<f64>().ok())
                        .unwrap_or(start_time);
                    Chapter { title, start_time, end_time }
                })
                .collect()
        })
        .unwrap_or_default();

    Ok(chapters)
}

/// 動画と同じディレクトリから同名の字幕ファイルを検索する。
#[tauri::command]
pub async fn scan_subtitle_files(video_path: String) -> Result<Vec<SubtitleFile>, String> {
    validate_video_path(&video_path)?;

    let path = std::path::Path::new(&video_path);
    let stem = path
        .file_stem()
        .and_then(|s| s.to_str())
        .ok_or_else(|| "ファイル名取得失敗".to_string())?
        .to_lowercase();
    let dir = path.parent().ok_or_else(|| "親ディレクトリ取得失敗".to_string())?;

    let mut subtitles = Vec::new();

    let entries = tokio::task::spawn_blocking({
        let dir = dir.to_path_buf();
        let stem = stem.clone();
        move || -> Vec<SubtitleFile> {
            let Ok(read_dir) = std::fs::read_dir(&dir) else { return vec![] };
            let mut result = Vec::new();
            for entry in read_dir.flatten() {
                let entry_path = entry.path();
                let Some(ext) = entry_path.extension().and_then(|e| e.to_str()) else { continue };
                let ext_lower = ext.to_lowercase();
                if !SUBTITLE_EXTENSIONS.contains(&ext_lower.as_str()) {
                    continue;
                }
                let Some(entry_stem) = entry_path.file_stem().and_then(|s| s.to_str()) else { continue };
                // 動画のステムで始まるファイルを対象とする（言語サフィックスも許容）
                if !entry_stem.to_lowercase().starts_with(&stem) {
                    continue;
                }
                let name = entry_path
                    .file_name()
                    .and_then(|n| n.to_str())
                    .unwrap_or("")
                    .to_string();
                result.push(SubtitleFile {
                    path: entry_path.to_string_lossy().into_owned(),
                    name,
                    ext: ext_lower,
                });
            }
            result
        }
    })
    .await
    .map_err(|e| e.to_string())?;

    subtitles.extend(entries);
    Ok(subtitles)
}

/// テキストファイルを保存する。
#[tauri::command]
pub async fn save_text_file(path: String, content: String) -> Result<(), String> {
    validate_path(&path)?;
    if let Some(parent) = std::path::Path::new(&path).parent() {
        tokio::fs::create_dir_all(parent).await.map_err(|e| e.to_string())?;
    }
    tokio::fs::write(&path, content.as_bytes())
        .await
        .map_err(|e| e.to_string())
}

/// テキストファイルを読み込む。
#[tauri::command]
pub async fn read_text_file(path: String) -> Result<String, String> {
    validate_path(&path)?;
    tokio::fs::read_to_string(&path)
        .await
        .map_err(|e| e.to_string())
}

/// 指定タイムスタンプのフレームをカスタムサムネイルとしてキャプチャする。
#[tauri::command]
pub async fn capture_frame_at(
    app_settings: tauri::State<'_, SharedAppSettings>,
    video_path: String,
    timestamp: f64,
    output_path: String,
) -> Result<(), String> {
    validate_video_path(&video_path)?;
    validate_image_output_path(&output_path)?;

    let ffmpeg_path = {
        let s = app_settings.lock().map_err(|e| e.to_string())?;
        s.ffmpeg_path.clone()
    };

    if let Some(parent) = Path::new(&output_path).parent() {
        tokio::fs::create_dir_all(parent)
            .await
            .map_err(|e| e.to_string())?;
    }

    let ts = timestamp.max(0.0).to_string();
    let status = tokio::process::Command::new(&ffmpeg_path)
        .args([
            "-y", "-ss", &ts, "-i", &video_path,
            "-frames:v", "1", "-vf", "scale=320:-1", "-q:v", "2",
            &output_path,
        ])
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status()
        .await
        .map_err(|e| e.to_string())?;

    if status.success() {
        Ok(())
    } else {
        Err("フレームキャプチャに失敗しました".to_string())
    }
}
