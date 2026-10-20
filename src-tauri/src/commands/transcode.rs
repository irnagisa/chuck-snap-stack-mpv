use std::io::{BufRead, BufReader};
use std::path::Path;
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use serde::Serialize;
use tauri::Emitter;
use tauri_plugin_notification::NotificationExt;

use super::settings::SharedAppSettings;
use super::utils::{normalize_path_str, resolve_unique_path, validate_video_path};
use crate::db::DbState;

#[derive(Clone, Serialize)]
pub struct TranscodeProgress {
    pub percent: f64,
    pub speed: String,
    pub elapsed_secs: f64,
    pub frames: u64,
    pub fps: f64,
    pub total_size_bytes: u64,
}

/// 元ファイルの同一性確認用フィンガープリント (サイズ + 更新日時)
#[derive(Clone, PartialEq, Debug)]
struct FileFingerprint {
    len: u64,
    modified: Option<std::time::SystemTime>,
}

impl FileFingerprint {
    fn of(path: &Path) -> Result<Self, String> {
        let meta = std::fs::metadata(path).map_err(|e| format!("ファイル情報の取得に失敗しました: {e}"))?;
        if !meta.is_file() {
            return Err(format!("通常ファイルではありません: {}", path.display()));
        }
        Ok(Self { len: meta.len(), modified: meta.modified().ok() })
    }
}

/// 直近に成功したトランスコードの記録。
/// `trash_transcode_source` はこの記録と一致する元ファイルしかゴミ箱へ移動しない。
struct CompletedTranscode {
    input_path: String,
    output_path: String,
    input_fingerprint: FileFingerprint,
}

pub struct TranscodeState {
    cancel_flag: Arc<AtomicBool>,
    current_output: Arc<Mutex<Option<String>>>,
    /// 実行中の ffmpeg プロセス。アプリ終了時に kill するため共有する
    current_child: Arc<Mutex<Option<Child>>>,
    last_completed: Mutex<Option<CompletedTranscode>>,
}

impl TranscodeState {
    pub fn new() -> Self {
        Self {
            cancel_flag: Arc::new(AtomicBool::new(false)),
            current_output: Arc::new(Mutex::new(None)),
            current_child: Arc::new(Mutex::new(None)),
            last_completed: Mutex::new(None),
        }
    }
}

#[tauri::command]
pub async fn transcode_video(
    app: tauri::AppHandle,
    state: tauri::State<'_, TranscodeState>,
    app_settings: tauri::State<'_, SharedAppSettings>,
    input_path: String,
    duration_secs: f64,
    crf: u32,
    preset: u32,
) -> Result<String, String> {
    state.cancel_flag.store(false, Ordering::SeqCst);
    // 前回の完了記録は新しい変換の開始時点で無効化する
    if let Ok(mut last) = state.last_completed.lock() {
        *last = None;
    }

    let ffmpeg_path = {
        let s = app_settings.lock().map_err(|e| e.to_string())?;
        s.ffmpeg_path.clone()
    };

    // 入力パスの検証 (絶対パス + `..` なし + 動画拡張子)
    let input = validate_video_path(&input_path)?;
    let stem = input
        .file_stem()
        .and_then(|s| s.to_str())
        .ok_or_else(|| "ファイル名が取得できません".to_string())?;
    let dir = input
        .parent()
        .ok_or_else(|| "入力ファイルの親ディレクトリが取得できません".to_string())?;
    // 同名の出力ファイルが存在する場合は連番サフィックスで一意化する (上書き防止)
    let output_path = resolve_unique_path(&dir.join(format!("{stem}.av1.mkv")));
    // 一時出力ファイルは確定した output_path から派生させる
    let out_filename = output_path
        .file_name()
        .map(|n| format!("._{}", n.to_string_lossy()))
        .unwrap_or_else(|| format!("._{stem}.av1.mkv"));
    let tmp_output_path = dir.join(format!("{out_filename}.tmp"));

    // 出力パスが入力と同一ディレクトリ内にあることを確認
    if let Ok(canon_dir) = dir.canonicalize() {
        let out_parent = output_path.parent().unwrap_or(dir);
        let canon_out = out_parent.canonicalize().unwrap_or_else(|_| out_parent.to_path_buf());
        if canon_dir != canon_out {
            return Err("トランスコード出力先はソースと同じディレクトリである必要があります".to_string());
        }
    }

    // 変換開始時点の元ファイルの状態を記録 (元ファイル削除オプションの安全確認に使う)
    let input_fingerprint = {
        let input = input.clone();
        tokio::task::spawn_blocking(move || FileFingerprint::of(&input))
            .await
            .map_err(|e| e.to_string())??
    };

    let output_str = output_path.to_string_lossy().to_string();
    let tmp_output_str = tmp_output_path.to_string_lossy().to_string();

    {
        let mut p = state.current_output.lock().map_err(|e| e.to_string())?;
        *p = Some(tmp_output_str.clone());
    }

    let cancel_flag = state.cancel_flag.clone();
    let current_output = state.current_output.clone();
    let current_child = state.current_child.clone();

    let result = tokio::task::spawn_blocking({
        let app = app.clone();
        let input_path = input_path.clone();
        let output_str = output_str.clone();
        let tmp_output_str = tmp_output_str.clone();
        let dir_for_check = dir.to_path_buf();
        move || -> Result<(), String> {
            // TOCTOU 対策: ffmpeg 起動直前にディレクトリを再検証する
            if let Ok(canon_dir) = dir_for_check.canonicalize() {
                let out_parent = std::path::Path::new(&tmp_output_str)
                    .parent()
                    .unwrap_or(&dir_for_check);
                let canon_out = out_parent
                    .canonicalize()
                    .unwrap_or_else(|_| out_parent.to_path_buf());
                if canon_dir != canon_out {
                    return Err(
                        "トランスコード出力先はソースと同じディレクトリである必要があります"
                            .to_string(),
                    );
                }
            }

            if cancel_flag.load(Ordering::SeqCst) {
                return Err("キャンセルされました".to_string());
            }

            // 一時ファイルが既に存在する場合は削除
            let _ = std::fs::remove_file(&tmp_output_str);

            let mut child = Command::new(&ffmpeg_path)
                .args([
                    "-y",
                    "-progress", "pipe:1",
                    "-nostats",
                    "-i", &input_path,
                    "-c:v", "libsvtav1",
                    "-crf", &crf.to_string(),
                    "-preset", &preset.to_string(),
                    "-c:a", "libopus",
                    "-b:a", "128k",
                    "-f", "matroska",
                    &tmp_output_str,
                ])
                .stdout(Stdio::piped())
                .stderr(Stdio::piped())
                .spawn()
                .map_err(|e| format!("FFmpeg 起動失敗: {e}"))?;

            let stdout = match child.stdout.take() {
                Some(s) => s,
                None => {
                    child.kill().ok();
                    child.wait().ok();
                    return Err("ffmpeg stdout の取得に失敗しました".to_string());
                }
            };
            let stderr = match child.stderr.take() {
                Some(s) => s,
                None => {
                    child.kill().ok();
                    child.wait().ok();
                    return Err("ffmpeg stderr の取得に失敗しました".to_string());
                }
            };
            let stderr_handle = std::thread::spawn(move || {
                use std::io::Read;
                let mut s = String::new();
                BufReader::new(stderr).read_to_string(&mut s).ok();
                s
            });
            let reader = BufReader::new(stdout);
            if let Ok(mut slot) = current_child.lock() {
                *slot = Some(child);
            } else {
                child.kill().ok();
                child.wait().ok();
                return Err("ffmpeg プロセスの登録に失敗しました".to_string());
            }

            let start = std::time::Instant::now();
            let mut out_time_us: u64 = 0;
            let mut speed = "N/A".to_string();
            let mut frames: u64 = 0;
            let mut fps: f64 = 0.0;
            let mut total_size_bytes: u64 = 0;

            for line in reader.lines() {
                if cancel_flag.load(Ordering::SeqCst) {
                    if let Some(mut child) = take_child(&current_child) {
                        child.kill().ok();
                        child.wait().ok();
                    }
                    let _ = std::fs::remove_file(&tmp_output_str);
                    return Err("キャンセルされました".to_string());
                }

                let line = match line {
                    Ok(l) => l,
                    Err(e) => {
                        if let Some(mut child) = take_child(&current_child) {
                            child.kill().ok();
                            child.wait().ok();
                        }
                        let _ = std::fs::remove_file(&tmp_output_str);
                        return Err(e.to_string());
                    }
                };

                if let Some(val) = line.strip_prefix("out_time_us=") {
                    out_time_us = val.trim().parse().unwrap_or(0);
                } else if let Some(val) = line.strip_prefix("speed=") {
                    speed = val.trim().to_string();
                } else if let Some(val) = line.strip_prefix("frame=") {
                    frames = val.trim().parse().unwrap_or(0);
                } else if let Some(val) = line.strip_prefix("fps=") {
                    fps = val.trim().parse().unwrap_or(0.0);
                } else if let Some(val) = line.strip_prefix("total_size=") {
                    total_size_bytes = val.trim().parse().unwrap_or(0);
                } else if line.starts_with("progress=") {
                    let percent = if duration_secs > 0.0 && out_time_us > 0 {
                        ((out_time_us as f64 / 1_000_000.0) / duration_secs * 100.0).min(99.9)
                    } else {
                        0.0
                    };
                    let _ = app.emit(
                        "transcode://progress",
                        TranscodeProgress {
                            percent,
                            speed: speed.clone(),
                            elapsed_secs: start.elapsed().as_secs_f64(),
                            frames,
                            fps,
                            total_size_bytes,
                        },
                    );
                }
            }

            // child が取り出し済みならアプリ終了処理 (kill_on_exit) で kill されている
            let Some(mut child) = take_child(&current_child) else {
                return Err("アプリ終了により中断されました".to_string());
            };
            let status = child.wait().map_err(|e| e.to_string())?;
            let stderr_output = match stderr_handle.join() {
                Ok(s) => s,
                Err(_) => {
                    log::warn!("[transcode] stderr スレッドがパニックしました (出力を取得できません)");
                    String::new()
                }
            };
            if !status.success() {
                let _ = std::fs::remove_file(&tmp_output_str);
                let detail = if stderr_output.trim().is_empty() {
                    String::new()
                } else {
                    format!("\n{}", stderr_output.trim())
                };
                return Err(format!(
                    "FFmpeg がエラーで終了しました (code: {:?}){detail}",
                    status.code()
                ));
            }
            // アトミックリネーム: 完成した一時ファイルを最終パスへ移動
            // これにより不完全なファイルが output_str に残らない
            std::fs::rename(&tmp_output_str, &output_str)
                .map_err(|e| format!("出力ファイルの移動に失敗しました: {e}"))?;
            Ok(())
        }
    })
    .await
    .map_err(|e| e.to_string())?;

    match current_output.lock() {
        Ok(mut p) => { *p = None; }
        Err(e) => { log::error!("[transcode] current_output mutex ロック失敗 (クリーンアップ不可): {e}"); }
    }

    result?;

    match state.last_completed.lock() {
        Ok(mut last) => {
            *last = Some(CompletedTranscode {
                input_path: input_path.clone(),
                output_path: output_str.clone(),
                input_fingerprint,
            });
        }
        Err(e) => log::error!("[transcode] last_completed mutex ロック失敗: {e}"),
    }

    let file_name = std::path::Path::new(&output_str)
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| "ファイル".to_string());
    if let Err(e) = app.notification()
        .builder()
        .title("トランスコード完了")
        .body(&format!("{file_name} のトランスコードが完了しました"))
        .show()
    {
        log::warn!("[notification] トランスコード通知の送信に失敗しました: {e}");
    }

    Ok(output_str)
}

fn take_child(slot: &Mutex<Option<Child>>) -> Option<Child> {
    slot.lock().ok().and_then(|mut c| c.take())
}

/// アプリ終了時に実行中の ffmpeg を kill し、変換途中の一時ファイルを削除する。
pub fn kill_on_exit(state: &TranscodeState) {
    state.cancel_flag.store(true, Ordering::SeqCst);
    // child を取り出せなかった場合は ffmpeg 未起動か、正常終了してリネーム処理中なので触らない
    let Some(mut child) = take_child(&state.current_child) else { return };
    let _ = child.kill();
    let _ = child.wait();
    let tmp = state.current_output.lock().ok().and_then(|p| p.clone());
    if let Some(tmp) = tmp {
        if let Err(e) = std::fs::remove_file(&tmp) {
            log::warn!("[transcode] 終了時の一時ファイル削除に失敗しました ({tmp}): {e}");
        }
    }
}

/// 変換途中の一時ファイル名 (`._<名前>.av1[_N].mkv.tmp`) かどうか
fn is_transcode_tmp_name(name: &str) -> bool {
    name.starts_with("._") && name.ends_with(".mkv.tmp") && name.contains(".av1")
}

/// 他プロセス (別インスタンス) が書き込み中の可能性があるため、直近に更新された一時ファイルは残す
const STALE_TMP_MIN_AGE: std::time::Duration = std::time::Duration::from_secs(120);

/// 強制終了・クラッシュで残った一時ファイルを、ライブラリ内メディアのあるディレクトリから削除する。
/// 起動時にバックグラウンドで呼ぶ。戻り値は削除した件数。
pub fn cleanup_stale_tmp_files(db: &DbState, state: &TranscodeState) -> usize {
    let dirs: std::collections::HashSet<std::path::PathBuf> = {
        let Ok(conn) = db.conn_read() else { return 0 };
        let Ok(mut stmt) = conn.prepare("SELECT path FROM videos") else { return 0 };
        stmt.query_map([], |r| r.get::<_, String>(0))
            .map(|rows| {
                rows.filter_map(|r| r.ok())
                    .filter_map(|p| Path::new(&p).parent().map(Path::to_path_buf))
                    .collect()
            })
            .unwrap_or_default()
    };
    let mut removed = 0;
    for dir in dirs {
        let Ok(entries) = std::fs::read_dir(&dir) else { continue };
        for entry in entries.flatten() {
            if !entry.file_name().to_str().is_some_and(is_transcode_tmp_name) {
                continue;
            }
            let Ok(meta) = entry.metadata() else { continue };
            let is_stale = meta.is_file()
                && meta
                    .modified()
                    .ok()
                    .and_then(|m| m.elapsed().ok())
                    .is_some_and(|age| age >= STALE_TMP_MIN_AGE);
            if !is_stale {
                continue;
            }
            let path = entry.path();
            let path_str = path.to_string_lossy();
            // このインスタンスで変換中のファイルは消さない
            let in_use = state
                .current_output
                .lock()
                .map(|p| p.as_deref() == Some(path_str.as_ref()))
                .unwrap_or(true);
            if in_use {
                continue;
            }
            match std::fs::remove_file(&path) {
                Ok(()) => {
                    log::info!("[transcode] 残っていた一時ファイルを削除しました: {path_str}");
                    removed += 1;
                }
                Err(e) => log::warn!("[transcode] 一時ファイルの削除に失敗しました ({path_str}): {e}"),
            }
        }
    }
    removed
}

#[tauri::command]
pub async fn cancel_transcode(state: tauri::State<'_, TranscodeState>) -> Result<(), String> {
    state.cancel_flag.store(true, Ordering::SeqCst);
    Ok(())
}

struct ProbeInfo {
    duration: f64,
    has_video: bool,
    has_audio: bool,
}

/// ffprobe でコンテナの再生時間とストリーム構成を取得する。
async fn probe_media(ffprobe_path: &str, path: &str) -> Result<ProbeInfo, String> {
    let out = tokio::process::Command::new(ffprobe_path)
        .args([
            "-v", "error",
            "-show_entries", "format=duration:stream=codec_type",
            "-of", "json",
            path,
        ])
        .output()
        .await
        .map_err(|e| format!("ffprobe 起動失敗: {e}"))?;
    if !out.status.success() {
        return Err(format!(
            "ffprobe がエラーで終了しました: {}",
            String::from_utf8_lossy(&out.stderr).trim()
        ));
    }
    parse_probe_json(&out.stdout)
}

fn parse_probe_json(bytes: &[u8]) -> Result<ProbeInfo, String> {
    let json: serde_json::Value =
        serde_json::from_slice(bytes).map_err(|e| format!("ffprobe 出力の解析に失敗しました: {e}"))?;
    let duration = json["format"]["duration"]
        .as_str()
        .and_then(|d| d.parse::<f64>().ok())
        .filter(|d| d.is_finite() && *d > 0.0)
        .ok_or_else(|| "再生時間を取得できませんでした".to_string())?;
    let streams = json["streams"].as_array().cloned().unwrap_or_default();
    let has_type = |t: &str| streams.iter().any(|s| s["codec_type"].as_str() == Some(t));
    Ok(ProbeInfo { duration, has_video: has_type("video"), has_audio: has_type("audio") })
}

/// 変換後ファイルが元ファイルの代替として妥当かを判定する。
/// 再生時間の差は max(2 秒, 元の 1%) まで許容する。
fn check_output_matches_source(source: &ProbeInfo, output: &ProbeInfo) -> Result<(), String> {
    if !output.has_video {
        return Err("変換後ファイルに映像ストリームがありません".to_string());
    }
    if source.has_audio && !output.has_audio {
        return Err("変換後ファイルに音声ストリームがありません".to_string());
    }
    let tolerance = (source.duration * 0.01).max(2.0);
    let diff = (source.duration - output.duration).abs();
    if diff > tolerance {
        return Err(format!(
            "再生時間が一致しません (元: {:.1} 秒 / 変換後: {:.1} 秒)",
            source.duration, output.duration
        ));
    }
    Ok(())
}

/// ゴミ箱が使えないボリューム用の退避フォルダ名 (元ファイルと同じディレクトリに作成)
const QUARANTINE_DIR_NAME: &str = ".ChuckSnapStackTrash";
/// 退避ファイルに付ける接尾辞。メディア拡張子でなくすことでスキャン・ウォッチャーの再取り込みを防ぐ
const QUARANTINE_SUFFIX: &str = ".trashed";

#[derive(Serialize)]
#[serde(tag = "method", rename_all = "snake_case")]
pub enum SourceDisposal {
    /// OS のゴミ箱へ移動した
    Trash,
    /// ゴミ箱が使えなかったため退避フォルダへ移動した
    Quarantine { location: String },
}

/// OS のゴミ箱へ移動する。
/// macOS では NSFileManager を使う (Finder 経由の既定方式はオートメーション権限が必要で、
/// 権限未許可時や外部ボリュームで失敗しやすいため)。
fn move_to_os_trash(path: &Path) -> Result<(), String> {
    #[allow(unused_mut)]
    let mut ctx = trash::TrashContext::default();
    #[cfg(target_os = "macos")]
    {
        use trash::macos::{DeleteMethod, TrashContextExtMacos};
        ctx.set_delete_method(DeleteMethod::NsFileManager);
    }
    ctx.delete(path).map_err(|e| e.to_string())
}

/// 退避先パスを決める: `<dir>/.ChuckSnapStackTrash/<ファイル名>.trashed` (重複時は連番)
fn quarantine_path_for(input: &Path) -> Result<std::path::PathBuf, String> {
    let dir = input
        .parent()
        .ok_or_else(|| "元ファイルの親ディレクトリが取得できません".to_string())?;
    let name = input
        .file_name()
        .ok_or_else(|| "ファイル名が取得できません".to_string())?
        .to_string_lossy();
    Ok(resolve_unique_path(
        &dir.join(QUARANTINE_DIR_NAME).join(format!("{name}{QUARANTINE_SUFFIX}")),
    ))
}

/// 元ファイルをゴミ箱へ移動し、ゴミ箱が使えない場合 (外部ストレージ・ネットワークボリューム・
/// 権限不足など) は同じディレクトリ内の退避フォルダへリネームで移動する。
/// どちらも失敗した場合はエラーを返し、元ファイルには一切手を付けない (完全削除は行わない)。
fn dispose_source(input: &Path, expected: &FileFingerprint) -> Result<SourceDisposal, String> {
    let trash_err = match move_to_os_trash(input) {
        Ok(()) => return Ok(SourceDisposal::Trash),
        Err(e) => e,
    };
    log::warn!("[transcode] ゴミ箱への移動に失敗したため退避フォルダを使用します: {trash_err}");

    // ゴミ箱処理が中途半端に作用していないことを確認してから退避する
    match FileFingerprint::of(input) {
        Ok(fp) if fp == *expected => {}
        Ok(_) => {
            return Err("ゴミ箱への移動に失敗し、元ファイルの状態も変化したため処理を中止しました".to_string())
        }
        Err(e) => return Err(format!("ゴミ箱への移動後に元ファイルを確認できません: {e}")),
    }

    let dest = quarantine_path_for(input)?;
    let quarantine_dir = dest.parent().unwrap_or(input);
    std::fs::create_dir_all(quarantine_dir).map_err(|e| {
        format!("ゴミ箱への移動に失敗しました ({trash_err})。退避フォルダも作成できませんでした: {e}")
    })?;
    // 同一ディレクトリ配下なので同一ファイルシステム上のリネーム (データのコピーは発生しない)
    std::fs::rename(input, &dest).map_err(|e| {
        format!("ゴミ箱への移動に失敗しました ({trash_err})。退避フォルダへの移動もできませんでした: {e}")
    })?;
    Ok(SourceDisposal::Quarantine { location: dest.to_string_lossy().to_string() })
}

/// AV1 変換が完了した元ファイルを OS のゴミ箱 (使えない場合は退避フォルダ) へ移動する。
///
/// 元データ保護のため、以下をすべて満たす場合のみ実行する (完全削除は行わない):
/// - 直近に成功した `transcode_video` の入力・出力と一致する (記録は 1 回で消費)
/// - 元ファイルが変換開始時点からサイズ・更新日時とも変わっていない
/// - 元ファイル・変換後ファイルの両方がライブラリに登録済み
/// - 変換後ファイルが ffprobe で読め、映像 (元に音声があれば音声も) を含み、再生時間が一致する
#[tauri::command]
pub async fn trash_transcode_source(
    state: tauri::State<'_, TranscodeState>,
    db_state: tauri::State<'_, DbState>,
    app_settings: tauri::State<'_, SharedAppSettings>,
    input_path: String,
    output_path: String,
) -> Result<SourceDisposal, String> {
    let record = {
        let mut last = state.last_completed.lock().map_err(|e| e.to_string())?;
        match last.take() {
            Some(r) if r.input_path == input_path && r.output_path == output_path => r,
            other => {
                *last = other;
                return Err("直近に完了した変換と一致しないため、元ファイルは削除しません".to_string());
            }
        }
    };

    let input = validate_video_path(&input_path)?;
    let output = validate_video_path(&output_path)?;

    let ffprobe_path = {
        let s = app_settings.lock().map_err(|e| e.to_string())?;
        s.ffprobe_path.clone()
    };

    {
        let conn = db_state.conn()?;
        for p in [&input_path, &output_path] {
            let count: i64 = conn
                .query_row(
                    "SELECT COUNT(*) FROM videos WHERE path = ?1",
                    [normalize_path_str(p)],
                    |r| r.get(0),
                )
                .map_err(|e| format!("DB照会失敗: {e}"))?;
            if count == 0 {
                return Err(format!("ライブラリに登録されていないため、元ファイルは削除しません: {p}"));
            }
        }
    }

    {
        let input = input.clone();
        let output = output.clone();
        let expected = record.input_fingerprint.clone();
        tokio::task::spawn_blocking(move || -> Result<(), String> {
            let canon_in = input.canonicalize().map_err(|e| format!("元ファイルを確認できません: {e}"))?;
            let canon_out = output.canonicalize().map_err(|e| format!("変換後ファイルを確認できません: {e}"))?;
            if canon_in == canon_out {
                return Err("元ファイルと変換後ファイルが同一です".to_string());
            }
            if FileFingerprint::of(&input)? != expected {
                return Err("変換開始後に元ファイルが変更されたため、削除を中止しました".to_string());
            }
            if FileFingerprint::of(&output)?.len == 0 {
                return Err("変換後ファイルが空です".to_string());
            }
            Ok(())
        })
        .await
        .map_err(|e| e.to_string())??;
    }

    let source_info = probe_media(&ffprobe_path, &input_path).await?;
    let output_info = probe_media(&ffprobe_path, &output_path).await?;
    check_output_matches_source(&source_info, &output_info)?;

    tokio::task::spawn_blocking(move || {
        // 直前にもう一度フィンガープリントを確認してからゴミ箱へ移動する
        if FileFingerprint::of(&input)? != record.input_fingerprint {
            return Err("変換開始後に元ファイルが変更されたため、削除を中止しました".to_string());
        }
        dispose_source(&input, &record.input_fingerprint)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    fn info(duration: f64, has_video: bool, has_audio: bool) -> ProbeInfo {
        ProbeInfo { duration, has_video, has_audio }
    }

    #[test]
    fn parse_probe_json_reads_duration_and_streams() {
        let json = br#"{"streams":[{"codec_type":"video"},{"codec_type":"audio"}],"format":{"duration":"12.500000"}}"#;
        let p = parse_probe_json(json).unwrap();
        assert!((p.duration - 12.5).abs() < 1e-9);
        assert!(p.has_video && p.has_audio);
    }

    #[test]
    fn parse_probe_json_rejects_missing_duration() {
        let json = br#"{"streams":[{"codec_type":"video"}],"format":{}}"#;
        assert!(parse_probe_json(json).is_err());
    }

    #[test]
    fn check_accepts_small_duration_difference() {
        assert!(check_output_matches_source(&info(600.0, true, true), &info(601.5, true, true)).is_ok());
        // 長尺では 1% まで許容
        assert!(check_output_matches_source(&info(3600.0, true, true), &info(3570.0, true, true)).is_ok());
    }

    #[test]
    fn check_rejects_truncated_output() {
        assert!(check_output_matches_source(&info(600.0, true, true), &info(300.0, true, true)).is_err());
    }

    #[test]
    fn quarantine_path_is_hidden_dir_with_non_media_suffix() {
        let dir = std::env::temp_dir().join(format!("css-quarantine-test-{}", std::process::id()));
        let input = dir.join("動画.mp4");
        let p = quarantine_path_for(&input).unwrap();
        assert_eq!(p, dir.join(QUARANTINE_DIR_NAME).join("動画.mp4.trashed"));
        // メディア拡張子ではない (スキャン・ウォッチャーの取り込み対象外)
        assert!(crate::commands::utils::validate_media_path(&p.to_string_lossy()).is_err());
    }

    #[test]
    fn transcode_tmp_name_matches_only_tmp_outputs() {
        assert!(is_transcode_tmp_name("._動画.av1.mkv.tmp"));
        assert!(is_transcode_tmp_name("._動画.av1_2.mkv.tmp"));
        assert!(!is_transcode_tmp_name("動画.av1.mkv.tmp"));
        assert!(!is_transcode_tmp_name("._動画.av1.mkv"));
        assert!(!is_transcode_tmp_name("._動画.mkv.tmp"));
        assert!(!is_transcode_tmp_name("._link_abc.webp.tmp"));
    }

    #[test]
    fn check_rejects_missing_streams() {
        assert!(check_output_matches_source(&info(60.0, true, true), &info(60.0, false, true)).is_err());
        assert!(check_output_matches_source(&info(60.0, true, true), &info(60.0, true, false)).is_err());
        // 元に音声がなければ出力に音声がなくてもよい
        assert!(check_output_matches_source(&info(60.0, true, false), &info(60.0, true, false)).is_ok());
    }
}
