// yt-dlp 統合: バンドルバイナリ優先・システムインストール fallback

use std::sync::{Arc, Mutex};
use std::sync::atomic::{AtomicBool, Ordering};
use tokio::io::{AsyncBufReadExt, BufReader};
use tauri::{Emitter, Manager};
use serde::Serialize;

use super::settings::SharedAppSettings;

pub struct YtdlpState {
    cancel_flag: Arc<AtomicBool>,
    // キャンセル時にプロセスを kill するため保持
    child: Mutex<Option<tokio::process::Child>>,
}

impl YtdlpState {
    pub fn new() -> Self {
        YtdlpState {
            cancel_flag: Arc::new(AtomicBool::new(false)),
            child: Mutex::new(None),
        }
    }
}

#[derive(Serialize, Clone)]
struct DownloadProgress {
    downloaded: u64,
    total: u64,
    percent: f64,
}

/// yt-dlp バイナリのパスを解決する。
/// 優先順位: ①バンドルバイナリ → ②設定値 → ③PATH
fn get_ytdlp_path(
    app: &tauri::AppHandle,
    settings_path: &str,
) -> Result<std::path::PathBuf, String> {
    let binary_name = if cfg!(windows) { "yt-dlp.exe" } else { "yt-dlp" };

    // 1. バンドルバイナリ: リソースディレクトリ内 (tauri.conf.json の externalBin でバンドル時)
    if let Ok(resource_dir) = app.path().resource_dir() {
        let bundled = resource_dir.join(binary_name);
        if bundled.exists() {
            return Ok(bundled);
        }
    }

    // 2. アプリ実行ファイルと同じディレクトリ (手動配置バンドル用)
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            let sidecar = dir.join(binary_name);
            if sidecar.exists() {
                return Ok(sidecar);
            }
        }
    }

    // 3. 設定で指定されたパス
    if !settings_path.is_empty() {
        let p = std::path::PathBuf::from(settings_path);
        if p.exists() {
            return Ok(p);
        }
        return Err(format!("yt-dlp が見つかりません: {settings_path}"));
    }

    // 4. PATH から検索
    which::which("yt-dlp").map_err(|_| {
        "yt-dlp が見つかりません。設定でパスを指定するか、yt-dlp をインストールしてください。".to_string()
    })
}

/// yt-dlp の stderr 進捗行からパーセントを抽出する。
/// 例: "[download]  23.4% of 15.23MiB at 1.23MiB/s ETA 00:10"
fn parse_ytdlp_progress(line: &str) -> Option<f64> {
    let trimmed = line.trim();
    if !trimmed.starts_with("[download]") {
        return None;
    }
    let after = trimmed["[download]".len()..].trim();
    let pct_end = after.find('%')?;
    after[..pct_end].trim().parse::<f64>().ok()
}

/// yt-dlp でダウンロードする。
/// ファイル名は yt-dlp が自動決定 (%(title)s.%(ext)s)。
/// 完了後、ダウンロードしたファイルの絶対パスを返す。
#[tauri::command]
pub async fn download_with_ytdlp(
    app: tauri::AppHandle,
    state: tauri::State<'_, YtdlpState>,
    settings: tauri::State<'_, SharedAppSettings>,
    url: String,
    save_dir: String,
) -> Result<String, String> {
    // 入力検証 (他の download コマンドと同じ基準で統一)
    super::utils::validate_download_url(&url)?;
    super::utils::validate_path(&save_dir)?;

    // 既存ダウンロードが実行中なら拒否
    {
        let guard = state.child.lock().map_err(|e| e.to_string())?;
        if guard.is_some() {
            return Err("yt-dlp ダウンロードが既に実行中です".to_string());
        }
    }

    state.cancel_flag.store(false, Ordering::SeqCst);

    let ytdlp_path = {
        let s = settings.lock().map_err(|e| e.to_string())?;
        get_ytdlp_path(&app, &s.ytdlp_path)?
    };

    // ダウンロード先ディレクトリを作成
    std::fs::create_dir_all(&save_dir)
        .map_err(|e| format!("ダウンロード先フォルダの作成に失敗: {e}"))?;

    let mut cmd = tokio::process::Command::new(&ytdlp_path);
    cmd.args([
        "--newline",
        "--no-playlist",
        "-P", &save_dir,
        "-o", "%(title)s.%(ext)s",
        "--print", "after_move:filepath",
        &url,
    ])
    .stdout(std::process::Stdio::piped())
    .stderr(std::process::Stdio::piped());

    let mut child = cmd.spawn()
        .map_err(|e| format!("yt-dlp の起動に失敗しました: {e}"))?;

    let stdout = child.stdout.take();
    let stderr = child.stderr.take();
    if stdout.is_none() || stderr.is_none() {
        // Stdio::piped() を指定したので通常は発生しないが、念のためプロセスを終了させる
        child.kill().await.ok();
        return Err("yt-dlp の stdout/stderr の取得に失敗しました".to_string());
    }
    let stdout = stdout.unwrap();
    let stderr = stderr.unwrap();

    // Child を状態に保持（cancel_ytdlp_download で kill するため）
    // mutex が毒状態の場合は回復して続行する（回復しないと child が孤立する）
    {
        let mut guard = match state.child.lock() {
            Ok(g) => g,
            Err(e) => {
                log::error!("[ytdlp] child mutex が毒状態です。ロックを回復して続行します: {e}");
                e.into_inner()
            }
        };
        *guard = Some(child);
    }

    let cancel_flag = Arc::clone(&state.cancel_flag);
    let app_clone = app.clone();

    // stderr を並行して読み、進捗を emit
    let stderr_task = tokio::spawn(async move {
        let mut reader = BufReader::new(stderr).lines();
        let mut last_percent = -1.0f64;
        while let Ok(Some(line)) = reader.next_line().await {
            if cancel_flag.load(Ordering::SeqCst) {
                break;
            }
            if let Some(percent) = parse_ytdlp_progress(&line) {
                if (percent - last_percent).abs() >= 0.5 {
                    last_percent = percent;
                    let _ = app_clone.emit("download://progress", DownloadProgress {
                        downloaded: 0,
                        total: 0,
                        percent,
                    });
                }
            }
        }
    });

    // stdout からダウンロード後のファイルパスを取得 (--print after_move:filepath)
    let mut reader_out = BufReader::new(stdout).lines();
    let mut output_path = String::new();
    while let Ok(Some(line)) = reader_out.next_line().await {
        let trimmed = line.trim().to_string();
        // yt-dlp のログ行は '[' で始まる。ファイルパスのみ '[' で始まらない
        if !trimmed.is_empty() && !trimmed.starts_with('[') {
            output_path = trimmed;
        }
    }

    stderr_task.await.ok();

    // プロセス終了を待つ
    let exit_status = {
        let child_opt = {
            let mut guard = state.child.lock().map_err(|e| e.to_string())?;
            guard.take()
        };
        match child_opt {
            Some(mut c) => c.wait().await.map_err(|e| e.to_string())?,
            None => return Err("キャンセルされました".to_string()),
        }
    };

    if state.cancel_flag.load(Ordering::SeqCst) {
        return Err("キャンセルされました".to_string());
    }

    if !exit_status.success() {
        return Err(format!(
            "yt-dlp が失敗しました (終了コード: {:?})",
            exit_status.code()
        ));
    }

    // 完了 emit
    let _ = app.emit("download://progress", DownloadProgress {
        downloaded: 0,
        total: 0,
        percent: 100.0,
    });

    if output_path.is_empty() {
        return Err("ダウンロードされたファイルのパスを取得できませんでした".to_string());
    }

    Ok(output_path)
}

/// yt-dlp ダウンロードをキャンセルする。
#[tauri::command]
pub async fn cancel_ytdlp_download(
    state: tauri::State<'_, YtdlpState>,
) -> Result<(), String> {
    state.cancel_flag.store(true, Ordering::SeqCst);
    let child_opt = {
        let mut guard = state.child.lock().map_err(|e| e.to_string())?;
        guard.take()
    };
    if let Some(mut c) = child_opt {
        c.kill().await.ok();
    }
    Ok(())
}

/// yt-dlp バイナリを自動検出してパスを返す（設定画面の「自動検出」ボタン用）。
#[tauri::command]
pub async fn detect_ytdlp_path(
    app: tauri::AppHandle,
    settings: tauri::State<'_, SharedAppSettings>,
) -> Result<String, String> {
    let settings_path = {
        let s = settings.lock().map_err(|e| e.to_string())?;
        s.ytdlp_path.clone()
    };
    get_ytdlp_path(&app, &settings_path)
        .map(|p| p.to_string_lossy().to_string())
}
