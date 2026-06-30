use std::io::{BufRead, BufReader};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use serde::Serialize;
use tauri::Emitter;

use super::settings::SharedAppSettings;
use super::utils::{resolve_unique_path, validate_video_path};

#[derive(Clone, Serialize)]
pub struct TranscodeProgress {
    pub percent: f64,
    pub speed: String,
    pub elapsed_secs: f64,
    pub frames: u64,
    pub fps: f64,
    pub total_size_bytes: u64,
}

pub struct TranscodeState {
    cancel_flag: Arc<AtomicBool>,
    current_output: Arc<Mutex<Option<String>>>,
}

impl TranscodeState {
    pub fn new() -> Self {
        Self {
            cancel_flag: Arc::new(AtomicBool::new(false)),
            current_output: Arc::new(Mutex::new(None)),
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

    let output_str = output_path.to_string_lossy().to_string();
    let tmp_output_str = tmp_output_path.to_string_lossy().to_string();

    {
        let mut p = state.current_output.lock().map_err(|e| e.to_string())?;
        *p = Some(tmp_output_str.clone());
    }

    let cancel_flag = state.cancel_flag.clone();
    let current_output = state.current_output.clone();

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

            let start = std::time::Instant::now();
            let mut out_time_us: u64 = 0;
            let mut speed = "N/A".to_string();
            let mut frames: u64 = 0;
            let mut fps: f64 = 0.0;
            let mut total_size_bytes: u64 = 0;

            for line in reader.lines() {
                if cancel_flag.load(Ordering::SeqCst) {
                    child.kill().ok();
                    child.wait().ok();
                    let _ = std::fs::remove_file(&tmp_output_str);
                    return Err("キャンセルされました".to_string());
                }

                let line = line.map_err(|e| e.to_string())?;

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
    Ok(output_str)
}

#[tauri::command]
pub async fn cancel_transcode(state: tauri::State<'_, TranscodeState>) -> Result<(), String> {
    state.cancel_flag.store(true, Ordering::SeqCst);
    Ok(())
}
