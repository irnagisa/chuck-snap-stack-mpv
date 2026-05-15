// mpv プロセス管理・IPC コマンド

use std::{
    io::{BufRead, BufReader, Write},
    os::unix::net::UnixStream,
    process::{Child, Command},
    sync::{Arc, Mutex},
    time::Duration,
};

use serde_json::{json, Value};

use super::settings::SharedAppSettings;

const MPV_SOCKET: &str = "/tmp/mpv-chuck-socket";

// ----- 共有状態 -----

pub struct MpvState {
    process: Option<Child>,
}

pub type SharedMpvState = Arc<Mutex<MpvState>>;

impl MpvState {
    pub fn new() -> SharedMpvState {
        Arc::new(Mutex::new(MpvState { process: None }))
    }
}

// ----- IPC ヘルパー -----

/// コマンドを送信し、mpv からの最初のレスポンス行を返す。
/// イベント行 ({"event": ...}) はスキップする。
fn send_ipc(cmd: Value) -> Result<Value, String> {
    let mut stream =
        UnixStream::connect(MPV_SOCKET).map_err(|e| format!("IPC 接続失敗: {e}"))?;
    let msg = cmd.to_string() + "\n";
    stream.write_all(msg.as_bytes()).map_err(|e| e.to_string())?;

    let mut reader = BufReader::new(&stream);
    loop {
        let mut line = String::new();
        reader.read_line(&mut line).map_err(|e| e.to_string())?;
        if line.is_empty() {
            return Err("mpv からの応答なし".to_string());
        }
        let val: Value =
            serde_json::from_str(line.trim()).map_err(|e| e.to_string())?;
        if val.get("error").is_some() {
            return Ok(val);
        }
        // {"event": ...} 行はスキップ
    }
}

/// コマンドを送信するだけ（レスポンス不要な場合）。
fn send_ipc_fire(cmd: Value) -> Result<(), String> {
    let mut stream =
        UnixStream::connect(MPV_SOCKET).map_err(|e| format!("IPC 接続失敗: {e}"))?;
    let msg = cmd.to_string() + "\n";
    stream.write_all(msg.as_bytes()).map_err(|e| e.to_string())
}

// ----- Tauri コマンド -----

/// 動画の表示サイズが最小値 (640x360) を下回る場合に window-scale で拡大する。
/// dwidth が 0 の間は最大 2 秒間ポーリングして動画ロード完了を待つ。
fn apply_minimum_window_size() {
    const MIN_W: f64 = 640.0;
    const MIN_H: f64 = 360.0;
    const POLL_INTERVAL_MS: u64 = 200;
    const MAX_ATTEMPTS: u32 = 10; // 最大 2 秒待機

    for _ in 0..MAX_ATTEMPTS {
        std::thread::sleep(std::time::Duration::from_millis(POLL_INTERVAL_MS));

        let w = send_ipc(json!({"command": ["get_property", "dwidth"]}))
            .ok()
            .and_then(|v| v["data"].as_f64())
            .unwrap_or(0.0);

        if w == 0.0 {
            continue; // まだ読み込まれていない
        }

        let h = send_ipc(json!({"command": ["get_property", "dheight"]}))
            .ok()
            .and_then(|v| v["data"].as_f64())
            .unwrap_or(0.0);

        if h > 0.0 && (w < MIN_W || h < MIN_H) {
            let scale = (MIN_W / w).max(MIN_H / h);
            let _ = send_ipc_fire(json!({"command": ["set_property", "window-scale", scale]}));
        }
        break; // 寸法取得成功 (リサイズ不要でも終了)
    }
}

/// 動画を再生する。
/// mpv が起動済みなら loadfile コマンドで切り替え、未起動なら新たにプロセスを起動する。
/// どちらのパスでも最小ウィンドウサイズ (640x360) を保証する。
#[tauri::command]
pub async fn play(
    state: tauri::State<'_, SharedMpvState>,
    settings: tauri::State<'_, SharedAppSettings>,
    path: String,
) -> Result<(), String> {
    let mpv_path = settings.lock().map_err(|e| e.to_string())?.mpv_path.clone();

    // 既存の mpv ソケットが有効なら loadfile で切り替え
    if std::path::Path::new(MPV_SOCKET).exists() {
        let result = send_ipc_fire(json!({"command": ["loadfile", path, "replace"]}));
        if result.is_ok() {
            // ファイル読み込み完了後にウィンドウサイズを調整 (バックグラウンド)
            tokio::task::spawn_blocking(|| {
                apply_minimum_window_size();
            });
            return Ok(());
        }
        // ソケットが残っているが mpv が死んでいる場合は再起動へフォールスルー
        let _ = std::fs::remove_file(MPV_SOCKET);
    }

    // 既存プロセスがあれば kill
    {
        let mut s = state.lock().map_err(|e| e.to_string())?;
        if let Some(mut child) = s.process.take() {
            let _ = child.kill();
        }
    }

    // mpv 起動 (--autofit-smaller で新規起動時の最小サイズを保証)
    let child = Command::new(&mpv_path)
        .args([
            "--idle",
            "--no-terminal",
            "--autofit-smaller=640x360",
            &format!("--input-ipc-server={MPV_SOCKET}"),
            &path,
        ])
        .spawn()
        .map_err(|e| format!("mpv 起動失敗 ({}): {e}", mpv_path))?;

    {
        let mut s = state.lock().map_err(|e| e.to_string())?;
        s.process = Some(child);
    }

    // ソケットが ready になるまで待つ（最大 3 秒）
    for _ in 0..30 {
        tokio::time::sleep(Duration::from_millis(100)).await;
        if std::path::Path::new(MPV_SOCKET).exists() {
            break;
        }
    }

    Ok(())
}

/// 一時停止 / 再開をトグルする。
#[tauri::command]
pub async fn pause_resume(
    _state: tauri::State<'_, SharedMpvState>,
) -> Result<(), String> {
    send_ipc_fire(json!({"command": ["cycle", "pause"]}))?;
    Ok(())
}

/// 再生位置を指定秒数に移動する。
#[tauri::command]
pub async fn seek(
    _state: tauri::State<'_, SharedMpvState>,
    seconds: f64,
) -> Result<(), String> {
    send_ipc_fire(json!({"command": ["set_property", "playback-time", seconds]}))?;
    Ok(())
}

/// 現在の再生位置（秒）を返す。
#[tauri::command]
pub async fn get_playback_time(
    _state: tauri::State<'_, SharedMpvState>,
) -> Result<f64, String> {
    let val = send_ipc(json!({"command": ["get_property", "playback-time"]}))?;
    val["data"]
        .as_f64()
        .ok_or_else(|| "再生位置の取得失敗".to_string())
}

/// 現在位置から相対的にシークする（秒数を正負で指定）。
#[tauri::command]
pub async fn relative_seek(
    _state: tauri::State<'_, SharedMpvState>,
    seconds: f64,
) -> Result<(), String> {
    send_ipc_fire(json!({"command": ["seek", seconds, "relative"]}))?;
    Ok(())
}

/// 音量を delta 分だけ増減する。
#[tauri::command]
pub async fn adjust_volume(
    _state: tauri::State<'_, SharedMpvState>,
    delta: f64,
) -> Result<(), String> {
    send_ipc_fire(json!({"command": ["add", "volume", delta]}))?;
    Ok(())
}

/// フルスクリーンをトグルする。
#[tauri::command]
pub async fn toggle_fullscreen(
    _state: tauri::State<'_, SharedMpvState>,
) -> Result<(), String> {
    send_ipc_fire(json!({"command": ["cycle", "fullscreen"]}))?;
    Ok(())
}

/// mpv を終了する。
#[tauri::command]
pub async fn quit_mpv(state: tauri::State<'_, SharedMpvState>) -> Result<(), String> {
    let _ = send_ipc_fire(json!({"command": ["quit"]}));
    let _ = std::fs::remove_file(MPV_SOCKET);

    let mut s = state.lock().map_err(|e| e.to_string())?;
    if let Some(mut child) = s.process.take() {
        let _ = child.kill();
    }
    Ok(())
}
