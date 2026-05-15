use std::io::{BufRead, BufReader};
use std::path::Path;
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use serde::Serialize;
use tauri::Emitter;

use super::settings::SharedAppSettings;

#[derive(Clone, Serialize)]
pub struct TranscodeProgress {
    pub percent: f64,
    pub speed: String,
    pub elapsed_secs: f64,
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
) -> Result<String, String> {
    state.cancel_flag.store(false, Ordering::SeqCst);

    let ffmpeg_path = {
        let s = app_settings.lock().map_err(|e| e.to_string())?;
        s.ffmpeg_path.clone()
    };

    let input = Path::new(&input_path);
    let stem = input
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("output");
    let dir = input.parent().unwrap_or(Path::new("."));
    let output_path = dir.join(format!("{stem}.av1.mkv"));
    let output_str = output_path.to_string_lossy().to_string();

    {
        let mut p = state.current_output.lock().map_err(|e| e.to_string())?;
        *p = Some(output_str.clone());
    }

    let cancel_flag = state.cancel_flag.clone();
    let current_output = state.current_output.clone();

    let result = tokio::task::spawn_blocking({
        let app = app.clone();
        let input_path = input_path.clone();
        let output_str = output_str.clone();
        move || -> Result<(), String> {
            let mut child = Command::new(&ffmpeg_path)
                .args([
                    "-y",
                    "-progress", "pipe:1",
                    "-nostats",
                    "-i", &input_path,
                    "-c:v", "libsvtav1",
                    "-crf", "32",
                    "-preset", "8",
                    "-c:a", "libopus",
                    "-b:a", "128k",
                    &output_str,
                ])
                .stdout(Stdio::piped())
                .stderr(Stdio::null())
                .spawn()
                .map_err(|e| format!("FFmpeg 起動失敗: {e}"))?;

            let stdout = child.stdout.take().expect("stdout not captured");
            let reader = BufReader::new(stdout);

            let start = std::time::Instant::now();
            let mut out_time_us: u64 = 0;
            let mut speed = "N/A".to_string();

            for line in reader.lines() {
                if cancel_flag.load(Ordering::SeqCst) {
                    child.kill().ok();
                    child.wait().ok();
                    let _ = std::fs::remove_file(&output_str);
                    return Err("キャンセルされました".to_string());
                }

                let line = line.map_err(|e| e.to_string())?;

                if let Some(val) = line.strip_prefix("out_time_us=") {
                    out_time_us = val.trim().parse().unwrap_or(0);
                } else if let Some(val) = line.strip_prefix("speed=") {
                    speed = val.trim().to_string();
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
                        },
                    );
                }
            }

            let status = child.wait().map_err(|e| e.to_string())?;
            if !status.success() {
                let _ = std::fs::remove_file(&output_str);
                return Err(format!(
                    "FFmpeg がエラーで終了しました (code: {:?})",
                    status.code()
                ));
            }
            Ok(())
        }
    })
    .await
    .map_err(|e| e.to_string())?;

    {
        let mut p = current_output.lock().map_err(|e| e.to_string())?;
        *p = None;
    }

    result?;
    Ok(output_str)
}

#[tauri::command]
pub async fn cancel_transcode(state: tauri::State<'_, TranscodeState>) -> Result<(), String> {
    state.cancel_flag.store(true, Ordering::SeqCst);
    Ok(())
}
