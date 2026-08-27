use serde::Serialize;
use walkdir::WalkDir;
use std::path::Path;
use std::fs;

use super::settings::SharedAppSettings;
use super::utils::{normalize_path_str, resolve_unique_path, validate_image_output_path, validate_media_path, validate_path, validate_text_path, validate_video_path};
use crate::db::DbState;

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

const VIDEO_EXTENSIONS: &[&str] = &["mp4", "mkv", "webm", "avi", "mov", "m4v", "flv", "wmv", "mpg", "mpeg", "media"];
const AUDIO_EXTENSIONS: &[&str] = &["mp3", "flac", "aac", "wav", "ogg", "opus", "m4a", "wma"];
const IMAGE_EXTENSIONS: &[&str] = &["jpg", "jpeg", "png", "gif", "webp", "bmp", "tiff", "heic", "avif"];

/// WebP RIFF ヘッダー先頭 24 バイトを読んでアニメーション WebP か判定する。
/// VP8X チャンクのフラグビット 1 (Animation) が立っていれば true。
fn is_animated_webp(path: &str) -> bool {
    use std::io::Read;
    let mut buf = [0u8; 24];
    let Ok(mut f) = std::fs::File::open(path) else { return false };
    let Ok(n) = f.read(&mut buf) else { return false };
    n >= 24
        && &buf[0..4] == b"RIFF"
        && &buf[8..12] == b"WEBP"
        && &buf[12..16] == b"VP8X"
        && (buf[20] & 0x02) != 0
}

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
        .follow_links(false) // シンボリックリンクは追跡しない (ライブラリ外への逸脱防止)
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
        // macOS (APFS/HFS+) はファイル名を NFD 分解形で返すため、DB 保存前に NFC へ
        // 正規化する (normalize_path_str のドキュメント参照)。
        let title = normalize_path_str(
            entry
                .path()
                .file_stem()
                .and_then(|s| s.to_str())
                .unwrap_or(""),
        );
        let file_path = entry.path().to_path_buf();
        let parent_dir_name = file_path.parent().and_then(|p| {
            if p == root {
                None
            } else {
                p.file_name()
                    .and_then(|n| n.to_str())
                    .map(normalize_path_str)
            }
        });
        files.push(ScannedFile {
            path: normalize_path_str(&file_path.to_string_lossy()),
            title,
            parent_dir_name,
            media_type: media_type.to_string(),
        });
    }

    ScanResult { files, errors, truncated, skipped_count }
}

#[tauri::command]
pub async fn scan_directory(path: String) -> Result<ScanResult, String> {
    validate_path(&path)?;
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
        // アニメーション WebP はファイルヘッダー (24 バイト) でフラグを確認し、
        // そのままコピーしてアニメーションを保持する
        if ext == "webp" && is_animated_webp(&video_path) {
            tokio::fs::copy(&video_path, &output_path)
                .await
                .map_err(|e| e.to_string())?;
            return Ok(ThumbnailResult { thumbnail_path: output_path, duration: None, has_audio: false });
        }

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

        if status.success() && tokio::fs::metadata(&output_path).await.map(|m| m.len() > 0).unwrap_or(false) {
            return Ok(ThumbnailResult { thumbnail_path: output_path, duration, has_audio: true });
        }

        // アルバムアートなし: showwavespic フィルターで波形画像を生成する
        // 背景 (#1f2937) + 緑の波形 (#4ade80) を overlay で合成する
        let wave_filter = "color=c=#1f2937:s=320x180,format=rgb24[bg];\
                           showwavespic=s=320x180:colors=#4ade80:scale=sqrt[wv];\
                           [bg][wv]overlay";
        let status_wave = tokio::process::Command::new(&ffmpeg_path)
            .args([
                "-y", "-i", &video_path,
                "-filter_complex", wave_filter,
                "-frames:v", "1", "-q:v", "80",
                &output_path,
            ])
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .status()
            .await
            .map_err(|e| e.to_string())?;

        if status_wave.success() && tokio::fs::metadata(&output_path).await.map(|m| m.len() > 0).unwrap_or(false) {
            return Ok(ThumbnailResult { thumbnail_path: output_path, duration, has_audio: true });
        }

        return Err("波形画像の生成に失敗しました".to_string());
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
    validate_media_path(&video_path)?;
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

/// 音声ファイルの波形画像を強制的に生成する (アルバムアートをスキップ)。
#[tauri::command]
pub async fn generate_waveform(
    app_settings: tauri::State<'_, SharedAppSettings>,
    audio_path: String,
    output_path: String,
) -> Result<String, String> {
    validate_media_path(&audio_path)?;
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

    let wave_filter = "color=c=#1f2937:s=320x180,format=rgb24[bg];\
                       showwavespic=s=320x180:colors=#4ade80:scale=sqrt[wv];\
                       [bg][wv]overlay";
    let status = tokio::process::Command::new(&ffmpeg_path)
        .args([
            "-y", "-i", &audio_path,
            "-filter_complex", wave_filter,
            "-frames:v", "1", "-q:v", "80",
            &output_path,
        ])
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status()
        .await
        .map_err(|e| e.to_string())?;

    if status.success() && tokio::fs::metadata(&output_path).await.map(|m| m.len() > 0).unwrap_or(false) {
        Ok(output_path)
    } else {
        Err("波形画像の生成に失敗しました".to_string())
    }
}

/// ファイルサイズをバイト単位で返す。
#[tauri::command]
pub async fn get_file_size(path: String) -> Result<u64, String> {
    validate_path(&path)?;
    tokio::task::spawn_blocking(move || {
        fs::metadata(&path)
            .map(|m| m.len())
            .map_err(|e| format!("ファイルサイズ取得失敗: {e}"))
    })
    .await
    .map_err(|e| e.to_string())?
}

/// 複数ファイルのサイズをバッチで返す。パスが不正な場合または存在しない場合は None。
#[tauri::command]
pub async fn get_file_sizes(paths: Vec<String>) -> Result<Vec<Option<u64>>, String> {
    tokio::task::spawn_blocking(move || {
        paths
            .iter()
            .map(|p| {
                validate_path(p)
                    .ok()
                    .and_then(|_| fs::metadata(p).ok())
                    .map(|m| m.len())
            })
            .collect()
    })
    .await
    .map_err(|e| e.to_string())
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
    validate_media_path(&path)?;
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
/// ライブラリに登録されていないパスへの削除を防ぐため、DB に存在することを事前に確認する。
#[tauri::command]
pub async fn delete_video_file(
    db_state: tauri::State<'_, DbState>,
    path: String,
) -> Result<(), String> {
    validate_media_path(&path)?;
    {
        let conn = db_state.conn()?;
        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM videos WHERE path = ?1", [&path], |r| r.get(0))
            .map_err(|e| format!("DB照会失敗: {e}"))?;
        if count == 0 {
            return Err(format!(
                "ライブラリに登録されていないファイルは削除できません: {path}"
            ));
        }
    }
    tokio::task::spawn_blocking(move || match fs::remove_file(&path) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(format!("ファイル削除失敗: {e}")),
    })
    .await
    .map_err(|e| e.to_string())?
}

/// 動画ファイルを指定ディレクトリへ移動し、新しいパスを返す。
/// 移動先に同名ファイルが存在する場合は連番サフィックスを付与する。
#[tauri::command]
pub async fn move_video_file(source_path: String, dest_dir: String) -> Result<String, String> {
    // パス検証
    validate_media_path(&source_path)?;
    validate_path(&dest_dir)?;

    let source = std::path::Path::new(&source_path);

    // シンボリックリンクはセキュリティリスクのため拒否する
    let src_meta = source
        .symlink_metadata()
        .map_err(|e| format!("元ファイルのメタデータ取得失敗: {e}"))?;
    if src_meta.file_type().is_symlink() {
        return Err("シンボリックリンクは操作できません".to_string());
    }
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
    let dest_path = resolve_unique_path(&dest_base.join(&*filename_str));

    // 最終的な移動先が dest_base の配下にあることを確認 (パストラバーサル対策)
    if let Ok(canon_base) = dest_base.canonicalize() {
        let check_parent = dest_path.parent().unwrap_or(&dest_path);
        let canon_parent = check_parent.canonicalize().unwrap_or_else(|_| check_parent.to_path_buf());
        if !canon_parent.starts_with(&canon_base) {
            return Err("移動先がディレクトリ外です".to_string());
        }
    }

    tokio::fs::create_dir_all(&dest_dir).await.map_err(|e| e.to_string())?;

    // dest_path をアトミックに確保する (TOCTOU 防止 & 既存ファイル上書き防止)
    // resolve_unique_path と rename/copy の間に別プロセスがファイルを作成しても
    // AlreadyExists エラーで即時終了し、既存ファイルを絶対に上書きしない。
    let placeholder = tokio::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&dest_path)
        .await
        .map_err(|e| {
            if e.kind() == std::io::ErrorKind::AlreadyExists {
                format!("移動先に同名ファイルが既に存在します: {}", dest_path.display())
            } else {
                e.to_string()
            }
        })?;

    // rename を試みる (同一デバイス): プレースホルダーをアトミックに置換する
    if tokio::fs::rename(&source, &dest_path).await.is_ok() {
        // rename 成功: placeholder fd は置換済みの旧 inode を指す (drop で OS が解放)
        drop(placeholder);
        let canonical_dest = tokio::fs::canonicalize(&dest_path)
            .await
            .map_err(|e| format!("移動先の正規化失敗: {e}"))?;
        if let Ok(canon_base) = dest_base.canonicalize() {
            if !canonical_dest.starts_with(&canon_base) {
                log::error!("[move_video_file] rename 後に移動先がディレクトリ外と判明: {:?}", canonical_dest);
                return Err("移動先がディレクトリ外に解決されました".to_string());
            }
        }
        return Ok(normalize_path_str(&canonical_dest.to_string_lossy()));
    }

    // rename 失敗 (クロスデバイス) → placeholder fd を保持したまま直接書き込む
    // fd を保持し続けることで dest_path の専有を維持し TOCTOU を排除する
    {
        let src_size = tokio::fs::metadata(&source)
            .await
            .map_err(|e| format!("元ファイルのメタデータ取得失敗: {e}"))?
            .len();
        let mut src_file = tokio::fs::File::open(&source)
            .await
            .map_err(|e| format!("元ファイルのオープン失敗: {e}"))?;
        let mut dest_file = placeholder;
        if let Err(e) = tokio::io::copy(&mut src_file, &mut dest_file).await {
            drop(dest_file);
            let _ = tokio::fs::remove_file(&dest_path).await;
            return Err(format!("クロスデバイスコピー失敗: {e}"));
        }
        drop(dest_file);
        let dst_size = tokio::fs::metadata(&dest_path)
            .await
            .map_err(|e| format!("コピー先のメタデータ取得失敗: {e}"))?
            .len();
        if src_size != dst_size {
            let _ = tokio::fs::remove_file(&dest_path).await;
            return Err(
                "クロスデバイス移動でコピーが不完全でした。元ファイルは保持されています。"
                    .to_string(),
            );
        }
        // コピー後: symlink 置換 TOCTOU でコピー先がディレクトリ外に逸脱していないか再確認
        let canonical_dest = tokio::fs::canonicalize(&dest_path)
            .await
            .map_err(|e| format!("コピー先の正規化失敗: {e}"))?;
        if let Ok(canon_base) = dest_base.canonicalize() {
            if !canonical_dest.starts_with(&canon_base) {
                let _ = tokio::fs::remove_file(&dest_path).await;
                return Err("移動先がディレクトリ外に解決されました".to_string());
            }
        }
        tokio::fs::remove_file(&source)
            .await
            .map_err(|e| format!("元ファイルの削除失敗 (コピー先にデータは存在します): {e}"))?;
        return Ok(normalize_path_str(&canonical_dest.to_string_lossy()));
    }
}

/// 動画ファイルを指定ディレクトリへコピーし、新しいパスを返す。
/// コピー先に同名ファイルが存在する場合は連番サフィックスを付与する。
#[tauri::command]
pub async fn copy_video_file(source_path: String, dest_dir: String) -> Result<String, String> {
    // パス検証
    validate_media_path(&source_path)?;
    validate_path(&dest_dir)?;

    let source = std::path::Path::new(&source_path);

    // シンボリックリンクはセキュリティリスクのため拒否する
    let src_meta = source
        .symlink_metadata()
        .map_err(|e| format!("元ファイルのメタデータ取得失敗: {e}"))?;
    if src_meta.file_type().is_symlink() {
        return Err("シンボリックリンクは操作できません".to_string());
    }

    let filename = source
        .file_name()
        .ok_or_else(|| "invalid filename".to_string())?;

    // ファイル名にパス区切り文字・NULL バイトが含まれていないことを確認 (パストラバーサル対策)
    let filename_str = filename.to_string_lossy();
    if filename_str.contains('/') || filename_str.contains('\\') || filename_str.contains('\0') {
        return Err("ファイル名にパス区切り文字が含まれています".to_string());
    }

    let dest_base = std::path::Path::new(&dest_dir);
    let dest_path = resolve_unique_path(&dest_base.join(&*filename_str));

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

    // dest_path をアトミックに確保する (TOCTOU 防止 & 既存ファイル上書き防止)
    // resolve_unique_path と copy の間に別プロセスがファイルを作成しても
    // AlreadyExists エラーで即時終了し、既存ファイルを絶対に上書きしない。
    let mut dest_file = tokio::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&dest_path)
        .await
        .map_err(|e| {
            if e.kind() == std::io::ErrorKind::AlreadyExists {
                format!("コピー先に同名ファイルが既に存在します: {}", dest_path.display())
            } else {
                e.to_string()
            }
        })?;

    // placeholder fd を保持したまま書き込む (fd 保持中は dest_path を専有)
    let mut src_file = tokio::fs::File::open(&source)
        .await
        .map_err(|e| e.to_string())?;
    if let Err(e) = tokio::io::copy(&mut src_file, &mut dest_file).await {
        drop(dest_file);
        let _ = tokio::fs::remove_file(&dest_path).await;
        return Err(e.to_string());
    }
    drop(dest_file);

    // コピー後に正規化し、symlink 置換 TOCTOU でコピー先がディレクトリ外に逸脱していないか再確認
    let canonical = tokio::fs::canonicalize(&dest_path)
        .await
        .map_err(|e| format!("コピー先の正規化失敗: {e}"))?;
    if let Ok(canon_base) = dest_base.canonicalize() {
        if !canonical.starts_with(&canon_base) {
            let _ = tokio::fs::remove_file(&dest_path).await;
            return Err("コピー先がディレクトリ外に解決されました".to_string());
        }
    }
    Ok(normalize_path_str(&canonical.to_string_lossy()))
}

/// 複数の動画ファイルを一括削除する。各ファイルの削除成否を (path, success) の配列で返す。
/// ライブラリに登録されているパスのみ削除を許可する。
#[tauri::command]
pub async fn delete_multiple_video_files(
    db_state: tauri::State<'_, DbState>,
    paths: Vec<String>,
) -> Result<Vec<(String, bool)>, String> {
    if paths.is_empty() {
        return Ok(vec![]);
    }
    // DB に登録済みのパスを一括照会して許可リストを作成する
    let registered: std::collections::HashSet<String> = {
        let conn = db_state.conn()?;
        let mut set = std::collections::HashSet::new();
        for chunk in paths.chunks(400) {
            let ph = chunk.iter().map(|_| "?").collect::<Vec<_>>().join(", ");
            let params: Vec<rusqlite::types::Value> =
                chunk.iter().map(|p| rusqlite::types::Value::Text(p.clone())).collect();
            let mut stmt = conn
                .prepare(&format!("SELECT path FROM videos WHERE path IN ({ph})"))
                .map_err(|e| e.to_string())?;
            let iter = stmt
                .query_map(rusqlite::params_from_iter(params.iter()), |r| {
                    r.get::<_, String>(0)
                })
                .map_err(|e| e.to_string())?;
            for p in iter {
                set.insert(p.map_err(|e| e.to_string())?);
            }
        }
        set
    };
    let results = paths
        .into_iter()
        .map(|path| {
            // パス検証失敗または DB 未登録の場合は削除せず false を返す
            if validate_media_path(&path).is_err() || !registered.contains(&path) {
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
/// ライブラリに登録されていないパスへの操作を防ぐため、DB に存在することを事前に確認する。
#[tauri::command]
pub async fn trash_video_file(
    db_state: tauri::State<'_, DbState>,
    path: String,
) -> Result<(), String> {
    validate_media_path(&path)?;
    {
        let conn = db_state.conn()?;
        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM videos WHERE path = ?1", [&path], |r| r.get(0))
            .map_err(|e| format!("DB照会失敗: {e}"))?;
        if count == 0 {
            return Err(format!(
                "ライブラリに登録されていないファイルはゴミ箱に移動できません: {path}"
            ));
        }
    }
    tokio::task::spawn_blocking(move || {
        trash::delete(&path).map_err(|e| format!("ゴミ箱への移動に失敗しました: {e}"))
    })
    .await
    .map_err(|e| e.to_string())?
}

/// 複数の動画ファイルを OS のゴミ箱に移動する。
/// 各ファイルの成否を (path, success) の配列で返す。
/// ライブラリに登録されているパスのみ操作を許可する。
#[tauri::command]
pub async fn trash_multiple_video_files(
    db_state: tauri::State<'_, DbState>,
    paths: Vec<String>,
) -> Result<Vec<(String, bool)>, String> {
    if paths.is_empty() {
        return Ok(vec![]);
    }
    // DB に登録済みのパスを一括照会して許可リストを作成する (spawn_blocking に渡す前に確認)
    let registered: std::collections::HashSet<String> = {
        let conn = db_state.conn()?;
        let mut set = std::collections::HashSet::new();
        for chunk in paths.chunks(400) {
            let ph = chunk.iter().map(|_| "?").collect::<Vec<_>>().join(", ");
            let params: Vec<rusqlite::types::Value> =
                chunk.iter().map(|p| rusqlite::types::Value::Text(p.clone())).collect();
            let mut stmt = conn
                .prepare(&format!("SELECT path FROM videos WHERE path IN ({ph})"))
                .map_err(|e| e.to_string())?;
            let iter = stmt
                .query_map(rusqlite::params_from_iter(params.iter()), |r| {
                    r.get::<_, String>(0)
                })
                .map_err(|e| e.to_string())?;
            for p in iter {
                set.insert(p.map_err(|e| e.to_string())?);
            }
        }
        set
    };
    tokio::task::spawn_blocking(move || {
        paths
            .into_iter()
            .map(|path| {
                // パス検証失敗または DB 未登録の場合はゴミ箱移動せず false を返す
                if validate_media_path(&path).is_err() || !registered.contains(&path) {
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
    validate_text_path(&path)?;
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
    validate_text_path(&path)?;
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

    // create_new で排他的にプレースホルダーを作成し、new_path の「予約」を確保する。
    // プレースホルダーを保持したまま rename を呼び出すことで、
    // 「delete → rename」間に外部プロセスがファイルを作成できる TOCTOU ウィンドウを排除する。
    // rename は new_path (= プレースホルダー) をアトミックに入力ファイルの内容で置き換える。
    // rename 後、_placeholder の fd は unlink 済みの空 inode を指し、
    // スコープ終了時に OS が自動解放する。
    match tokio::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&new_path)
        .await
    {
        Ok(_placeholder) => {
            // プレースホルダーを保持したまま rename を実行する。
            // rename が失敗した場合はプレースホルダーを除去して元の状態に戻す。
            if let Err(e) = tokio::fs::rename(&old, &new_path).await {
                let _ = tokio::fs::remove_file(&new_path).await;
                return Err(e.to_string());
            }
        }
        Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {
            return Err(format!("同名のファイルがすでに存在します: {}", trimmed));
        }
        Err(e) => return Err(e.to_string()),
    }

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

/// Sync モード用: watchDir のルート直下にある動画ファイルを Inbox サブフォルダへ移動する。
///
/// 安全設計:
///   - DB に登録された動画のみを対象とする (不審なファイルは移動しない)
///   - 物理ファイルが存在する場合のみ移動 (存在しない DB エントリはスキップ)
///   - アトミックなプレースホルダーで宛先の上書きを防止 (既存ファイルを絶対に上書きしない)
///   - rename/コピー成功後にのみ DB パスを更新 (ファイルが移動していない状態で DB を壊さない)
///   - クロスデバイス移動はコピー+サイズ検証+削除の順 (コピー失敗時は元ファイルを保持)
///   - エラーが起きても残りのファイルを継続処理し、エラー一覧を返す
#[derive(Serialize)]
pub struct MigrateRootResult {
    pub moved: usize,
    pub skipped: usize,
    pub errors: Vec<String>,
}

#[tauri::command]
pub async fn migrate_root_files_to_inbox(
    db_state: tauri::State<'_, DbState>,
    watch_dir: String,
) -> Result<MigrateRootResult, String> {
    validate_path(&watch_dir)?;

    // watchDir がディレクトリとして存在しない場合は何もしない
    if !Path::new(&watch_dir).is_dir() {
        return Ok(MigrateRootResult { moved: 0, skipped: 0, errors: vec![] });
    }

    let inbox_dir = Path::new(&watch_dir).join("Unsorted");

    // ── Step 1: DB からルート直下の動画を取得 (conn はブロック内でのみ保持) ──
    let root_videos: Vec<(i64, String)> = {
        let conn = db_state.conn()?;
        let escaped = crate::commands::db_videos::escape_like_dir(&watch_dir);
        let pattern_all    = format!("{escaped}/%");
        let pattern_subdir = format!("{escaped}/%/%");
        let sql = "SELECT id, path FROM videos \
                   WHERE REPLACE(path, '\\', '/') LIKE ? ESCAPE '!' \
                   AND   REPLACE(path, '\\', '/') NOT LIKE ? ESCAPE '!'";
        let mut stmt = conn.prepare(sql).map_err(|e| e.to_string())?;
        let rows: Vec<(i64, String)> = stmt.query_map([&pattern_all, &pattern_subdir], |r| {
            Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?))
        })
        .map_err(|e| e.to_string())?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(|e| e.to_string())?;
        rows
    }; // conn を即座に解放

    if root_videos.is_empty() {
        return Ok(MigrateRootResult { moved: 0, skipped: 0, errors: vec![] });
    }

    // ── Step 2: Rust 側で正確なプレフィックス照合 ──
    // LIKE は '/Videos2' も '/Videos/' として扱うため、Rust で厳密にフィルタリングする
    let norm_watch = watch_dir.replace('\\', "/");
    let norm_watch = norm_watch.trim_end_matches('/');
    let prefix = format!("{norm_watch}/");
    let root_videos: Vec<(i64, String)> = root_videos
        .into_iter()
        .filter(|(_, path)| {
            let norm = path.replace('\\', "/");
            match norm.strip_prefix(prefix.as_str()) {
                Some(after) => !after.contains('/'), // ルート直下のみ (サブディレクトリを除外)
                None => false,
            }
        })
        .collect();

    if root_videos.is_empty() {
        return Ok(MigrateRootResult { moved: 0, skipped: 0, errors: vec![] });
    }

    // ── Step 3: Unsorted ディレクトリを作成 ──
    tokio::fs::create_dir_all(&inbox_dir)
        .await
        .map_err(|e| format!("Unsorted ディレクトリの作成に失敗: {e}"))?;

    let mut moved = 0usize;
    let mut skipped = 0usize;
    let mut errors: Vec<String> = Vec::new();

    // ── Step 4: ファイルを 1 件ずつ移動・DB 更新 ──
    for (video_id, old_path) in &root_videos {
        let source = Path::new(old_path);

        // 物理ファイルが存在しない場合はスキップ (rescan で DB から削除される)
        if !source.exists() {
            skipped += 1;
            continue;
        }

        let filename = match source.file_name() {
            Some(f) => f.to_string_lossy().into_owned(),
            None => {
                errors.push(format!("無効なファイル名: {old_path}"));
                continue;
            }
        };

        // パス区切り文字・NULL バイトの混入を確認 (パストラバーサル対策)
        if filename.contains('/') || filename.contains('\\') || filename.contains('\0') {
            errors.push(format!("ファイル名に不正な文字が含まれています: {old_path}"));
            continue;
        }

        let dest_path = resolve_unique_path(&inbox_dir.join(&filename));

        // ── アトミックなプレースホルダーを確保 (宛先の上書きを防止) ──
        let placeholder = match tokio::fs::OpenOptions::new()
            .write(true)
            .create_new(true) // 既存ファイルがあれば即エラー: 絶対に上書きしない
            .open(&dest_path)
            .await
        {
            Ok(f) => f,
            Err(e) => {
                let msg = if e.kind() == std::io::ErrorKind::AlreadyExists {
                    format!("移動先に同名ファイルが既に存在します: {}", dest_path.display())
                } else {
                    format!("移動先ファイルの確保に失敗 ({old_path}): {e}")
                };
                errors.push(msg);
                continue;
            }
        };

        // ── rename を試みる (同一デバイスなら高速・アトミック) ──
        let new_path: String = if tokio::fs::rename(source, &dest_path).await.is_ok() {
            drop(placeholder); // rename 成功: placeholder の inode は置換済み
            match tokio::fs::canonicalize(&dest_path).await {
                Ok(p) => normalize_path_str(&p.to_string_lossy()),
                Err(e) => {
                    errors.push(format!("移動後パスの正規化失敗 ({old_path}): {e}"));
                    continue;
                }
            }
        } else {
            // ── クロスデバイス移動: コピー → サイズ検証 → 元ファイル削除 ──
            let src_size = match tokio::fs::metadata(source).await {
                Ok(m) => m.len(),
                Err(e) => {
                    drop(placeholder);
                    let _ = tokio::fs::remove_file(&dest_path).await;
                    errors.push(format!("元ファイルのメタデータ取得失敗 ({old_path}): {e}"));
                    continue;
                }
            };

            let mut src_file = match tokio::fs::File::open(source).await {
                Ok(f) => f,
                Err(e) => {
                    drop(placeholder);
                    let _ = tokio::fs::remove_file(&dest_path).await;
                    errors.push(format!("元ファイルのオープン失敗 ({old_path}): {e}"));
                    continue;
                }
            };

            let mut dest_file = placeholder;
            if let Err(e) = tokio::io::copy(&mut src_file, &mut dest_file).await {
                drop(dest_file);
                let _ = tokio::fs::remove_file(&dest_path).await;
                errors.push(format!("コピー失敗。元ファイルは保持されています ({old_path}): {e}"));
                continue;
            }
            drop(dest_file);

            // コピーサイズを検証 (不完全なコピーを検出し元ファイルを保護)
            let dst_size = match tokio::fs::metadata(&dest_path).await {
                Ok(m) => m.len(),
                Err(e) => {
                    let _ = tokio::fs::remove_file(&dest_path).await;
                    errors.push(format!("コピー先のサイズ確認失敗 ({old_path}): {e}"));
                    continue;
                }
            };
            if src_size != dst_size {
                let _ = tokio::fs::remove_file(&dest_path).await;
                errors.push(format!(
                    "コピーが不完全です。元ファイルは保持されています: {old_path}"
                ));
                continue;
            }

            let canonical_dest = match tokio::fs::canonicalize(&dest_path).await {
                Ok(p) => normalize_path_str(&p.to_string_lossy()),
                Err(e) => {
                    let _ = tokio::fs::remove_file(&dest_path).await;
                    errors.push(format!("コピー先の正規化失敗 ({old_path}): {e}"));
                    continue;
                }
            };

            // コピー成功・サイズ一致確認後にのみ元ファイルを削除
            if let Err(e) = tokio::fs::remove_file(source).await {
                // 削除失敗: コピー先にデータは存在するが元ファイルが残る
                // DB は新パスに更新して続行 (元ファイルの手動削除が必要)
                errors.push(format!(
                    "元ファイルの削除に失敗しました (コピー先にデータは存在します。手動で削除してください: {old_path}): {e}"
                ));
            }

            canonical_dest
        };

        // ── ファイル移動成功後にのみ DB パスを更新 ──
        {
            let conn = db_state.conn()?;
            if let Err(e) = conn.execute(
                "UPDATE videos SET path = ?1 WHERE id = ?2",
                rusqlite::params![new_path, video_id],
            ) {
                errors.push(format!(
                    "DB 更新失敗 (ファイルは移動済みです。再スキャンで修正できます → {new_path}): {e}"
                ));
            }
        } // conn を即座に解放

        moved += 1;
    }

    Ok(MigrateRootResult { moved, skipped, errors })
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
/// アプリのキャッシュディレクトリ内であることを canonicalize で検証してから実行する。
#[tauri::command]
pub async fn cleanup_jpg_thumbnails(
    app: tauri::AppHandle,
    thumbs_dir: String,
) -> Result<u32, String> {
    use tauri::Manager;
    validate_path(&thumbs_dir)?;

    let base = std::path::Path::new(&thumbs_dir);
    if !base.exists() {
        return Ok(0);
    }

    // アプリのキャッシュディレクトリ内に収まっていることを確認
    let app_cache = app.path().app_cache_dir().map_err(|e| e.to_string())?;
    let canon_cache = app_cache.canonicalize().unwrap_or(app_cache);
    let canon_base = base
        .canonicalize()
        .map_err(|_| "サムネイルディレクトリが存在しません".to_string())?;
    if !canon_base.starts_with(&canon_cache) {
        return Err(
            "アプリのキャッシュディレクトリ外のパスは指定できません".to_string(),
        );
    }

    let mut count = 0u32;
    for entry in WalkDir::new(base).into_iter().filter_map(|e| e.ok()) {
        let path = entry.path();
        if path
            .extension()
            .and_then(|e| e.to_str())
            .map(|e| e.eq_ignore_ascii_case("jpg"))
            .unwrap_or(false)
        {
            let _ = tokio::fs::remove_file(path).await;
            count += 1;
        }
    }
    Ok(count)
}

#[cfg(test)]
mod scan_dir_core_tests {
    use super::*;

    /// テストごとに一意な一時ディレクトリを作成し、テスト終了時に自動削除する。
    struct TempDir(std::path::PathBuf);
    impl TempDir {
        fn new(name: &str) -> Self {
            let dir = std::env::temp_dir().join(format!(
                "chuck-snap-stack-test-{name}-{}-{}",
                std::process::id(),
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap()
                    .as_nanos()
            ));
            fs::create_dir_all(&dir).unwrap();
            TempDir(dir)
        }
    }
    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn scan_dir_core_normalizes_nfd_filename_to_nfc() {
        let dir = TempDir::new("nfd");
        // NFD 分解形 (か + 濁点結合文字) のファイル名で作成する
        let nfd_name = "\u{304B}\u{3099}.mp4";
        fs::write(dir.0.join(nfd_name), b"dummy").unwrap();

        let result = scan_dir_core(dir.0.to_str().unwrap());

        assert_eq!(result.files.len(), 1);
        let nfc_title = "\u{304C}"; // NFC 合成形 (が)
        assert_eq!(result.files[0].title, nfc_title);
        assert!(
            result.files[0].path.ends_with(&format!("{nfc_title}.mp4")),
            "path should end with NFC-normalized filename, got: {}",
            result.files[0].path
        );
    }

    #[test]
    fn scan_dir_core_finds_ascii_video_file() {
        let dir = TempDir::new("ascii");
        fs::write(dir.0.join("video.mp4"), b"dummy").unwrap();

        let result = scan_dir_core(dir.0.to_str().unwrap());

        assert_eq!(result.files.len(), 1);
        assert_eq!(result.files[0].title, "video");
        assert_eq!(result.files[0].media_type, "video");
    }

    #[test]
    fn scan_dir_core_skips_unsupported_extension() {
        let dir = TempDir::new("skip");
        fs::write(dir.0.join("notes.txt"), b"dummy").unwrap();

        let result = scan_dir_core(dir.0.to_str().unwrap());

        assert_eq!(result.files.len(), 0);
        assert_eq!(result.skipped_count, 1);
    }
}
