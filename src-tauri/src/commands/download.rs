use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::sync::Mutex;

use futures_util::StreamExt;
use serde::Serialize;
use tauri::Emitter;
use tokio::io::AsyncWriteExt;

#[derive(Clone, Serialize)]
pub struct DownloadProgress {
    pub downloaded: u64,
    pub total: u64,
    pub percent: u8,
}

pub struct DownloadState {
    cancel_flag: Arc<AtomicBool>,
    // 現在ダウンロード中のファイルパスを保持（キャンセル時の部分ファイル削除用）
    current_path: Mutex<Option<String>>,
}

impl DownloadState {
    pub fn new() -> Self {
        Self {
            cancel_flag: Arc::new(AtomicBool::new(false)),
            current_path: Mutex::new(None),
        }
    }
}

#[tauri::command]
pub async fn download_video(
    app: tauri::AppHandle,
    state: tauri::State<'_, DownloadState>,
    url: String,
    save_path: String,
) -> Result<String, String> {
    // URL 検証 (スキーム・プライベート IP ブロック)
    super::utils::validate_download_url(&url)?;
    // 保存先パス検証 (絶対パス・パストラバーサル禁止)
    super::utils::validate_path(&save_path)?;

    state.cancel_flag.store(false, Ordering::SeqCst);

    // 同名ファイルが存在する場合は連番サフィックスで一意パスに解決する
    let actual_path = super::utils::resolve_unique_path(std::path::Path::new(&save_path));
    let actual_path_str = actual_path.to_string_lossy().into_owned();

    {
        let mut p = state.current_path.lock().map_err(|e| e.to_string())?;
        *p = Some(actual_path_str.clone());
    }

    let client = reqwest::Client::builder()
        .user_agent("Mozilla/5.0 chuck-snap-stack/0.1")
        .build()
        .map_err(|e| e.to_string())?;

    let response = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("接続失敗: {e}"))?;

    if !response.status().is_success() {
        return Err(format!("HTTP エラー: {}", response.status()));
    }

    let total = response.content_length().unwrap_or(0);

    if let Some(parent) = actual_path.parent() {
        tokio::fs::create_dir_all(parent)
            .await
            .map_err(|e| e.to_string())?;
    }

    // create_new でファイルを作成する: 解決済みパスなので既存ファイルは存在しないはず
    let mut file = tokio::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&actual_path)
        .await
        .map_err(|e| format!("ファイル作成失敗: {e}"))?;

    let mut stream = response.bytes_stream();
    let mut downloaded: u64 = 0;
    let mut last_percent: u8 = u8::MAX;

    let _ = app.emit(
        "download://progress",
        DownloadProgress { downloaded: 0, total, percent: 0 },
    );

    while let Some(chunk) = stream.next().await {
        if state.cancel_flag.load(Ordering::SeqCst) {
            drop(file);
            // このアプリが作成したファイルのみを削除する (既存ファイルは上書きしていない)
            let _ = tokio::fs::remove_file(&actual_path).await;
            {
                let mut p = state.current_path.lock().map_err(|e| e.to_string())?;
                *p = None;
            }
            return Err("キャンセルされました".to_string());
        }

        let chunk = chunk.map_err(|e| format!("読み込みエラー: {e}"))?;
        file.write_all(&chunk)
            .await
            .map_err(|e| format!("書き込みエラー: {e}"))?;
        downloaded += chunk.len() as u64;

        let percent = if total > 0 {
            ((downloaded * 100) / total).min(100) as u8
        } else {
            0
        };

        if percent != last_percent {
            last_percent = percent;
            let _ = app.emit(
                "download://progress",
                DownloadProgress { downloaded, total, percent },
            );
        }
    }

    file.flush().await.map_err(|e| e.to_string())?;

    {
        let mut p = state.current_path.lock().map_err(|e| e.to_string())?;
        *p = None;
    }

    let _ = app.emit(
        "download://progress",
        DownloadProgress { downloaded, total, percent: 100 },
    );

    Ok(actual_path_str)
}

#[tauri::command]
pub async fn cancel_download(state: tauri::State<'_, DownloadState>) -> Result<(), String> {
    state.cancel_flag.store(true, Ordering::SeqCst);
    Ok(())
}
