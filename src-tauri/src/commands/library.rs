use serde::Serialize;
use walkdir::WalkDir;
use std::path::Path;
use std::fs;

use super::settings::SharedAppSettings;
use super::utils::{validate_image_output_path, validate_media_path, validate_path, validate_video_path};

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

const VIDEO_EXTENSIONS: &[&str] = &["mp4", "mkv", "webm", "avi", "mov", "m4v", "flv", "wmv", "media"];
const AUDIO_EXTENSIONS: &[&str] = &["mp3", "flac", "aac", "wav", "ogg", "opus", "m4a", "wma"];
const IMAGE_EXTENSIONS: &[&str] = &["jpg", "jpeg", "png", "gif", "webp", "bmp", "tiff", "heic", "avif"];

#[derive(Serialize)]
pub struct ScannedFile {
    pub path: String,
    pub title: String,
    pub parent_dir_name: Option<String>,
    pub media_type: String,
}

#[derive(Serialize)]
pub struct ScanResult {
    pub files: Vec<ScannedFile>,
    pub errors: Vec<String>,
    pub truncated: bool,
    pub skipped_count: u32,
}

/// Core scanning logic (blocking). Call via spawn_blocking from async context.
pub fn scan_dir_core(path: &str) -> ScanResult {
    let mut files = Vec::new();
    let mut errors = Vec::new();
    let mut skipped_count: u32 = 0;
    let root = std::path::PathBuf::from(path);

    const MAX_DEPTH: usize = 10;
    const MAX_FILES: usize = 50_000;
    let mut truncated = false;

    for entry in WalkDir::new(path)
        .follow_links(true)
        .max_depth(MAX_DEPTH)
    {
        if files.len() >= MAX_FILES {
            truncated = true;
            break;
        }
        let entry = match entry {
            Ok(e) => e,
            Err(e) => {
                let msg = if !root.exists() {
                    format!(
                        "フォルダにアクセスできません: {} (ドライブが接続されていない可能性があります)",
                        root.display()
                    )
                } else {
                    format!("walk error: {e}")
                };
                errors.push(msg);
                continue;
            }
        };
        if !entry.file_type().is_file() {
            continue;
        }
        let ext = entry
            .path()
            .extension()
            .and_then(|e| e.to_str())
            .map(|e| e.to_lowercase())
            .unwrap_or_default();
        let media_type = if VIDEO_EXTENSIONS.contains(&ext.as_str()) {
            "video"
        } else if AUDIO_EXTENSIONS.contains(&ext.as_str()) {
            "audio"
        } else if IMAGE_EXTENSIONS.contains(&ext.as_str()) {
            "image"
        } else {
            skipped_count += 1;
            continue;
        };
        let title = entry
            .path()
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("")
            .to_string();
        let file_path = entry.path().to_path_buf();
        let parent_dir_name = file_path.parent().and_then(|p| {
            if p == root {
                None
            } else {
                p.file_name().and_then(|n| n.to_str()).map(|s| s.to_string())
            }
        });
        files.push(ScannedFile {
            path: file_path.to_string_lossy().to_string(),
            title,
            parent_dir_name,
            media_type: media_type.to_string(),
        });
    }

    ScanResult { files, errors, truncated, skipped_count }
}

#[tauri::command]
pub async fn scan_directory(path: String) -> Result<ScanResult, String> {
    let result = tokio::task::spawn_blocking(move || -> Result<ScanResult, String> {
        Ok(scan_dir_core(&path))
    })
    .await
    .map_err(|e| e.to_string())??;

    Ok(result)
}

#[tauri::command]
pub async fn generate_thumbnail(
    app_settings: tauri::State<'_, SharedAppSettings>,
    video_path: String,
    output_path: String,
) -> Result<ThumbnailResult, String> {
    // パス検証 (動画・音声を受け付ける)
    validate_media_path(&video_path)?;
    validate_image_output_path(&output_path)?;

    // 音声ファイルの場合はアルバムアートを抽出する
    let ext = std::path::Path::new(&video_path)
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_lowercase())
        .unwrap_or_default();
    let is_audio = AUDIO_EXTENSIONS.contains(&ext.as_str());

    let (ffmpeg_path, ffprobe_path) = {
        let s = app_settings.lock().map_err(|e| e.to_string())?;
        (s.ffmpeg_path.clone(), s.ffprobe_path.clone())
    };

    if let Some(parent) = Path::new(&output_path).parent() {
        tokio::fs::create_dir_all(parent)
            .await
            .map_err(|e| e.to_string())?;
    }

    let is_image = IMAGE_EXTENSIONS.contains(&ext.as_str());

    // 画像ファイルはffprobeスキップ・シークなしでリサイズのみ
    // scale=320:-2: 高さを2の倍数に丸めることで偶数次元を保証する
    if is_image {
        let status = tokio::process::Command::new(&ffmpeg_path)
            .args([
                "-y", "-i", &video_path,
                "-frames:v", "1", "-vf", "scale=320:-2", "-q:v", "80",
                &output_path,
            ])
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .status()
            .await
            .map_err(|e| e.to_string())?;

        return if status.success() && tokio::fs::metadata(&output_path).await.map(|m| m.len() > 0).unwrap_or(false) {
            Ok(ThumbnailResult { thumbnail_path: output_path, duration: None, has_audio: false })
        } else {
            Err("ffmpeg failed".to_string())
        };
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

    if is_audio {
        // 音声ファイル: 埋め込みアルバムアートを抽出し WebP へ再エンコードする
        let status = tokio::process::Command::new(&ffmpeg_path)
            .args([
                "-y", "-i", &video_path,
                "-an", "-frames:v", "1", "-vf", "scale=320:-2", "-q:v", "80",
                &output_path,
            ])
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .status()
            .await
            .map_err(|e| e.to_string())?;

        if status.success() {
            return Ok(ThumbnailResult { thumbnail_path: output_path, duration, has_audio: true });
        }
        // アルバムアートなし: エラーとして返し、呼び出し元でサムネイルなしとして扱う
        return Err("アルバムアートが見つかりません".to_string());
    }

    // duration に応じてシーク位置を決定する
    // duration < 1秒の場合は -ss を使わずに先頭フレームを直接抽出する
    // (短い動画では -ss でシーク先がEOFを超えてffmpegが空出力で終了するため)
    let seek_secs = match duration {
        Some(d) if d >= 5.0 => Some(5.0_f64),
        Some(d) if d >= 1.0 => Some((d * 0.1_f64).max(0.5)),
        _ => None, // duration 不明または 1 秒未満: シークなし
    };

    let status = if let Some(ss) = seek_secs {
        let ss_str = ss.to_string();
        tokio::process::Command::new(&ffmpeg_path)
            .args([
                "-y", "-ss", &ss_str, "-i", &video_path,
                "-frames:v", "1", "-vf", "scale=320:-2", "-q:v", "80",
                &output_path,
            ])
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .status()
            .await
            .map_err(|e| e.to_string())?
    } else {
        // 1 秒未満: 先頭フレームを直接抽出
        tokio::process::Command::new(&ffmpeg_path)
            .args([
                "-y", "-i", &video_path,
                "-frames:v", "1", "-vf", "scale=320:-2", "-q:v", "80",
                &output_path,
            ])
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .status()
            .await
            .map_err(|e| e.to_string())?
    };

    // 出力ファイルが実際に生成されたか確認する
    // (短い動画では ffmpeg が成功扱いで終了しても空出力になる場合がある)
    if status.success() && tokio::fs::metadata(&output_path).await.map(|m| m.len() > 0).unwrap_or(false) {
        return Ok(ThumbnailResult { thumbnail_path: output_path, duration, has_audio });
    }

    // シークありで失敗 or 出力が空 → 先頭フレームで再試行
    let status2 = tokio::process::Command::new(&ffmpeg_path)
        .args([
            "-y", "-i", &video_path,
            "-frames:v", "1", "-vf", "scale=320:-2", "-q:v", "80",
            &output_path,
        ])
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status()
        .await
        .map_err(|e| e.to_string())?;

    if status2.success() && tokio::fs::metadata(&output_path).await.map(|m| m.len() > 0).unwrap_or(false) {
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

/// 動画ファイルをファイルシステムから削除する。ファイルが既に存在しない場合は成功として扱う。
#[tauri::command]
pub async fn delete_video_file(path: String) -> Result<(), String> {
    validate_media_path(&path)?;
    match fs::remove_file(&path) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(format!("ファイル削除失敗: {e}")),
    }
}

/// 動画ファイルを指定ディレクトリへ移動し、新しいパスを返す。
/// 移動先に同名ファイルが存在する場合は連番サフィックスを付与する。
#[tauri::command]
pub async fn move_video_file(source_path: String, dest_dir: String) -> Result<String, String> {
    // パス検証
    validate_media_path(&source_path)?;
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
    validate_media_path(&source_path)?;
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

    // ウォッチャーが正規化パスでイベントを発火するため、返すパスも正規化して二重登録を防ぐ
    let canonical = tokio::fs::canonicalize(&dest_path)
        .await
        .unwrap_or(dest_path);
    Ok(canonical.to_string_lossy().into_owned())
}

/// 複数の動画ファイルを一括削除する。各ファイルの削除成否を (path, success) の配列で返す。
#[tauri::command]
pub async fn delete_multiple_video_files(paths: Vec<String>) -> Result<Vec<(String, bool)>, String> {
    let results = paths
        .into_iter()
        .map(|path| {
            // 動画パス検証に失敗した場合は削除せず false を返す
            if validate_media_path(&path).is_err() {
                return (path, false);
            }
            let ok = fs::remove_file(&path).is_ok();
            (path, ok)
        })
        .collect();
    Ok(results)
}

/// 動画ファイルを OS のゴミ箱に移動する。
/// macOS では NSFileManager.trashItemAtURL を使用し、外部ストレージでは
/// ボリューム直下の /.Trashes/<uid>/ に移動するため、クロスデバイスでも安全。
#[tauri::command]
pub async fn trash_video_file(path: String) -> Result<(), String> {
    validate_media_path(&path)?;
    tokio::task::spawn_blocking(move || {
        trash::delete(&path).map_err(|e| format!("ゴミ箱への移動に失敗しました: {e}"))
    })
    .await
    .map_err(|e| e.to_string())?
}

/// 複数の動画ファイルを OS のゴミ箱に移動する。
/// 各ファイルの成否を (path, success) の配列で返す。
#[tauri::command]
pub async fn trash_multiple_video_files(
    paths: Vec<String>,
) -> Result<Vec<(String, bool)>, String> {
    tokio::task::spawn_blocking(move || {
        paths
            .into_iter()
            .map(|path| {
                if validate_media_path(&path).is_err() {
                    return (path, false);
                }
                let ok = trash::delete(&path).is_ok();
                (path, ok)
            })
            .collect::<Vec<_>>()
    })
    .await
    .map(Ok)
    .map_err(|e| e.to_string())?
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
            let Ok(read_dir) = std::fs::read_dir(&dir) else {
                log::warn!("[scan_subtitle_files] ディレクトリの読み取りに失敗しました: {}", dir.display());
                return vec![];
            };
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

/// 動画ファイルを同じディレクトリ内でリネームし、新しいパスを返す。
#[tauri::command]
pub async fn rename_video_file(old_path: String, new_name: String) -> Result<String, String> {
    validate_media_path(&old_path)?;

    // ファイル名のバリデーション
    let trimmed = new_name.trim();
    if trimmed.is_empty() {
        return Err("ファイル名が空です".to_string());
    }
    if trimmed.contains('/') || trimmed.contains('\\') || trimmed.contains('\0') {
        return Err("ファイル名にパス区切り文字が含まれています".to_string());
    }

    let old = Path::new(&old_path);
    let dir = old.parent().ok_or_else(|| "親ディレクトリが取得できません".to_string())?;
    let new_path = dir.join(trimmed);

    // パストラバーサル対策: 親ディレクトリが変わらないことを確認
    if new_path.parent().map(|p| p != dir).unwrap_or(true) {
        return Err("ファイル名にパス区切り文字が含まれています".to_string());
    }

    if new_path.exists() {
        return Err(format!("同名のファイルがすでに存在します: {}", trimmed));
    }

    tokio::fs::rename(&old, &new_path).await.map_err(|e| e.to_string())?;

    Ok(new_path.to_string_lossy().into_owned())
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
            "-frames:v", "1", "-vf", "scale=320:-2", "-q:v", "90",
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

/// パスを正規化 (シンボリックリンク解決) して返す。解決できない場合は元パスをそのまま返す。
#[tauri::command]
pub async fn canonicalize_path(path: String) -> String {
    tokio::fs::canonicalize(&path)
        .await
        .map(|p| p.to_string_lossy().into_owned())
        .unwrap_or(path)
}

/// サムネイルキャッシュディレクトリ内の .jpg ファイルをすべて削除する。
/// WebP 移行時の一括クリーンアップ用。
#[tauri::command]
pub async fn cleanup_jpg_thumbnails(thumbs_dir: String) -> Result<u32, String> {
    use super::utils::validate_path;
    validate_path(&thumbs_dir)?;
    let base = std::path::Path::new(&thumbs_dir);
    if !base.exists() {
        return Ok(0);
    }
    let mut count = 0u32;
    for entry in WalkDir::new(base).into_iter().filter_map(|e| e.ok()) {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()).map(|e| e.eq_ignore_ascii_case("jpg")).unwrap_or(false) {
            let _ = tokio::fs::remove_file(path).await;
            count += 1;
        }
    }
    Ok(count)
}
