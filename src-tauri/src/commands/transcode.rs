use std::io::{BufRead, BufReader};
use std::path::Path;
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use serde::{Deserialize, Serialize};
use tauri::Emitter;
use tauri_plugin_notification::NotificationExt;

use super::settings::SharedAppSettings;
use super::webp_thumb::{encoder_listed, list_encoders};
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

    /// 「サイズ:更新日時(ns)」(`media_probe.probe_key` と同じ形)。更新日時が読めなければ None
    fn key(&self) -> Option<String> {
        let mtime = self.modified?.duration_since(std::time::UNIX_EPOCH).ok()?.as_nanos();
        Some(format!("{}:{mtime}", self.len))
    }
}

/// 直近に成功したトランスコードの記録。
/// `trash_transcode_source` はこの記録と一致する元ファイルしかゴミ箱へ移動しない。
struct CompletedTranscode {
    input_path: String,
    output_path: String,
    input_fingerprint: FileFingerprint,
    /// 変換後ファイルが満たすべき条件 (ゴミ箱移動の直前にも確かめる)
    expected: Expectation,
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

    /// 変換中の一時出力ファイル。ロックが壊れていれば Err (呼び出し側は何も消さない)
    pub(crate) fn current_output(&self) -> Result<Option<String>, String> {
        self.current_output.lock().map(|p| p.clone()).map_err(|e| e.to_string())
    }
}

impl Default for TranscodeState {
    fn default() -> Self {
        Self::new()
    }
}

/// `transcode_video` の結果
#[derive(Serialize, Debug)]
#[serde(tag = "status", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum TranscodeOutcome {
    /// 変換後のファイルを保存した
    Done { output_path: String },
    /// 十分に小さくならなかったため変換後のファイルを破棄した (元ファイルはそのまま)
    Discarded { input_bytes: u64, output_bytes: u64 },
}

#[tauri::command]
pub async fn transcode_video(
    app: tauri::AppHandle,
    state: tauri::State<'_, TranscodeState>,
    db_state: tauri::State<'_, DbState>,
    app_settings: tauri::State<'_, SharedAppSettings>,
    input_path: String,
    duration_secs: f64,
    mode: TranscodeMode,
) -> Result<TranscodeOutcome, String> {
    mode.validate()?;
    state.cancel_flag.store(false, Ordering::SeqCst);
    // 前回の完了記録は新しい変換の開始時点で無効化する
    if let Ok(mut last) = state.last_completed.lock() {
        *last = None;
    }

    let (ffmpeg_path, ffprobe_path) = {
        let s = app_settings.lock().map_err(|e| e.to_string())?;
        (s.ffmpeg_path.clone(), s.ffprobe_path.clone())
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
    let suffix = mode.suffix();
    let output_path = resolve_unique_path(&dir.join(format!("{stem}.{suffix}.mkv")));
    // 一時出力ファイルは確定した output_path から派生させる
    let out_filename = output_path
        .file_name()
        .map(|n| format!("._{}", n.to_string_lossy()))
        .unwrap_or_else(|| format!("._{stem}.{suffix}.mkv"));
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

    // ストリーム構成を調べ、モードに合わせて残すトラックと変換方法を決める
    let (source_info, encoders) =
        tokio::join!(probe_source(&ffprobe_path, &input_path), detect_encoders(&ffmpeg_path));
    let source_info = source_info?;
    let mode = mode.resolve(&source_info)?;
    let expected = expectation(&mode, &source_info)?;
    // 進み具合は出力の長さに対する割合で出す (トリミングすると元より短い)
    let duration_secs = match mode {
        TranscodeMode::Remux { .. } => expected.duration,
        _ if duration_secs > 0.0 => duration_secs,
        _ => source_info.duration,
    };

    let output_str = output_path.to_string_lossy().to_string();
    let tmp_output_str = tmp_output_path.to_string_lossy().to_string();
    let build_args = |encoders| {
        build_ffmpeg_args(&input_path, &tmp_output_str, &mode, &source_info, Some(input_fingerprint.len), encoders)
    };
    // SVT-AV1 が落ちたときは AVX2 を使わずにやり直す (`Av1Encoder::SvtNoAvx2`)
    let mut attempts = vec![build_args(encoders)?];
    if matches!(mode, TranscodeMode::Av1 { .. }) && encoders.av1 == Some(Av1Encoder::Svt) {
        attempts.push(build_args(Encoders { av1: Some(Av1Encoder::SvtNoAvx2), ..encoders })?);
    }

    {
        let mut p = state.current_output.lock().map_err(|e| e.to_string())?;
        *p = Some(tmp_output_str.clone());
    }

    let cancel_flag = state.cancel_flag.clone();
    let current_output = state.current_output.clone();
    let current_child = state.current_child.clone();

    let result = tokio::task::spawn_blocking({
        let app = app.clone();
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

            for (attempt, ffmpeg_args) in attempts.iter().enumerate() {
                if cancel_flag.load(Ordering::SeqCst) {
                    return Err("キャンセルされました".to_string());
                }

                // 一時ファイルが既に存在する場合は削除
                let _ = std::fs::remove_file(&tmp_output_str);

                let mut child = Command::new(&ffmpeg_path)
                    .args(ffmpeg_args)
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
                if status.success() {
                    return Ok(());
                }
                let _ = std::fs::remove_file(&tmp_output_str);
                let signal = crash_signal(&status);
                if signal.is_some() && attempt + 1 < attempts.len() {
                    log::warn!(
                        "[transcode] ffmpeg がシグナル {signal:?} で落ちたため、AVX2 を使わずにやり直します"
                    );
                    continue;
                }
                let detail = if stderr_output.trim().is_empty() {
                    String::new()
                } else {
                    format!("\n{}", stderr_output.trim())
                };
                let reason = match signal {
                    Some(sig) => format!("シグナル {sig} で強制終了"),
                    None => format!("code: {:?}", status.code()),
                };
                return Err(format!("FFmpeg がエラーで終了しました ({reason}){detail}"));
            }
            Err("FFmpeg を実行できませんでした".to_string())
        }
    })
    .await
    .map_err(|e| e.to_string())
    .and_then(|r| r);

    // 完成した一時ファイルを検証し、残す価値があるものだけ最終パスへ移動する
    let result = match result {
        Ok(()) => {
            finalize_output(&ffprobe_path, &expected, mode.min_saving_ratio(), &input, &tmp_output_str, &output_str).await
        }
        Err(e) => Err(e),
    };

    match current_output.lock() {
        Ok(mut p) => { *p = None; }
        Err(e) => { log::error!("[transcode] current_output mutex ロック失敗 (クリーンアップ不可): {e}"); }
    }

    if let Some((input_bytes, output_bytes)) = result? {
        log::info!("[transcode] 縮小が小さいため変換後のファイルを破棄しました ({input_bytes} → {output_bytes} bytes): {input_path}");
        // 整理画面の高ビットレートの一覧に出し続けないように記録する
        if let (Some(kind), Some(key)) = (mode.reencode_kind(), input_fingerprint.key()) {
            let recorded = db_state.conn().and_then(|conn| {
                record_discarded(&conn, &normalize_path_str(&input_path), kind, &key, input_bytes, output_bytes)
            });
            if let Err(e) = recorded {
                log::warn!("[transcode] 破棄した変換の記録に失敗しました: {e}");
            }
        }
        notify(&app, "変換後のファイルを破棄しました", &format!(
            "{} は十分に小さくならなかったため、元のファイルを残しました",
            file_name_of(&input_path),
        ));
        return Ok(TranscodeOutcome::Discarded { input_bytes, output_bytes });
    }

    match state.last_completed.lock() {
        Ok(mut last) => {
            *last = Some(CompletedTranscode {
                input_path: input_path.clone(),
                output_path: output_str.clone(),
                input_fingerprint,
                expected,
            });
        }
        Err(e) => log::error!("[transcode] last_completed mutex ロック失敗: {e}"),
    }

    notify(&app, "変換完了", &format!("{} の変換が完了しました", file_name_of(&output_str)));

    Ok(TranscodeOutcome::Done { output_path: output_str })
}

fn file_name_of(path: &str) -> String {
    Path::new(path)
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| "ファイル".to_string())
}

fn notify(app: &tauri::AppHandle, title: &str, body: &str) {
    if let Err(e) = app.notification().builder().title(title).body(body).show() {
        log::warn!("[notification] トランスコード通知の送信に失敗しました: {e}");
    }
}

/// ffmpeg が書き終えた一時ファイルを検証し、最終パスへ移動する。
/// - トラックの欠落・尺の不一致があればエラー (一時ファイルは削除)
/// - 十分小さくならなければ一時ファイルを削除し、`Some((元のサイズ, 変換後のサイズ))` を返す
/// - 問題なければアトミックにリネームして `None` を返す (不完全なファイルが最終パスに残らない)
async fn finalize_output(
    ffprobe_path: &str,
    expected: &Expectation,
    min_saving_ratio: f64,
    input: &Path,
    tmp_output: &str,
    output: &str,
) -> Result<Option<(u64, u64)>, String> {
    let checked: Result<Option<(u64, u64)>, String> = async {
        let output_info = probe_media(ffprobe_path, tmp_output).await?;
        check_output(expected, &output_info)?;
        let input_bytes = tokio::fs::metadata(input).await.map_err(|e| e.to_string())?.len();
        let output_bytes = tokio::fs::metadata(tmp_output).await.map_err(|e| e.to_string())?.len();
        Ok((!is_worth_keeping(input_bytes, output_bytes, min_saving_ratio)).then_some((input_bytes, output_bytes)))
    }
    .await;

    match checked {
        Ok(None) => tokio::fs::rename(tmp_output, output)
            .await
            .map(|()| None)
            .map_err(|e| format!("出力ファイルの移動に失敗しました: {e}")),
        other => {
            let _ = tokio::fs::remove_file(tmp_output).await;
            other
        }
    }
}

/// プロセスがクラッシュ (SIGSEGV / SIGBUS / SIGILL) で終わったときのシグナル番号。
/// kill による終了 (SIGKILL / SIGTERM) はやり直さないため含めない
fn crash_signal(status: &std::process::ExitStatus) -> Option<i32> {
    #[cfg(unix)]
    {
        use std::os::unix::process::ExitStatusExt;
        const SIGILL: i32 = 4;
        const SIGBUS: i32 = if cfg!(target_os = "linux") { 7 } else { 10 };
        const SIGSEGV: i32 = 11;
        status.signal().filter(|s| [SIGILL, SIGBUS, SIGSEGV].contains(s))
    }
    #[cfg(not(unix))]
    {
        let _ = status;
        None
    }
}

/// 再エンコードしても十分に小さくならなかったことを記録する (`media_transcode_discarded`)。
/// ライブラリに無いファイルなら何もしない
fn record_discarded(
    conn: &rusqlite::Connection,
    path: &str,
    kind: &str,
    file_key: &str,
    input_bytes: u64,
    output_bytes: u64,
) -> Result<(), String> {
    conn.execute(
        "INSERT OR REPLACE INTO media_transcode_discarded (video_id, mode, file_key, input_bytes, output_bytes)
         SELECT id, ?2, ?3, ?4, ?5 FROM videos WHERE path = ?1",
        rusqlite::params![path, kind, file_key, input_bytes as i64, output_bytes as i64],
    )
    .map(|_| ())
    .map_err(|e| e.to_string())
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

/// 変換途中の一時ファイル名 (`._<名前>.<av1|hevc|opus|slim>[_N].mkv.tmp`) かどうか
pub(crate) fn is_transcode_tmp_name(name: &str) -> bool {
    name.starts_with("._")
        && name.ends_with(".mkv.tmp")
        && OUTPUT_SUFFIXES.iter().any(|s| name.contains(&format!(".{s}")))
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

// ── 変換モード ───────────────────────────────────────────────────────────────

/// 変換の種類。フロントエンドからは `{ "kind": "av1", "crf": 32, "preset": 8 }` のように渡す
#[derive(Deserialize, Serialize, Clone, Debug, PartialEq)]
#[serde(tag = "kind", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum TranscodeMode {
    /// 映像を AV1 で再エンコードする (遅いがよく縮む)。
    /// SVT-AV1 があればそちらを使い、なければ libaom で代わりにする (`Av1Encoder`)。
    /// `preset` は SVT-AV1 のプリセット (0〜13)。libaom では `-cpu-used` に読み替える
    Av1 { crf: u32, preset: u32 },
    /// 映像を VideoToolbox の HEVC で再エンコードする (速い)。
    /// Intel Mac では画質指定 (`-q:v`) が使えないため、元の映像ビットレートに対する割合で指定する
    Hevc { bitrate_percent: u32 },
    /// 映像はそのままコピーし、音声だけを Opus にする
    Audio,
    /// 再エンコードせず、選んだトラックだけを残す。開始・終了を指定すると切り詰める (キーフレーム単位)
    Remux {
        /// 残すストリームの番号 (ffprobe の index)
        streams: Vec<usize>,
        trim_start: Option<f64>,
        trim_end: Option<f64>,
    },
    /// 再エンコードせず、指定した音声トラックだけを外す (無音のトラックの整理用)。
    /// 変換開始時にファイルを調べ、残りを残す `Remux` に置き換える
    DropStreams {
        /// 外す音声トラックの番号 (ffprobe の index)
        streams: Vec<usize>,
    },
}

/// 出力ファイル名に付ける印 (`{stem}.{印}.mkv`)
const OUTPUT_SUFFIXES: [&str; 4] = ["av1", "hevc", "opus", "slim"];

impl TranscodeMode {
    /// 映像を再エンコードする変換なら `media_transcode_discarded.mode` に入れる名前
    fn reencode_kind(&self) -> Option<&'static str> {
        match self {
            Self::Av1 { .. } => Some("av1"),
            Self::Hevc { .. } => Some("hevc"),
            Self::Audio | Self::Remux { .. } | Self::DropStreams { .. } => None,
        }
    }

    fn suffix(&self) -> &'static str {
        match self {
            Self::Av1 { .. } => OUTPUT_SUFFIXES[0],
            Self::Hevc { .. } => OUTPUT_SUFFIXES[1],
            Self::Audio => OUTPUT_SUFFIXES[2],
            Self::Remux { .. } | Self::DropStreams { .. } => OUTPUT_SUFFIXES[3],
        }
    }

    /// 変換後のファイルがこの割合以上小さくならなければ、変換後のほうを破棄する。
    /// 映像の再エンコードは画質を落とすので、それに見合う効果がないものは残さない。
    /// 音声だけ・トラック整理は動画全体に対する割合が小さくなりやすいので、縮んでいれば残す
    fn min_saving_ratio(&self) -> f64 {
        match self {
            Self::Av1 { .. } | Self::Hevc { .. } => MIN_SAVING_RATIO,
            Self::Audio => 0.01,
            Self::Remux { .. } | Self::DropStreams { .. } => 0.0,
        }
    }

    fn validate(&self) -> Result<(), String> {
        match self {
            Self::Av1 { crf, preset } if *crf > 63 || *preset > 13 => Err("CRF・プリセットの値が範囲外です".into()),
            Self::Hevc { bitrate_percent } if !(10..=90).contains(bitrate_percent) => {
                Err("ビットレートの割合が範囲外です (10〜90%)".into())
            }
            Self::Remux { trim_start, trim_end, .. } => {
                let bad = |t: &Option<f64>| t.is_some_and(|v| !v.is_finite() || v < 0.0);
                if bad(trim_start) || bad(trim_end) {
                    return Err("切り詰める位置が不正です".into());
                }
                Ok(())
            }
            Self::DropStreams { streams } if streams.is_empty() => Err("外すトラックが指定されていません".into()),
            _ => Ok(()),
        }
    }

    /// `DropStreams` を、外すもの以外をすべて残す `Remux` に置き換える (他のモードはそのまま)。
    /// 調べた後にファイルが差し替わり、番号が音声トラックを指さなくなっていたら変換しない
    fn resolve(self, source: &ProbeInfo) -> Result<Self, String> {
        let Self::DropStreams { streams: dropped } = self else {
            return Ok(self);
        };
        for index in &dropped {
            match source.streams.iter().find(|s| s.index == *index) {
                Some(s) if s.codec_type == "audio" => {}
                _ => return Err(format!("外す音声トラック #{index} が見つかりません (ファイルが変わった可能性があります)")),
            }
        }
        let streams = source
            .streams
            .iter()
            .filter(|s| REMUXABLE_TYPES.contains(&s.codec_type.as_str()) && !dropped.contains(&s.index))
            .map(|s| s.index)
            .collect();
        Ok(Self::Remux { streams, trim_start: None, trim_end: None })
    }
}

// ── ffprobe によるストリーム構成の取得 ─────────────────────────────────────

#[derive(Clone, Debug, PartialEq, Default)]
pub(crate) struct StreamInfo {
    /// ffprobe のストリーム番号 (`-map 0:{index}`)
    pub(crate) index: usize,
    pub(crate) codec_type: String,
    codec_name: String,
    /// カバー画像 (attached_pic)。映像として変換せず落とす
    attached_pic: bool,
    width: Option<u32>,
    height: Option<u32>,
    fps: Option<f64>,
    /// ストリームのビットレート (bps)。Matroska では BPS タグから補う
    pub(crate) bit_rate: Option<u64>,
    channels: Option<u32>,
    channel_layout: Option<String>,
    pix_fmt: Option<String>,
    language: Option<String>,
    title: Option<String>,
}

impl StreamInfo {
    /// カバー画像を除いた本来の映像ストリームか
    fn is_main_video(&self) -> bool {
        self.codec_type == "video" && !self.attached_pic
    }

    /// 1 画素 10 ビット以上の映像か
    fn is_high_bit_depth(&self) -> bool {
        self.pix_fmt.as_deref().is_some_and(|f| f.contains("10") || f.contains("12"))
    }
}

#[derive(Clone, Debug, PartialEq)]
pub(crate) struct ProbeInfo {
    pub(crate) duration: f64,
    /// コンテナ全体のビットレート (bps)
    bit_rate: Option<u64>,
    pub(crate) streams: Vec<StreamInfo>,
}

#[cfg(test)]
impl ProbeInfo {
    /// 他のモジュールのテスト用: 音声トラックだけのファイル
    pub(crate) fn audio_only_for_test(duration: f64, tracks: &[(usize, Option<u64>)]) -> Self {
        let streams = tracks
            .iter()
            .map(|(index, bit_rate)| StreamInfo { index: *index, codec_type: "audio".into(), bit_rate: *bit_rate, ..Default::default() })
            .collect();
        Self { duration, bit_rate: None, streams }
    }
}

/// 変換で保持すべきストリームの本数
#[derive(Debug, PartialEq, Clone, Copy)]
struct StreamCounts {
    video: usize,
    audio: usize,
    subtitle: usize,
    attachment: usize,
}

fn count_streams<'a>(streams: impl Iterator<Item = &'a StreamInfo> + Clone) -> StreamCounts {
    let n = |f: &dyn Fn(&StreamInfo) -> bool| streams.clone().filter(|s| f(s)).count();
    StreamCounts {
        video: n(&|s| s.is_main_video()),
        audio: n(&|s| s.codec_type == "audio"),
        subtitle: n(&|s| s.codec_type == "subtitle"),
        attachment: n(&|s| s.codec_type == "attachment"),
    }
}

impl ProbeInfo {
    fn counts(&self) -> StreamCounts {
        count_streams(self.streams.iter())
    }

    fn main_video(&self) -> Option<&StreamInfo> {
        self.streams.iter().find(|s| s.is_main_video())
    }
}

/// ffprobe でコンテナの再生時間とストリーム構成を取得する。
pub(crate) async fn probe_media(ffprobe_path: &str, path: &str) -> Result<ProbeInfo, String> {
    let out = tokio::process::Command::new(ffprobe_path)
        .args([
            "-v", "error",
            "-show_entries",
            "format=duration,bit_rate\
             :stream=index,codec_type,codec_name,width,height,avg_frame_rate,bit_rate,channels,channel_layout,pix_fmt\
             :stream_disposition=attached_pic\
             :stream_tags=language,title,BPS,BPS-eng",
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

/// 元ファイルを調べる。ビットレートが記録されていない音声は、先頭のパケットから実測して補う
/// (ffmpeg が書いた Matroska には BPS タグがなく、変換するかを決められないため)
pub(crate) async fn probe_source(ffprobe_path: &str, path: &str) -> Result<ProbeInfo, String> {
    let mut info = probe_media(ffprobe_path, path).await?;
    for s in info.streams.iter_mut().filter(|s| s.codec_type == "audio" && s.bit_rate.is_none()) {
        s.bit_rate = measure_bitrate(ffprobe_path, path, s.index).await;
    }
    Ok(info)
}

/// 実測に使う長さ (秒)
const MEASURE_SECS: u32 = 60;

/// ストリームの先頭 `MEASURE_SECS` 秒のパケットからビットレート (bps) を測る
async fn measure_bitrate(ffprobe_path: &str, path: &str, index: usize) -> Option<u64> {
    let out = tokio::process::Command::new(ffprobe_path)
        .args(["-v", "error", "-select_streams", &index.to_string()])
        .args(["-show_entries", "packet=pts_time,size", "-read_intervals", &format!("%+{MEASURE_SECS}")])
        .args(["-of", "json", path])
        .output()
        .await
        .ok()?;
    if !out.status.success() {
        return None;
    }
    bitrate_from_packets(&out.stdout)
}

fn bitrate_from_packets(bytes: &[u8]) -> Option<u64> {
    let json: serde_json::Value = serde_json::from_slice(bytes).ok()?;
    let packets = json["packets"].as_array()?;
    let mut total: u64 = 0;
    let (mut first, mut last) = (f64::INFINITY, f64::NEG_INFINITY);
    for p in packets {
        total += json_u64(&p["size"]).unwrap_or(0);
        if let Some(t) = p["pts_time"].as_str().and_then(|t| t.parse::<f64>().ok()) {
            first = first.min(t);
            last = last.max(t);
        }
    }
    let span = last - first;
    (span >= 1.0).then(|| (total as f64 * 8.0 / span) as u64).filter(|b| *b > 0)
}

/// ffprobe は数値を文字列で返す ("1234" / "30000/1001")
fn json_u64(v: &serde_json::Value) -> Option<u64> {
    v.as_u64().or_else(|| v.as_str()?.parse().ok()).filter(|n| *n > 0)
}

fn json_str(v: &serde_json::Value) -> Option<String> {
    v.as_str().map(str::trim).filter(|s| !s.is_empty()).map(String::from)
}

fn parse_rate(v: &serde_json::Value) -> Option<f64> {
    let s = v.as_str()?;
    let fps = match s.split_once('/') {
        Some((n, d)) => n.parse::<f64>().ok()? / d.parse::<f64>().ok()?,
        None => s.parse().ok()?,
    };
    (fps.is_finite() && fps > 0.0).then_some(fps)
}

fn parse_probe_json(bytes: &[u8]) -> Result<ProbeInfo, String> {
    let json: serde_json::Value =
        serde_json::from_slice(bytes).map_err(|e| format!("ffprobe 出力の解析に失敗しました: {e}"))?;
    let duration = json["format"]["duration"]
        .as_str()
        .and_then(|d| d.parse::<f64>().ok())
        .filter(|d| d.is_finite() && *d > 0.0)
        .ok_or_else(|| "再生時間を取得できませんでした".to_string())?;
    let streams = json["streams"]
        .as_array()
        .map(|a| a.as_slice())
        .unwrap_or_default()
        .iter()
        .enumerate()
        .map(|(i, s)| {
            let tags = &s["tags"];
            StreamInfo {
                index: json_u64(&s["index"]).map(|n| n as usize).unwrap_or(i),
                codec_type: s["codec_type"].as_str().unwrap_or_default().to_string(),
                codec_name: s["codec_name"].as_str().unwrap_or_default().to_string(),
                attached_pic: s["disposition"]["attached_pic"].as_i64() == Some(1),
                width: json_u64(&s["width"]).and_then(|n| u32::try_from(n).ok()),
                height: json_u64(&s["height"]).and_then(|n| u32::try_from(n).ok()),
                fps: parse_rate(&s["avg_frame_rate"]),
                bit_rate: json_u64(&s["bit_rate"])
                    .or_else(|| json_u64(&tags["BPS"]))
                    .or_else(|| json_u64(&tags["BPS-eng"])),
                channels: json_u64(&s["channels"]).and_then(|n| u32::try_from(n).ok()),
                channel_layout: json_str(&s["channel_layout"]),
                pix_fmt: json_str(&s["pix_fmt"]),
                language: json_str(&tags["language"]).filter(|l| l != "und"),
                title: json_str(&tags["title"]),
            }
        })
        .collect();
    Ok(ProbeInfo { duration, bit_rate: json_u64(&json["format"]["bit_rate"]), streams })
}

// ── 変換後ファイルの検証 ─────────────────────────────────────────────────────

/// 変換後ファイルが満たすべき条件
#[derive(Clone, Debug, PartialEq)]
struct Expectation {
    counts: StreamCounts,
    /// 見込みの再生時間 (秒)
    duration: f64,
    /// 見込みより長くてよい秒数 (先頭を切るとキーフレームまで戻るため)
    extra_allowed: f64,
}

/// 再エンコードや切り詰めで生じる再生時間のずれの許容量
fn duration_tolerance(duration: f64) -> f64 {
    (duration * 0.01).max(2.0)
}

/// 先頭を切り詰めたとき、直前のキーフレームまで戻って長くなる分の許容量
const KEYFRAME_SLACK_SECS: f64 = 15.0;

/// モードと元ファイルの構成から、変換後ファイルの条件を決める。
/// トラック整理では、選んだトラックがあるか・何か変わるかもここで確かめる
fn expectation(mode: &TranscodeMode, source: &ProbeInfo) -> Result<Expectation, String> {
    let TranscodeMode::Remux { streams, trim_start, trim_end } = mode else {
        if *mode == TranscodeMode::Audio && audio_plan(source).iter().all(|a| a.opus_kbps.is_none()) {
            return Err("縮められる音声トラックがありません (既に Opus か、十分にビットレートが低い)".into());
        }
        // カバー画像以外はすべて残す
        return Ok(Expectation { counts: source.counts(), duration: source.duration, extra_allowed: 0.0 });
    };

    let kept: Vec<&StreamInfo> = source.streams.iter().filter(|s| streams.contains(&s.index)).collect();
    if kept.len() != streams.len() {
        return Err("選んだトラックが元のファイルに見つかりません".into());
    }
    if let Some(s) = kept.iter().find(|s| !REMUXABLE_TYPES.contains(&s.codec_type.as_str())) {
        return Err(format!("このトラックは残せません (#{} {})", s.index, s.codec_type));
    }
    if !kept.iter().any(|s| s.is_main_video()) {
        return Err("映像トラックを 1 つ以上残してください".into());
    }

    let start = trim_start.unwrap_or(0.0);
    let end = trim_end.unwrap_or(source.duration).min(source.duration);
    if end - start < 1.0 {
        return Err("切り詰めた後の長さが短すぎます".into());
    }
    let trimmed = start > 0.0 || end < source.duration - 0.5;
    let all_kept = source
        .streams
        .iter()
        .filter(|s| REMUXABLE_TYPES.contains(&s.codec_type.as_str()))
        .all(|s| streams.contains(&s.index));
    if !trimmed && all_kept {
        return Err("外すトラックも切り詰める範囲もありません".into());
    }

    Ok(Expectation {
        counts: count_streams(kept.into_iter()),
        duration: end - start,
        extra_allowed: if start > 0.0 { KEYFRAME_SLACK_SECS } else { 0.0 },
    })
}

/// 変換後ファイルが条件を満たすかを判定する。
/// - 映像・音声・字幕・添付ファイルの本数が見込みから減っていない
/// - 再生時間の差が許容範囲 (max(2 秒, 1%)、先頭を切ったときは長い側に余裕) に収まる
fn check_output(expected: &Expectation, output: &ProbeInfo) -> Result<(), String> {
    let (want, out) = (expected.counts, output.counts());
    if out.video == 0 {
        return Err("変換後ファイルに映像ストリームがありません".to_string());
    }
    for (label, s, o) in [
        ("映像", want.video, out.video),
        ("音声", want.audio, out.audio),
        ("字幕", want.subtitle, out.subtitle),
        ("添付ファイル", want.attachment, out.attachment),
    ] {
        if o < s {
            return Err(format!("変換後ファイルの{label}トラックが足りません (見込み: {s} / 変換後: {o})"));
        }
    }
    let tolerance = duration_tolerance(expected.duration);
    let diff = output.duration - expected.duration;
    if diff < -tolerance || diff > tolerance + expected.extra_allowed {
        return Err(format!(
            "再生時間が見込みと一致しません (見込み: {:.1} 秒 / 変換後: {:.1} 秒)",
            expected.duration, output.duration
        ));
    }
    Ok(())
}

// ── 音声の変換方針 ───────────────────────────────────────────────────────────

/// 音声トラックの扱い
#[derive(Serialize, Debug, PartialEq, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AudioPlan {
    pub index: usize,
    pub codec: String,
    pub channels: Option<u32>,
    pub bit_rate_kbps: Option<f64>,
    pub language: Option<String>,
    pub title: Option<String>,
    /// Opus に変換するときのビットレート。None ならそのままコピーする
    pub opus_kbps: Option<u32>,
}

/// そのままコピーしてよい非可逆コーデック (Matroska にそのまま入る)
const COPYABLE_LOSSY_AUDIO: [&str; 8] = ["aac", "mp3", "mp2", "ac3", "eac3", "dts", "vorbis", "opus"];

/// Opus のビットレート (kbps)。ステレオ 128k、それ以上は 1 チャンネル 48k
fn opus_kbps_for(channels: Option<u32>) -> u32 {
    match channels.unwrap_or(2) {
        0 | 1 => 64,
        2 => 128,
        n => 48 * n,
    }
}

/// これより Opus の目標の何倍も大きければ変換する (少しだけ大きいものは劣化に見合わないので残す)
const AUDIO_REENCODE_FACTOR: f64 = 1.25;

/// 音声トラックごとの扱いを決める。
/// 可逆・PCM やビットレートの高いものは Opus にし、既に Opus・十分小さい・ビットレート不明の非可逆はコピーする
fn audio_plan(info: &ProbeInfo) -> Vec<AudioPlan> {
    info.streams
        .iter()
        .filter(|s| s.codec_type == "audio")
        .map(|s| {
            let target = opus_kbps_for(s.channels);
            let encode = match (s.codec_name.as_str(), s.bit_rate) {
                ("opus", _) => false,
                (c, Some(b)) if COPYABLE_LOSSY_AUDIO.contains(&c) => b as f64 > target as f64 * 1000.0 * AUDIO_REENCODE_FACTOR,
                (c, None) => !COPYABLE_LOSSY_AUDIO.contains(&c),
                // 可逆・PCM・その他 (Matroska に入らないものも含む)
                _ => true,
            };
            AudioPlan {
                index: s.index,
                codec: s.codec_name.clone(),
                channels: s.channels,
                bit_rate_kbps: s.bit_rate.map(|b| b as f64 / 1000.0),
                language: s.language.clone(),
                title: s.title.clone(),
                opus_kbps: encode.then_some(target),
            }
        })
        .collect()
}

/// libopus がそのまま受け付けるチャンネル配置 (Vorbis の並び)
const OPUS_LAYOUTS: [&str; 8] = ["mono", "stereo", "3.0", "quad", "5.0", "5.1", "6.1", "7.1"];

/// libopus が受け付けない配置 (`5.1(side)` 等) を、同じチャンネル数の対応する配置へ並べ替える
fn opus_layout_fix(stream: &StreamInfo) -> Option<&'static str> {
    let ch = stream.channels?;
    if ch <= 2 || stream.channel_layout.as_deref().is_some_and(|l| OPUS_LAYOUTS.contains(&l)) {
        return None;
    }
    Some(match ch {
        3 => "3.0",
        4 => "quad",
        5 => "5.0",
        6 => "5.1",
        7 => "6.1",
        _ => "7.1",
    })
}

// ── ffmpeg の引数 ────────────────────────────────────────────────────────────

/// トラック整理で残せる種類 (データ・タイムコードは Matroska に入らないので外す)
pub(crate) const REMUXABLE_TYPES: [&str; 4] = ["video", "audio", "subtitle", "attachment"];

/// Matroska にそのまま入れられない字幕コーデック → 変換先
fn subtitle_codec_for_mkv(codec_name: &str) -> &'static str {
    match codec_name {
        // MP4 のテキスト字幕は Matroska に入らないので SRT にする
        "mov_text" => "srt",
        _ => "copy",
    }
}

/// HEVC の最低ビットレート (bps)。これ未満は画質が崩れやすい
const MIN_HEVC_BITRATE: f64 = 300_000.0;

// ── エンコーダー ─────────────────────────────────────────────────────────────

/// AV1 のエンコーダー
#[derive(Serialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum Av1Encoder {
    /// SVT-AV1 (`libsvtav1`)。速い
    Svt,
    /// SVT-AV1 で AVX2 の処理を使わない。SVT-AV1 4.1.0 は縦長の一部の解像度 (1810x2560 など) で
    /// temporal filtering の AVX2 の処理 (`svt_spatial_full_distortion_kernel_avx2`) が
    /// SIGSEGV で落ちるため、落ちたときはこれでやり直す (速さ・サイズはほぼ変わらない)
    SvtNoAvx2,
    /// libaom (`libaom-av1`)。SVT-AV1 よりかなり遅いが、SVT-AV1 を含まない ffmpeg のビルドもある
    Aom,
}

/// この ffmpeg で使える変換用のエンコーダー
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Encoders {
    pub av1: Option<Av1Encoder>,
    /// HEVC (VideoToolbox)
    pub hevc: bool,
}

impl Encoders {
    /// `ffmpeg -encoders` の出力から読み取る (各行は ` V....D 名前  説明` の形)
    fn parse(list: &str) -> Self {
        let has = |name: &str| encoder_listed(list, name);
        let av1 = if has("libsvtav1") {
            Some(Av1Encoder::Svt)
        } else if has("libaom-av1") {
            Some(Av1Encoder::Aom)
        } else {
            None
        };
        Self { av1, hevc: has("hevc_videotoolbox") }
    }
}

/// この ffmpeg で使えるエンコーダーを調べる
async fn detect_encoders(ffmpeg_path: &str) -> Encoders {
    list_encoders(ffmpeg_path).await.map(|list| Encoders::parse(&list)).unwrap_or_default()
}

/// SVT-AV1 のプリセット (0〜13) を libaom の `-cpu-used` に読み替える。
/// libaom の通常モードは 6 が最速 (7 以上を指定しても 6 と同じ) で、1 段遅くするごとに
/// 数倍ずつ時間が延びる (720p で 6 → 5 が約 4.5 倍、5 → 4 が約 2 倍) ため、4 より遅くはしない
fn aom_cpu_used(preset: u32) -> u32 {
    match preset {
        8.. => 6,
        5..=7 => 5,
        _ => 4,
    }
}

fn strings(items: &[&str]) -> Vec<String> {
    items.iter().map(|s| s.to_string()).collect()
}

/// 変換の ffmpeg 引数を組み立てる。
/// 既定のストリーム選択 (種類ごとに 1 本だけ) では 2 本目以降の音声・字幕や
/// 添付フォントが落ちるため、残すストリームをすべて明示的に対応付ける。
fn build_ffmpeg_args(
    input: &str,
    output: &str,
    mode: &TranscodeMode,
    source: &ProbeInfo,
    file_size: Option<u64>,
    encoders: Encoders,
) -> Result<Vec<String>, String> {
    let mut args = strings(&["-y", "-progress", "pipe:1", "-nostats"]);

    if let TranscodeMode::Remux { streams, trim_start, trim_end } = mode {
        let start = trim_start.unwrap_or(0.0);
        if start > 0.0 {
            args.extend(["-ss".into(), format!("{start:.3}")]);
        }
        args.extend(["-i".into(), input.into()]);
        if let Some(end) = trim_end.filter(|e| *e < source.duration) {
            args.extend(["-t".into(), format!("{:.3}", end - start)]);
        }
        let kept: Vec<&StreamInfo> = source.streams.iter().filter(|s| streams.contains(&s.index)).collect();
        for s in &kept {
            args.extend(["-map".into(), format!("0:{}", s.index)]);
        }
        args.extend(strings(&["-c", "copy"]));
        for (i, sub) in kept.iter().filter(|s| s.codec_type == "subtitle").enumerate() {
            args.extend([format!("-c:s:{i}"), subtitle_codec_for_mkv(&sub.codec_name).to_string()]);
        }
        if start > 0.0 {
            args.extend(strings(&["-avoid_negative_ts", "make_zero"]));
        }
        args.extend(["-f".into(), "matroska".into(), output.into()]);
        return Ok(args);
    }

    args.extend(["-i".into(), input.into()]);
    // V (大文字) はカバー画像・サムネイルを除いた映像
    args.extend(strings(&["-map", "0:V", "-map", "0:a?", "-map", "0:s?", "-map", "0:t?"]));

    match mode {
        TranscodeMode::Av1 { crf, preset } => match encoders.av1 {
            Some(svt @ (Av1Encoder::Svt | Av1Encoder::SvtNoAvx2)) => {
                args.extend(strings(&["-c:v", "libsvtav1"]));
                args.extend(["-crf".into(), crf.to_string(), "-preset".into(), preset.to_string()]);
                if svt == Av1Encoder::SvtNoAvx2 {
                    args.extend(strings(&["-svtav1-params", "asm=avx"]));
                }
            }
            Some(Av1Encoder::Aom) => {
                // `-b:v 0` を付けないと CRF が画質固定ではなく上限付きの指定になる。
                // 行単位の並列化とタイル分割 (2×2、小さい映像では自動で減る) で速くする
                args.extend(strings(&["-c:v", "libaom-av1"]));
                args.extend(["-crf".into(), crf.to_string(), "-b:v".into(), "0".into()]);
                args.extend(["-cpu-used".into(), aom_cpu_used(*preset).to_string()]);
                args.extend(strings(&["-row-mt", "1", "-tile-columns", "1", "-tile-rows", "1"]));
            }
            None => return Err("この ffmpeg には AV1 のエンコーダー (libsvtav1 / libaom-av1) がありません".into()),
        },
        TranscodeMode::Hevc { bitrate_percent } => {
            let video = source.main_video().ok_or("映像トラックがありません")?;
            let source_bps = video_bitrate(source, file_size).ok_or("元の映像のビットレートが分かりません")?;
            let target = (source_bps * *bitrate_percent as f64 / 100.0).max(MIN_HEVC_BITRATE).round() as u64;
            args.extend(strings(&["-c:v", "hevc_videotoolbox"]));
            args.extend(["-b:v".into(), target.to_string()]);
            // 画素形式を明示しないと 8 ビットの入力で失敗する環境がある (Intel Mac)
            if video.is_high_bit_depth() {
                args.extend(strings(&["-pix_fmt", "p010le", "-profile:v", "main10"]));
            } else {
                args.extend(strings(&["-pix_fmt", "nv12", "-profile:v", "main"]));
            }
        }
        TranscodeMode::Audio => {
            args.extend(strings(&["-c:v", "copy"]));
        }
        TranscodeMode::Remux { .. } => unreachable!("上で処理済み"),
        TranscodeMode::DropStreams { .. } => return Err("外すトラックの指定が解決されていません".into()),
    }

    let plans = audio_plan(source);
    let audio_streams: Vec<&StreamInfo> = source.streams.iter().filter(|s| s.codec_type == "audio").collect();
    for (i, (plan, stream)) in plans.iter().zip(&audio_streams).enumerate() {
        match plan.opus_kbps {
            Some(kbps) => {
                args.extend([format!("-c:a:{i}"), "libopus".into(), format!("-b:a:{i}"), format!("{kbps}k")]);
                if let Some(layout) = opus_layout_fix(stream) {
                    args.extend([format!("-filter:a:{i}"), format!("aformat=channel_layouts={layout}")]);
                }
            }
            None => args.extend([format!("-c:a:{i}"), "copy".into()]),
        }
    }

    let subtitles = source.streams.iter().filter(|s| s.codec_type == "subtitle");
    for (i, sub) in subtitles.enumerate() {
        args.extend([format!("-c:s:{i}"), subtitle_codec_for_mkv(&sub.codec_name).to_string()]);
    }
    if source.counts().attachment > 0 {
        args.extend(strings(&["-c:t", "copy"]));
    }
    args.extend(["-f".into(), "matroska".into(), output.into()]);
    Ok(args)
}

// ── 変換効果の見込み ─────────────────────────────────────────────────────────

/// 1 画素・1 フレームあたりのビット数 (H.264 換算) がこれ未満なら、
/// 再エンコードしても縮みにくいとみなす。1080p30 の H.264 で約 1.9 Mbps に当たる。
/// 目安の値で、最終的には変換後のサイズで判断する (`MIN_SAVING_RATIO`)。
const LOW_BPP_THRESHOLD: f64 = 0.03;

/// 映像を再エンコードしたとき、変換後のファイルがこの割合以上小さくならなければ、変換後のほうを破棄する
const MIN_SAVING_RATIO: f64 = 0.15;

/// H.264 と比べた圧縮効率 (同じ画質に必要なビットレートの比)。
/// HEVC・VP9 は H.264 の約 6 割で済むため、同じビットレートでも中身は濃い。
pub(crate) fn codec_efficiency(codec_name: &str) -> f64 {
    match codec_name {
        "hevc" | "vp9" => 0.6,
        _ => 1.0,
    }
}

#[derive(Serialize, Debug, PartialEq, Clone, Copy)]
#[serde(rename_all = "camelCase")]
pub enum TranscodeVerdict {
    /// 縮む見込みがある
    Worth,
    /// 既に AV1
    AlreadyAv1,
    /// ビットレートが低く、縮む余地が小さい
    LowBitrate,
    /// 判定に必要な情報が取れなかった
    Unknown,
}

/// 変換画面に出すストリームの一覧 (トラック整理で選ぶ)
#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct StreamSummary {
    pub index: usize,
    pub codec_type: String,
    pub codec_name: String,
    pub cover_art: bool,
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub channels: Option<u32>,
    pub bit_rate_kbps: Option<f64>,
    pub language: Option<String>,
    pub title: Option<String>,
    /// トラック整理で残せるか (データ・タイムコードは残せない)
    pub remuxable: bool,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct TranscodeEstimate {
    pub verdict: TranscodeVerdict,
    pub video_codec: Option<String>,
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub fps: Option<f64>,
    pub video_bitrate_kbps: Option<f64>,
    /// H.264 換算の bits per pixel
    pub bits_per_pixel: Option<f64>,
    pub min_saving_percent: f64,
    pub duration: f64,
    pub streams: Vec<StreamSummary>,
    pub audio: Vec<AudioPlan>,
    /// 音声だけ変換したときに減る見込みの容量 (ビットレートが分かる分だけ)
    pub audio_saving_bytes: u64,
    /// この ffmpeg で HEVC (VideoToolbox) が使えるか
    pub hevc_available: bool,
    /// AV1 変換に使うエンコーダー (無ければ AV1 変換はできない)
    pub av1_encoder: Option<Av1Encoder>,
}

/// 映像ストリームのビットレート (bps)。ストリームに記録がなければ
/// コンテナ全体 (無ければファイルサイズ ÷ 再生時間) から音声分を引いて見積もる。
fn video_bitrate(info: &ProbeInfo, file_size: Option<u64>) -> Option<f64> {
    if let Some(b) = info.main_video()?.bit_rate {
        return Some(b as f64);
    }
    let total = info
        .bit_rate
        .map(|b| b as f64)
        .or_else(|| file_size.map(|s| s as f64 * 8.0 / info.duration))?;
    // ビットレート不明の音声は 128 kbps とみなす
    let audio: f64 = info
        .streams
        .iter()
        .filter(|s| s.codec_type == "audio")
        .map(|s| s.bit_rate.unwrap_or(128_000) as f64)
        .sum();
    let video = total - audio;
    (video > 0.0).then_some(video)
}

/// 本来の映像ストリームの要点 (整理画面の見積もり用。commands/media_probe.rs で保存する)
#[derive(Debug, Clone, PartialEq, Default)]
pub(crate) struct VideoSummary {
    pub(crate) codec: Option<String>,
    pub(crate) width: Option<u32>,
    pub(crate) height: Option<u32>,
    pub(crate) fps: Option<f64>,
    /// 映像だけのビットレート (bps)。記録がなければ全体から音声分を引いた見積もり
    pub(crate) bitrate: Option<f64>,
}

pub(crate) fn video_summary(info: &ProbeInfo, file_size: Option<u64>) -> VideoSummary {
    let video = info.main_video();
    VideoSummary {
        codec: video.map(|v| v.codec_name.clone()).filter(|c| !c.is_empty()),
        width: video.and_then(|v| v.width),
        height: video.and_then(|v| v.height),
        fps: video.and_then(|v| v.fps),
        bitrate: video_bitrate(info, file_size),
    }
}

fn audio_saving_bytes(info: &ProbeInfo, plans: &[AudioPlan]) -> u64 {
    plans
        .iter()
        .filter_map(|p| Some(p.bit_rate_kbps? - p.opus_kbps? as f64))
        .filter(|d| *d > 0.0)
        .map(|kbps| (kbps * 1000.0 / 8.0 * info.duration) as u64)
        .sum()
}

fn estimate_from_probe(info: &ProbeInfo, file_size: Option<u64>, encoders: Encoders) -> TranscodeEstimate {
    let video = info.main_video();
    let bitrate = video_bitrate(info, file_size);
    let bpp = video.zip(bitrate).and_then(|(v, b)| {
        let pixels_per_sec = v.width? as f64 * v.height? as f64 * v.fps?;
        (pixels_per_sec > 0.0).then(|| b / pixels_per_sec / codec_efficiency(&v.codec_name))
    });
    let verdict = match (video, bpp) {
        (Some(v), _) if v.codec_name == "av1" => TranscodeVerdict::AlreadyAv1,
        (Some(_), Some(bpp)) if bpp < LOW_BPP_THRESHOLD => TranscodeVerdict::LowBitrate,
        (Some(_), Some(_)) => TranscodeVerdict::Worth,
        _ => TranscodeVerdict::Unknown,
    };
    let audio = audio_plan(info);
    TranscodeEstimate {
        verdict,
        video_codec: video.map(|v| v.codec_name.clone()),
        width: video.and_then(|v| v.width),
        height: video.and_then(|v| v.height),
        fps: video.and_then(|v| v.fps),
        video_bitrate_kbps: bitrate.map(|b| b / 1000.0),
        bits_per_pixel: bpp,
        min_saving_percent: MIN_SAVING_RATIO * 100.0,
        duration: info.duration,
        streams: info
            .streams
            .iter()
            .map(|s| StreamSummary {
                index: s.index,
                codec_type: s.codec_type.clone(),
                codec_name: s.codec_name.clone(),
                cover_art: s.attached_pic,
                width: s.width,
                height: s.height,
                channels: s.channels,
                bit_rate_kbps: s.bit_rate.map(|b| b as f64 / 1000.0),
                language: s.language.clone(),
                title: s.title.clone(),
                remuxable: REMUXABLE_TYPES.contains(&s.codec_type.as_str()),
            })
            .collect(),
        audio_saving_bytes: audio_saving_bytes(info, &audio),
        audio,
        hevc_available: encoders.hevc,
        av1_encoder: encoders.av1,
    }
}

/// 変換で容量が減りそうかを見積もり、トラックの一覧と使える変換方法を返す (変換画面用)
#[tauri::command]
pub async fn estimate_transcode(
    app_settings: tauri::State<'_, SharedAppSettings>,
    input_path: String,
) -> Result<TranscodeEstimate, String> {
    validate_video_path(&input_path)?;
    let (ffmpeg_path, ffprobe_path) = {
        let s = app_settings.lock().map_err(|e| e.to_string())?;
        (s.ffmpeg_path.clone(), s.ffprobe_path.clone())
    };
    let (info, encoders) = tokio::join!(probe_source(&ffprobe_path, &input_path), detect_encoders(&ffmpeg_path));
    let info = info?;
    let size = tokio::fs::metadata(&input_path).await.ok().map(|m| m.len());
    Ok(estimate_from_probe(&info, size, encoders))
}

/// 変換後のサイズが十分小さいか (元の `1 - min_saving_ratio` 倍以下で、かつ元より小さい)
fn is_worth_keeping(input_bytes: u64, output_bytes: u64, min_saving_ratio: f64) -> bool {
    output_bytes > 0
        && output_bytes < input_bytes
        && (output_bytes as f64) <= input_bytes as f64 * (1.0 - min_saving_ratio)
}

/// ゴミ箱が使えないボリューム用の退避フォルダ名 (元ファイルと同じディレクトリに作成)
pub(crate) const QUARANTINE_DIR_NAME: &str = ".ChuckSnapStackTrash";
/// 退避ファイルに付ける接尾辞。メディア拡張子でなくすことでスキャン・ウォッチャーの再取り込みを防ぐ
pub(crate) const QUARANTINE_SUFFIX: &str = ".trashed";

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

/// 変換が完了した元ファイルを OS のゴミ箱 (使えない場合は退避フォルダ) へ移動する。
///
/// 元データ保護のため、以下をすべて満たす場合のみ実行する (完全削除は行わない):
/// - 直近に成功した `transcode_video` の入力・出力と一致する (記録は 1 回で消費)
/// - 元ファイルが変換開始時点からサイズ・更新日時とも変わっていない
/// - 元ファイル・変換後ファイルの両方がライブラリに登録済み
/// - 変換後ファイルが ffprobe で読め、残すはずのトラックをすべて含み、再生時間が見込みどおり
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

    let output_info = probe_media(&ffprobe_path, &output_path).await?;
    check_output(&record.expected, &output_info)?;

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

    fn stream(codec_type: &str, codec_name: &str) -> StreamInfo {
        StreamInfo { codec_type: codec_type.into(), codec_name: codec_name.into(), ..Default::default() }
    }

    /// ストリーム番号を 0 から振り直す
    fn indexed(mut streams: Vec<StreamInfo>) -> Vec<StreamInfo> {
        for (i, s) in streams.iter_mut().enumerate() {
            s.index = i;
        }
        streams
    }

    fn audio(codec: &str, channels: u32, layout: &str, bit_rate: Option<u64>) -> StreamInfo {
        StreamInfo {
            channels: Some(channels),
            channel_layout: Some(layout.into()),
            bit_rate,
            ..stream("audio", codec)
        }
    }

    /// 全トラックを残す変換 (AV1 等) としての判定
    fn check_output_matches_source(source: &ProbeInfo, output: &ProbeInfo) -> Result<(), String> {
        let av1 = TranscodeMode::Av1 { crf: 32, preset: 8 };
        check_output(&expectation(&av1, source)?, output)
    }

    /// SVT-AV1 と VideoToolbox がそろった ffmpeg
    const SVT: Encoders = Encoders { av1: Some(Av1Encoder::Svt), hevc: true };
    /// SVT-AV1 を含まず libaom だけがある ffmpeg (evermeet.cx のビルドなど)
    const AOM: Encoders = Encoders { av1: Some(Av1Encoder::Aom), hevc: true };

    fn av1_args(source: &ProbeInfo, crf: u32, preset: u32) -> Vec<String> {
        build_ffmpeg_args("/in.mp4", "/out.tmp", &TranscodeMode::Av1 { crf, preset }, source, None, SVT).unwrap()
    }

    fn video(codec: &str, w: u32, h: u32, fps: f64, bit_rate: Option<u64>) -> StreamInfo {
        StreamInfo { width: Some(w), height: Some(h), fps: Some(fps), bit_rate, ..stream("video", codec) }
    }

    fn probe(duration: f64, streams: Vec<StreamInfo>) -> ProbeInfo {
        ProbeInfo { duration, bit_rate: None, streams: indexed(streams) }
    }

    fn info(duration: f64, has_video: bool, has_audio: bool) -> ProbeInfo {
        let mut streams = Vec::new();
        if has_video {
            streams.push(stream("video", "h264"));
        }
        if has_audio {
            streams.push(stream("audio", "aac"));
        }
        probe(duration, streams)
    }

    #[test]
    fn parse_probe_json_reads_duration_and_streams() {
        let json = br#"{"streams":[{"codec_type":"video"},{"codec_type":"audio"}],"format":{"duration":"12.500000"}}"#;
        let p = parse_probe_json(json).unwrap();
        assert!((p.duration - 12.5).abs() < 1e-9);
        let c = p.counts();
        assert_eq!((c.video, c.audio), (1, 1));
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
        assert!(is_transcode_tmp_name("._動画.hevc.mkv.tmp"));
        assert!(is_transcode_tmp_name("._動画.opus.mkv.tmp"));
        assert!(is_transcode_tmp_name("._動画.slim_3.mkv.tmp"));
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

    // ── ストリーム構成 ───────────────────────────────────────────────────────

    #[test]
    fn parse_probe_json_reads_codecs_rates_and_cover_art() {
        let json = br#"{
            "streams": [
                {"codec_type":"video","codec_name":"h264","width":1920,"height":1080,"avg_frame_rate":"30000/1001","bit_rate":"8000000","disposition":{"attached_pic":0}},
                {"codec_type":"audio","codec_name":"aac","bit_rate":"128000","disposition":{"attached_pic":0}},
                {"codec_type":"video","codec_name":"mjpeg","width":600,"height":600,"avg_frame_rate":"0/0","disposition":{"attached_pic":1}}
            ],
            "format": {"duration":"60.0","bit_rate":"8200000"}
        }"#;
        let p = parse_probe_json(json).unwrap();
        assert_eq!(p.bit_rate, Some(8_200_000));
        let v = p.main_video().unwrap();
        assert_eq!((v.codec_name.as_str(), v.width, v.height, v.bit_rate), ("h264", Some(1920), Some(1080), Some(8_000_000)));
        assert!((v.fps.unwrap() - 29.97).abs() < 0.01);
        assert!(p.streams[2].attached_pic);
        assert_eq!(p.streams[2].fps, None, "0/0 は fps なし");
        // カバー画像は映像の本数に数えない
        assert_eq!(p.counts(), StreamCounts { video: 1, audio: 1, subtitle: 0, attachment: 0 });
    }

    #[test]
    fn check_rejects_dropped_audio_and_subtitle_tracks() {
        let source = probe(60.0, vec![
            stream("video", "h264"),
            stream("audio", "aac"),
            stream("audio", "ac3"),
            stream("subtitle", "subrip"),
            stream("attachment", "ttf"),
        ]);
        let all = probe(60.0, vec![
            stream("video", "av1"),
            stream("audio", "opus"),
            stream("audio", "opus"),
            stream("subtitle", "subrip"),
            stream("attachment", "ttf"),
        ]);
        assert!(check_output_matches_source(&source, &all).is_ok());

        for drop in ["audio", "subtitle", "attachment"] {
            let mut out = all.clone();
            let pos = out.streams.iter().position(|s| s.codec_type == drop).unwrap();
            out.streams.remove(pos);
            let err = check_output_matches_source(&source, &out).unwrap_err();
            assert!(err.contains("足りません"), "{drop}: {err}");
        }
    }

    #[test]
    fn check_allows_dropping_cover_art() {
        let mut cover = stream("video", "mjpeg");
        cover.attached_pic = true;
        let source = probe(60.0, vec![stream("video", "h264"), stream("audio", "aac"), cover]);
        let output = probe(60.0, vec![stream("video", "av1"), stream("audio", "opus")]);
        assert!(check_output_matches_source(&source, &output).is_ok());
    }

    // ── ffmpeg の引数 ────────────────────────────────────────────────────────

    fn has_pair(args: &[String], a: &str, b: &str) -> bool {
        args.windows(2).any(|w| w[0] == a && w[1] == b)
    }

    #[test]
    fn ffmpeg_args_map_all_streams_and_fix_subtitles_for_mkv() {
        let source = probe(60.0, vec![
            stream("video", "h264"),
            stream("audio", "aac"),
            stream("audio", "aac"),
            stream("subtitle", "mov_text"),
            stream("subtitle", "hdmv_pgs_subtitle"),
        ]);
        let args = av1_args(&source, 32, 8);
        for m in ["0:V", "0:a?", "0:s?", "0:t?"] {
            assert!(has_pair(&args, "-map", m), "-map {m}");
        }
        assert!(has_pair(&args, "-c:v", "libsvtav1"));
        assert!(has_pair(&args, "-crf", "32"));
        assert!(has_pair(&args, "-preset", "8"));
        assert!(has_pair(&args, "-c:s:0", "srt"), "mov_text は SRT に");
        assert!(has_pair(&args, "-c:s:1", "copy"), "画像字幕はコピー");
        assert!(!args.iter().any(|a| a == "-c:t"), "添付ファイルが無ければ指定しない");
        assert!(has_pair(&args, "-i", "/in.mp4"));
        assert_eq!(args.last().map(String::as_str), Some("/out.tmp"));
    }

    #[test]
    fn ffmpeg_args_copy_attachments_when_present() {
        let source = probe(60.0, vec![stream("video", "h264"), stream("attachment", "ttf")]);
        let args = av1_args(&source, 30, 5);
        assert!(has_pair(&args, "-c:t", "copy"));
    }

    // ── 変換効果の見込み ─────────────────────────────────────────────────────

    #[test]
    fn estimate_flags_av1_low_bitrate_and_worth() {
        // 1080p30 H.264 8 Mbps → bpp ≈ 0.129
        let worth = estimate_from_probe(&probe(60.0, vec![video("h264", 1920, 1080, 30.0, Some(8_000_000))]), None, Encoders::default());
        assert_eq!(worth.verdict, TranscodeVerdict::Worth);
        assert!((worth.bits_per_pixel.unwrap() - 0.1286).abs() < 0.001);

        // 1080p30 H.264 1.5 Mbps → bpp ≈ 0.024
        let low = estimate_from_probe(&probe(60.0, vec![video("h264", 1920, 1080, 30.0, Some(1_500_000))]), None, Encoders::default());
        assert_eq!(low.verdict, TranscodeVerdict::LowBitrate);

        let av1 = estimate_from_probe(&probe(60.0, vec![video("av1", 1920, 1080, 30.0, Some(8_000_000))]), None, Encoders::default());
        assert_eq!(av1.verdict, TranscodeVerdict::AlreadyAv1);

        let unknown = estimate_from_probe(&probe(60.0, vec![stream("video", "h264")]), None, Encoders::default());
        assert_eq!(unknown.verdict, TranscodeVerdict::Unknown);
    }

    #[test]
    fn estimate_accounts_for_hevc_efficiency() {
        // HEVC 1.2 Mbps: 実測 bpp ≈ 0.019 だが H.264 換算では ≈ 0.032 → 縮む余地あり
        let e = estimate_from_probe(&probe(60.0, vec![video("hevc", 1920, 1080, 30.0, Some(1_200_000))]), None, Encoders::default());
        assert_eq!(e.verdict, TranscodeVerdict::Worth);
        // 同じビットレートの H.264 は低ビットレート扱い
        let e = estimate_from_probe(&probe(60.0, vec![video("h264", 1920, 1080, 30.0, Some(1_200_000))]), None, Encoders::default());
        assert_eq!(e.verdict, TranscodeVerdict::LowBitrate);
    }

    #[test]
    fn video_bitrate_falls_back_to_container_minus_audio() {
        let mut a = stream("audio", "aac");
        a.bit_rate = Some(192_000);
        let mut p = probe(100.0, vec![video("h264", 1280, 720, 30.0, None), a, stream("audio", "ac3")]);
        p.bit_rate = Some(5_000_000);
        // 5 Mbps - 192 kbps - 128 kbps (不明な音声の見込み)
        assert_eq!(video_bitrate(&p, None), Some(4_680_000.0));
        // コンテナにも無ければファイルサイズ ÷ 再生時間 (100 MB / 100 秒 = 8 Mbps)
        p.bit_rate = None;
        assert_eq!(video_bitrate(&p, Some(100_000_000)), Some(8_000_000.0 - 320_000.0));
    }

    #[test]
    fn video_summary_takes_main_video_and_skips_cover_art() {
        let mut cover = video("mjpeg", 600, 600, 1.0, None);
        cover.attached_pic = true;
        let p = probe(10.0, vec![cover, video("hevc", 3840, 2160, 60.0, Some(40_000_000)), stream("audio", "aac")]);
        let s = video_summary(&p, None);
        assert_eq!(s.codec.as_deref(), Some("hevc"));
        assert_eq!((s.width, s.height, s.fps), (Some(3840), Some(2160), Some(60.0)));
        assert_eq!(s.bitrate, Some(40_000_000.0));
        // 映像がなければ何も分からない
        assert_eq!(video_summary(&probe(10.0, vec![stream("audio", "aac")]), None), VideoSummary::default());
    }

    #[test]
    fn keeps_output_only_when_it_saves_enough() {
        assert!(is_worth_keeping(1000, 850, 0.15));
        assert!(!is_worth_keeping(1000, 851, 0.15));
        assert!(!is_worth_keeping(1000, 1200, 0.15));
        assert!(!is_worth_keeping(0, 0, 0.15));
        // トラック整理は縮んでいれば残すが、同じか大きければ残さない
        assert!(is_worth_keeping(1000, 999, 0.0));
        assert!(!is_worth_keeping(1000, 1000, 0.0));
    }

    #[test]
    fn outcome_serializes_with_status_tag() {
        let done = serde_json::to_value(TranscodeOutcome::Done { output_path: "/a.av1.mkv".into() }).unwrap();
        assert_eq!(done, serde_json::json!({"status": "done", "outputPath": "/a.av1.mkv"}));
        let discarded = serde_json::to_value(TranscodeOutcome::Discarded { input_bytes: 10, output_bytes: 9 }).unwrap();
        assert_eq!(discarded, serde_json::json!({"status": "discarded", "inputBytes": 10, "outputBytes": 9}));
    }

    // ── モード ───────────────────────────────────────────────────────────────

    #[test]
    fn modes_deserialize_from_frontend_json() {
        let m: TranscodeMode = serde_json::from_value(serde_json::json!({"kind": "av1", "crf": 32, "preset": 8})).unwrap();
        assert_eq!(m, TranscodeMode::Av1 { crf: 32, preset: 8 });
        let m: TranscodeMode = serde_json::from_value(serde_json::json!({"kind": "hevc", "bitratePercent": 50})).unwrap();
        assert_eq!(m.suffix(), "hevc");
        let m: TranscodeMode = serde_json::from_value(serde_json::json!({"kind": "audio"})).unwrap();
        assert_eq!(m, TranscodeMode::Audio);
        let m: TranscodeMode = serde_json::from_value(serde_json::json!(
            {"kind": "remux", "streams": [0, 1], "trimStart": 10.0, "trimEnd": null}
        ))
        .unwrap();
        assert_eq!(m, TranscodeMode::Remux { streams: vec![0, 1], trim_start: Some(10.0), trim_end: None });
    }

    #[test]
    fn modes_reject_out_of_range_values() {
        assert!(TranscodeMode::Av1 { crf: 64, preset: 8 }.validate().is_err());
        assert!(TranscodeMode::Hevc { bitrate_percent: 5 }.validate().is_err());
        assert!(TranscodeMode::Hevc { bitrate_percent: 50 }.validate().is_ok());
        let bad = TranscodeMode::Remux { streams: vec![0], trim_start: Some(-1.0), trim_end: None };
        assert!(bad.validate().is_err());
        assert!(TranscodeMode::DropStreams { streams: vec![] }.validate().is_err());
    }

    #[test]
    fn drop_streams_keeps_everything_else_and_rejects_non_audio() {
        let m: TranscodeMode = serde_json::from_value(serde_json::json!({"kind": "dropStreams", "streams": [2]})).unwrap();
        assert_eq!(m.suffix(), "slim");
        let mut data = stream("data", "bin_data");
        data.codec_type = "data".into();
        let src = probe(
            60.0,
            vec![
                video("h264", 1920, 1080, 30.0, None),
                audio("aac", 2, "stereo", Some(128_000)),
                audio("aac", 2, "stereo", Some(128_000)),
                stream("subtitle", "subrip"),
                data,
            ],
        );
        assert_eq!(
            m.clone().resolve(&src).unwrap(),
            TranscodeMode::Remux { streams: vec![0, 1, 3], trim_start: None, trim_end: None }
        );
        // 外すと音声 1 本・映像 1 本などが残るので、そのまま検証できる
        let resolved = m.resolve(&src).unwrap();
        assert_eq!(expectation(&resolved, &src).unwrap().counts.audio, 1);

        // 映像や存在しない番号は外せない
        assert!(TranscodeMode::DropStreams { streams: vec![0] }.resolve(&src).is_err());
        assert!(TranscodeMode::DropStreams { streams: vec![9] }.resolve(&src).is_err());
        // 他のモードは変わらない
        assert_eq!(TranscodeMode::Audio.resolve(&src).unwrap(), TranscodeMode::Audio);
    }

    #[test]
    fn parse_probe_json_reads_index_channels_and_mkv_bps_tag() {
        let json = br#"{
            "streams": [
                {"index":0,"codec_type":"video","codec_name":"hevc","pix_fmt":"yuv420p10le","disposition":{"attached_pic":0}},
                {"index":1,"codec_type":"audio","codec_name":"ac3","channels":6,"channel_layout":"5.1(side)",
                 "disposition":{"attached_pic":0},"tags":{"language":"jpn","title":"Main","BPS-eng":"640000"}},
                {"index":2,"codec_type":"subtitle","codec_name":"ass","tags":{"language":"und"}}
            ],
            "format": {"duration":"60.0"}
        }"#;
        let p = parse_probe_json(json).unwrap();
        assert!(p.streams[0].is_high_bit_depth());
        let a = &p.streams[1];
        assert_eq!((a.index, a.channels, a.bit_rate), (1, Some(6), Some(640_000)));
        assert_eq!(a.language.as_deref(), Some("jpn"));
        assert_eq!(a.title.as_deref(), Some("Main"));
        assert_eq!(p.streams[2].language, None, "und は言語なし");
    }

    // ── 音声の変換方針 ───────────────────────────────────────────────────────

    #[test]
    fn audio_plan_encodes_lossless_and_heavy_audio_but_copies_efficient_audio() {
        let p = probe(60.0, vec![
            video("h264", 1920, 1080, 30.0, None),
            audio("pcm_s16le", 2, "stereo", Some(1_536_000)),
            audio("aac", 2, "stereo", Some(320_000)),
            audio("aac", 2, "stereo", Some(128_000)),
            audio("aac", 2, "stereo", None),
            audio("opus", 2, "stereo", Some(400_000)),
            audio("flac", 6, "5.1", None),
            audio("truehd", 8, "7.1", None),
        ]);
        let kbps: Vec<Option<u32>> = audio_plan(&p).iter().map(|a| a.opus_kbps).collect();
        assert_eq!(kbps, vec![Some(128), Some(128), None, None, None, Some(288), Some(384)]);
    }

    #[test]
    fn audio_saving_counts_only_known_bitrates() {
        let p = probe(100.0, vec![
            video("h264", 1920, 1080, 30.0, None),
            audio("pcm_s16le", 2, "stereo", Some(1_528_000)),
            audio("flac", 2, "stereo", None),
        ]);
        // (1528 - 128) kbps × 100 秒 = 17.5 MB
        assert_eq!(audio_saving_bytes(&p, &audio_plan(&p)), 17_500_000);
    }

    #[test]
    fn audio_mode_copies_video_and_fixes_side_layouts_for_opus() {
        let p = probe(60.0, vec![
            video("h264", 1920, 1080, 30.0, None),
            audio("ac3", 6, "5.1(side)", Some(640_000)),
            audio("aac", 2, "stereo", Some(128_000)),
        ]);
        let args = build_ffmpeg_args("/in.mkv", "/out.tmp", &TranscodeMode::Audio, &p, None, SVT).unwrap();
        assert!(has_pair(&args, "-c:v", "copy"));
        assert!(has_pair(&args, "-c:a:0", "libopus"));
        assert!(has_pair(&args, "-b:a:0", "288k"));
        assert!(has_pair(&args, "-filter:a:0", "aformat=channel_layouts=5.1"));
        assert!(has_pair(&args, "-c:a:1", "copy"));
        assert!(!args.iter().any(|a| a == "-filter:a:1"));
    }

    #[test]
    fn audio_mode_is_refused_when_nothing_would_shrink() {
        let p = probe(60.0, vec![video("h264", 1920, 1080, 30.0, None), audio("opus", 2, "stereo", None)]);
        assert!(expectation(&TranscodeMode::Audio, &p).is_err());
    }

    // ── AV1 エンコーダーの選択 ───────────────────────────────────────────────

    #[test]
    fn encoders_prefer_svt_and_fall_back_to_aom() {
        let header = " V..... = Video\n A..... = Audio\n ------\n";
        let svt = format!("{header} V....D libaom-av1           libaom AV1 (codec av1)\n V....D libsvtav1            SVT-AV1(Scalable Video Technology for AV1) encoder (codec av1)\n V....D hevc_videotoolbox    VideoToolbox H.265 Encoder (codec hevc)\n");
        assert_eq!(Encoders::parse(&svt), Encoders { av1: Some(Av1Encoder::Svt), hevc: true });

        let aom = format!("{header} V....D libaom-av1           libaom AV1 (codec av1)\n A....D wmav1                Windows Media Audio 1\n");
        assert_eq!(Encoders::parse(&aom), Encoders { av1: Some(Av1Encoder::Aom), hevc: false });

        // デコーダーだけ (名前の一部が一致するだけ) では使えるとみなさない
        let none = format!("{header} V....D libx264              libx264 H.264\n A....D wmav1                Windows Media Audio 1\n");
        assert_eq!(Encoders::parse(&none), Encoders::default());
    }

    #[test]
    fn av1_args_with_libaom_use_constant_quality_and_mapped_speed() {
        let source = probe(60.0, vec![stream("video", "h264"), stream("audio", "aac")]);
        let args = build_ffmpeg_args("/in.mp4", "/out.tmp", &TranscodeMode::Av1 { crf: 32, preset: 8 }, &source, None, AOM).unwrap();
        assert!(has_pair(&args, "-c:v", "libaom-av1"));
        assert!(has_pair(&args, "-crf", "32"));
        assert!(has_pair(&args, "-b:v", "0"), "画質固定にするには -b:v 0 が必要");
        assert!(has_pair(&args, "-cpu-used", "6"));
        assert!(has_pair(&args, "-row-mt", "1"));
        assert!(!args.iter().any(|a| a == "-preset"), "libaom に -preset はない");
        for m in ["0:V", "0:a?", "0:s?", "0:t?"] {
            assert!(has_pair(&args, "-map", m), "-map {m}");
        }
    }

    #[test]
    fn record_discarded_upserts_by_path_and_ignores_unknown_files() {
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        crate::db::schema::init_db(&conn).unwrap();
        conn.execute("INSERT INTO videos (path, file_size) VALUES ('/m/a.mp4', 100)", []).unwrap();
        let rows = || -> Vec<(String, String, i64)> {
            let mut stmt = conn
                .prepare("SELECT mode, file_key, output_bytes FROM media_transcode_discarded ORDER BY mode")
                .unwrap();
            stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?))).unwrap().map(|r| r.unwrap()).collect()
        };
        record_discarded(&conn, "/m/a.mp4", "av1", "100:1", 100, 95).unwrap();
        record_discarded(&conn, "/m/a.mp4", "av1", "100:2", 100, 97).unwrap();
        record_discarded(&conn, "/m/a.mp4", "hevc", "100:2", 100, 99).unwrap();
        record_discarded(&conn, "/m/unknown.mp4", "av1", "1:1", 1, 1).unwrap();
        assert_eq!(rows(), vec![("av1".into(), "100:2".into(), 97), ("hevc".into(), "100:2".into(), 99)]);
        assert_eq!(TranscodeMode::Audio.reencode_kind(), None);
        assert_eq!(TranscodeMode::Hevc { bitrate_percent: 50 }.reencode_kind(), Some("hevc"));
    }

    #[test]
    fn svt_without_avx2_adds_asm_param_only_on_retry() {
        let source = probe(60.0, vec![stream("video", "h264")]);
        let mode = TranscodeMode::Av1 { crf: 32, preset: 8 };
        let normal = build_ffmpeg_args("/in.mp4", "/out.tmp", &mode, &source, None, SVT).unwrap();
        assert!(!normal.iter().any(|a| a == "-svtav1-params"));
        let no_avx2 = Encoders { av1: Some(Av1Encoder::SvtNoAvx2), ..SVT };
        let retry = build_ffmpeg_args("/in.mp4", "/out.tmp", &mode, &source, None, no_avx2).unwrap();
        assert!(has_pair(&retry, "-c:v", "libsvtav1"));
        assert!(has_pair(&retry, "-svtav1-params", "asm=avx"));
    }

    #[cfg(unix)]
    #[test]
    fn crash_signal_ignores_kill() {
        use std::os::unix::process::ExitStatusExt;
        use std::process::ExitStatus;
        assert_eq!(crash_signal(&ExitStatus::from_raw(11)), Some(11)); // SIGSEGV
        assert_eq!(crash_signal(&ExitStatus::from_raw(9)), None); // SIGKILL
        assert_eq!(crash_signal(&ExitStatus::from_raw(15)), None); // SIGTERM
        assert_eq!(crash_signal(&ExitStatus::from_raw(1 << 8)), None); // exit 1
    }

    #[test]
    fn svt_presets_map_to_aom_speeds() {
        assert_eq!(aom_cpu_used(13), 6);
        assert_eq!(aom_cpu_used(8), 6);
        assert_eq!(aom_cpu_used(5), 5);
        assert_eq!(aom_cpu_used(3), 4);
        assert_eq!(aom_cpu_used(0), 4);
    }

    #[test]
    fn av1_is_refused_without_an_av1_encoder() {
        let source = probe(60.0, vec![stream("video", "h264")]);
        let mode = TranscodeMode::Av1 { crf: 32, preset: 8 };
        let none = Encoders { av1: None, hevc: true };
        assert!(build_ffmpeg_args("/in.mp4", "/out.tmp", &mode, &source, None, none).is_err());
    }

    #[test]
    fn estimate_reports_available_encoders() {
        let p = probe(60.0, vec![video("h264", 1920, 1080, 30.0, Some(8_000_000))]);
        let e = estimate_from_probe(&p, None, AOM);
        assert_eq!(e.av1_encoder, Some(Av1Encoder::Aom));
        assert!(e.hevc_available);
        let json = serde_json::to_value(&e).unwrap();
        assert_eq!(json["av1Encoder"], "aom");
        assert_eq!(serde_json::to_value(estimate_from_probe(&p, None, Encoders::default())).unwrap()["av1Encoder"], serde_json::Value::Null);
    }

    // ── HEVC ─────────────────────────────────────────────────────────────────

    #[test]
    fn hevc_args_use_bitrate_ratio_and_explicit_pixel_format() {
        let p = probe(60.0, vec![video("h264", 1920, 1080, 30.0, Some(8_000_000))]);
        let mode = TranscodeMode::Hevc { bitrate_percent: 40 };
        let args = build_ffmpeg_args("/in.mp4", "/out.tmp", &mode, &p, None, SVT).unwrap();
        assert!(has_pair(&args, "-c:v", "hevc_videotoolbox"));
        assert!(has_pair(&args, "-b:v", "3200000"));
        assert!(has_pair(&args, "-pix_fmt", "nv12"));

        let mut ten = video("hevc", 3840, 2160, 24.0, Some(20_000_000));
        ten.pix_fmt = Some("yuv420p10le".into());
        let args = build_ffmpeg_args("/in.mkv", "/out.tmp", &mode, &probe(60.0, vec![ten]), None, SVT).unwrap();
        assert!(has_pair(&args, "-pix_fmt", "p010le"));
        assert!(has_pair(&args, "-profile:v", "main10"));

        // 元のビットレートが極端に低くても下限を守る
        let low = probe(60.0, vec![video("h264", 320, 240, 30.0, Some(200_000))]);
        let args = build_ffmpeg_args("/in.mp4", "/out.tmp", &mode, &low, None, SVT).unwrap();
        assert!(has_pair(&args, "-b:v", "300000"));
    }

    // ── トラック整理・切り詰め ───────────────────────────────────────────────

    fn remux_source() -> ProbeInfo {
        let mut cover = stream("video", "mjpeg");
        cover.attached_pic = true;
        probe(600.0, vec![
            video("h264", 1920, 1080, 30.0, None),
            audio("aac", 2, "stereo", None),
            audio("aac", 2, "stereo", None),
            stream("subtitle", "mov_text"),
            cover,
            stream("data", "bin_data"),
        ])
    }

    fn remux(streams: Vec<usize>, start: Option<f64>, end: Option<f64>) -> TranscodeMode {
        TranscodeMode::Remux { streams, trim_start: start, trim_end: end }
    }

    #[test]
    fn remux_args_map_only_kept_streams_and_trim_by_copy() {
        let src = remux_source();
        let mode = remux(vec![0, 1, 3], Some(30.0), Some(90.0));
        let args = build_ffmpeg_args("/in.mp4", "/out.tmp", &mode, &src, None, SVT).unwrap();
        let maps: Vec<&str> = args.windows(2).filter(|w| w[0] == "-map").map(|w| w[1].as_str()).collect();
        assert_eq!(maps, vec!["0:0", "0:1", "0:3"]);
        assert!(has_pair(&args, "-c", "copy"));
        assert!(has_pair(&args, "-c:s:0", "srt"));
        assert!(has_pair(&args, "-ss", "30.000"));
        assert!(has_pair(&args, "-t", "60.000"));
        // -ss は入力の前 (キーフレームへの高速シーク)
        let ss = args.iter().position(|a| a == "-ss").unwrap();
        let i = args.iter().position(|a| a == "-i").unwrap();
        assert!(ss < i);
    }

    #[test]
    fn remux_expectation_validates_choices() {
        let src = remux_source();
        // 映像を外すことはできない
        assert!(expectation(&remux(vec![1, 2], None, None), &src).is_err());
        // 何も変わらない
        assert!(expectation(&remux(vec![0, 1, 2, 3, 4], None, None), &src).is_err());
        // データトラックは残せない
        assert!(expectation(&remux(vec![0, 5], None, None), &src).is_err());
        // 存在しないトラック
        assert!(expectation(&remux(vec![0, 9], None, None), &src).is_err());
        // 短すぎる
        assert!(expectation(&remux(vec![0, 1, 2, 3, 4], Some(10.0), Some(10.5)), &src).is_err());

        let e = expectation(&remux(vec![0, 2], None, None), &src).unwrap();
        assert_eq!(e.counts, StreamCounts { video: 1, audio: 1, subtitle: 0, attachment: 0 });
        assert_eq!(e.duration, 600.0);
        // 切り詰めだけでもよい
        let e = expectation(&remux(vec![0, 1, 2, 3, 4], Some(100.0), None), &src).unwrap();
        assert_eq!((e.duration, e.extra_allowed), (500.0, KEYFRAME_SLACK_SECS));
    }

    #[test]
    fn check_output_allows_keyframe_slack_only_when_head_is_trimmed() {
        let out = |d: f64| probe(d, vec![video("h264", 1920, 1080, 30.0, None)]);
        let counts = StreamCounts { video: 1, audio: 0, subtitle: 0, attachment: 0 };
        let trimmed = Expectation { counts, duration: 60.0, extra_allowed: KEYFRAME_SLACK_SECS };
        assert!(check_output(&trimmed, &out(70.0)).is_ok());
        assert!(check_output(&trimmed, &out(80.0)).is_err());
        assert!(check_output(&trimmed, &out(55.0)).is_err());
        let whole = Expectation { extra_allowed: 0.0, ..trimmed };
        assert!(check_output(&whole, &out(70.0)).is_err());
    }

    // ── 実際の ffmpeg での確認 (`cargo test -- --ignored` で実行) ─────────────

    /// テスト用の動画を作る: 映像 + PCM 5.1(side) 音声 + AAC ステレオ音声 (ノイズで高ビットレート) + SRT 字幕
    fn make_sample(dir: &Path) -> String {
        std::fs::create_dir_all(dir).unwrap();
        let srt = dir.join("sub.srt");
        std::fs::write(&srt, "1\n00:00:00,000 --> 00:00:05,000\nhello\n").unwrap();
        let out = dir.join("sample.mkv");
        let status = Command::new("ffmpeg")
            .args(["-hide_banner", "-loglevel", "error", "-y"])
            .args(["-f", "lavfi", "-i", "testsrc2=size=640x360:rate=30"])
            .args(["-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000,aformat=channel_layouts=5.1(side)"])
            .args(["-f", "lavfi", "-i", "anoisesrc=color=pink:sample_rate=48000,aformat=channel_layouts=stereo"])
            .arg("-i")
            .arg(&srt)
            .args(["-map", "0", "-map", "1", "-map", "2", "-map", "3", "-t", "20"])
            .args(["-c:v", "libx264", "-g", "60", "-b:v", "4M", "-c:a:0", "pcm_s16le", "-c:a:1", "aac", "-b:a:1", "320k"])
            .args(["-c:s", "srt"])
            .arg(&out)
            .status()
            .unwrap();
        assert!(status.success(), "サンプルの作成に失敗");
        out.to_string_lossy().into_owned()
    }

    async fn run_mode(input: &str, mode: TranscodeMode, encoders: Encoders) -> (ProbeInfo, Result<(), String>) {
        let source = probe_source("ffprobe", input).await.unwrap();
        let mode = mode.resolve(&source).unwrap();
        let expected = expectation(&mode, &source).unwrap();
        let output = format!("{input}.{}.mkv", mode.suffix());
        let size = std::fs::metadata(input).ok().map(|m| m.len());
        let args = build_ffmpeg_args(input, &output, &mode, &source, size, encoders).unwrap();
        let out = Command::new("ffmpeg").args(&args).stdout(Stdio::null()).output().unwrap();
        assert!(out.status.success(), "{mode:?}: {}", String::from_utf8_lossy(&out.stderr));
        let info = probe_media("ffprobe", &output).await.unwrap();
        let checked = check_output(&expected, &info);
        (info, checked)
    }

    #[tokio::test]
    #[ignore = "ffmpeg が必要"]
    async fn real_ffmpeg_all_modes() {
        let dir = std::env::temp_dir().join(format!("css-transcode-it-{}", std::process::id()));
        let input = make_sample(&dir);
        let encoders = detect_encoders("ffmpeg").await;

        // 音声だけ: PCM 5.1(side) は Opus に、320k の AAC も Opus に、映像はコピー
        let (info, checked) = run_mode(&input, TranscodeMode::Audio, encoders).await;
        checked.unwrap();
        let codecs: Vec<&str> = info.streams.iter().map(|s| s.codec_name.as_str()).collect();
        assert_eq!(codecs, vec!["h264", "opus", "opus", "subrip"]);

        // AV1: この ffmpeg にある AV1 エンコーダーそれぞれで (SVT-AV1 と libaom の両方があれば両方)
        let list = Command::new("ffmpeg").args(["-hide_banner", "-encoders"]).output().unwrap();
        let list = String::from_utf8_lossy(&list.stdout);
        let av1_encoders: Vec<Av1Encoder> = [("libsvtav1", Av1Encoder::Svt), ("libaom-av1", Av1Encoder::Aom)]
            .into_iter()
            .filter(|(name, _)| encoder_listed(&list, name))
            .map(|(_, enc)| enc)
            .collect();
        assert!(!av1_encoders.is_empty(), "AV1 のエンコーダーがない ffmpeg");
        for enc in av1_encoders {
            let mode = TranscodeMode::Av1 { crf: 40, preset: 12 };
            let (info, checked) = run_mode(&input, mode, Encoders { av1: Some(enc), ..encoders }).await;
            checked.unwrap_or_else(|e| panic!("{enc:?}: {e}"));
            assert_eq!(info.main_video().unwrap().codec_name, "av1", "{enc:?}");
        }

        // HEVC (VideoToolbox がある Mac だけ)
        if encoders.hevc {
            let (info, checked) = run_mode(&input, TranscodeMode::Hevc { bitrate_percent: 50 }, encoders).await;
            checked.unwrap();
            assert_eq!(info.main_video().unwrap().codec_name, "hevc");
        }

        // トラック整理と切り詰め: PCM 音声を外し、5 秒目から 10 秒分
        let (info, checked) = run_mode(&input, TranscodeMode::Remux {
            streams: vec![0, 2, 3],
            trim_start: Some(5.0),
            trim_end: Some(15.0),
        }, encoders)
        .await;
        checked.unwrap();
        let codecs: Vec<&str> = info.streams.iter().map(|s| s.codec_name.as_str()).collect();
        assert_eq!(codecs, vec!["h264", "aac", "subrip"]);
        assert!((info.duration - 10.0).abs() < 3.0, "長さ {}", info.duration);

        // 指定した音声トラックだけ外す: AAC (#2) を外し、残りはそのまま
        let (info, checked) = run_mode(&input, TranscodeMode::DropStreams { streams: vec![2] }, encoders).await;
        checked.unwrap();
        let codecs: Vec<&str> = info.streams.iter().map(|s| s.codec_name.as_str()).collect();
        assert_eq!(codecs, vec!["h264", "pcm_s16le", "subrip"]);

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn bitrate_is_measured_from_packet_sizes() {
        let json = br#"{"packets":[
            {"pts_time":"0.000","size":"4000"},
            {"pts_time":"1.000","size":"4000"},
            {"pts_time":"2.000","size":"4000"}
        ]}"#;
        // 12000 バイト ÷ 2 秒 = 48 kbps
        assert_eq!(bitrate_from_packets(json), Some(48_000));
        assert_eq!(bitrate_from_packets(br#"{"packets":[{"pts_time":"0.0","size":"10"}]}"#), None, "短すぎる");
    }
}
