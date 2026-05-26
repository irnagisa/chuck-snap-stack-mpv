// mpv プロセス管理・IPC コマンド

use std::{
    io::{BufRead, BufReader, Write},
    os::unix::net::UnixStream,
    process::{Child, Command, Stdio},
    sync::{
        atomic::{AtomicU32, Ordering},
        Arc, Mutex,
    },
    time::Duration,
};

use serde_json::{json, Value};
use tauri::Emitter;

use super::settings::SharedAppSettings;

const MPV_SOCKET: &str = "/tmp/mpv-chuck-socket";

// ----- 共有状態 -----

pub struct MpvState {
    process: Option<Child>,
    /// モニタ/リーダースレッドの世代番号。mpv 再起動時にインクリメントし、旧スレッドを終了させる。
    /// Arc<AtomicU32> にすることでリーダースレッドがロックなしに世代チェックできる。
    generation: Arc<AtomicU32>,
    /// 送信専用の永続 IPC ライタ。
    writer: Option<Arc<Mutex<UnixStream>>>,
}

pub type SharedMpvState = Arc<Mutex<MpvState>>;

impl MpvState {
    pub fn new() -> SharedMpvState {
        Arc::new(Mutex::new(MpvState {
            process: None,
            generation: Arc::new(AtomicU32::new(0)),
            writer: None,
        }))
    }
}

// ----- IPC ヘルパー -----

/// 永続ライタへコマンドを送信する（レスポンス不要）。
fn send_cmd(writer: &Arc<Mutex<UnixStream>>, cmd: Value) -> Result<(), String> {
    let mut w = writer.lock().map_err(|e| e.to_string())?;
    let msg = cmd.to_string() + "\n";
    w.write_all(msg.as_bytes()).map_err(|e| e.to_string())
}

/// 一時接続でコマンドを送信しレスポンスを読む（一回限りの問い合わせ用）。
fn send_ipc(cmd: Value) -> Result<Value, String> {
    let stream =
        UnixStream::connect(MPV_SOCKET).map_err(|e| format!("IPC 接続失敗: {e}"))?;
    stream
        .set_read_timeout(Some(Duration::from_secs(2)))
        .map_err(|e| e.to_string())?;
    send_ipc_on(stream, cmd)
}

/// 既存の UnixStream にコマンドを送信しレスポンスを読む。
fn send_ipc_on(mut stream: UnixStream, cmd: Value) -> Result<Value, String> {
    let msg = cmd.to_string() + "\n";
    stream.write_all(msg.as_bytes()).map_err(|e| e.to_string())?;

    let mut reader = BufReader::new(&stream);
    loop {
        let mut line = String::new();
        reader.read_line(&mut line).map_err(|e| e.to_string())?;
        if line.is_empty() {
            return Err("mpv からの応答なし".to_string());
        }
        let val: Value = serde_json::from_str(line.trim()).map_err(|e| e.to_string())?;
        if val.get("error").is_some() {
            return Ok(val);
        }
        // {"event": ...} 行はスキップ
    }
}

// ----- プロパティ監視リーダー -----

/// mpv IPC に接続し、observe_property でプロパティを購読する。
/// プロパティ変化と end-file イベントを Tauri イベントとして emit するリーダースレッドを起動し、
/// 送信専用の永続ライタを返す。
fn connect_and_start_reader(
    state: SharedMpvState,
    gen_counter: Arc<AtomicU32>,
    current_gen: u32,
    app: tauri::AppHandle,
) -> Result<Arc<Mutex<UnixStream>>, String> {
    let stream =
        UnixStream::connect(MPV_SOCKET).map_err(|e| format!("IPC 接続失敗: {e}"))?;
    let read_stream = stream.try_clone().map_err(|e| e.to_string())?;
    let writer = Arc::new(Mutex::new(stream));

    // プロパティ購読コマンドを送信
    {
        let mut w = writer.lock().map_err(|e| e.to_string())?;
        for cmd in &[
            json!({"command": ["observe_property", 1, "playback-time"]}),
            json!({"command": ["observe_property", 2, "pause"]}),
            json!({"command": ["observe_property", 3, "duration"]}),
        ] {
            let msg = cmd.to_string() + "\n";
            w.write_all(msg.as_bytes()).map_err(|e| e.to_string())?;
        }
    }

    let writer_clone = Arc::clone(&writer);

    // リーダースレッド: mpv からのイベント行を受信して Tauri イベントに変換する
    std::thread::spawn(move || {
        let mut reader = BufReader::new(read_stream);
        loop {
            let mut line = String::new();
            match reader.read_line(&mut line) {
                Ok(0) => {
                    // EOF: mpv プロセスが終了した
                    eprintln!("[reader gen={current_gen}] EOF 受信");
                    let is_current = gen_counter.load(Ordering::Acquire) == current_gen;
                    if is_current {
                        // ソケット参照をクリアし、ゾンビプロセス回収はバックグラウンドへ
                        let child_opt = state.lock().ok().and_then(|mut s| {
                            s.writer = None;
                            s.process.take()
                        });
                        if let Some(mut child) = child_opt {
                            // child.wait() をバックグラウンドへ逃がし closed 通知をブロックしない
                            std::thread::spawn(move || { let _ = child.wait(); });
                        }
                        // 新しい mpv が起動していなければ closed を即座に送信
                        let still_current =
                            gen_counter.load(Ordering::Acquire) == current_gen;
                        if still_current {
                            eprintln!("[reader gen={current_gen}] mpv//closed 送信");
                            let _ = std::fs::remove_file(MPV_SOCKET);
                            let _ = app.emit("mpv://closed", ());
                        } else {
                            eprintln!("[reader gen={current_gen}] generation 変化 → closed をスキップ");
                        }
                    } else {
                        eprintln!("[reader gen={current_gen}] is_current=false → スキップ");
                    }
                    return;
                }
                Ok(_) => {}
                Err(_) => return,
            }

            // 世代チェック: mpv が再起動された場合は古いスレッドを終了
            // AtomicU32 でロックなしにチェックできる（ホットパス最適化）
            if gen_counter.load(Ordering::Acquire) != current_gen {
                return;
            }

            let val: Value = match serde_json::from_str(line.trim()) {
                Ok(v) => v,
                Err(_) => continue,
            };

            match val.get("event").and_then(|e| e.as_str()) {
                Some("property-change") => {
                    match val["name"].as_str().unwrap_or("") {
                        "playback-time" => {
                            if let Some(t) = val["data"].as_f64() {
                                let _ = app.emit("mpv://playback-time", t);
                            }
                        }
                        "pause" => {
                            let paused = val["data"].as_bool().unwrap_or(false);
                            let _ = app.emit("mpv://pause", paused);
                        }
                        "duration" => {
                            if let Some(d) = val["data"].as_f64() {
                                let _ = app.emit("mpv://duration", d);
                            }
                        }
                        _ => {}
                    }
                }
                Some("end-file") => {
                    // reason: "eof" | "stop" | "quit" | "error" | "redirect" | "unknown"
                    let reason = val["reason"].as_str().unwrap_or("unknown").to_string();
                    eprintln!("[reader gen={current_gen}] end-file reason={reason}");
                    let _ = app.emit("mpv://end-file", reason);
                }
                _ => {}
            }
        }
    });

    Ok(writer_clone)
}

// ----- ウィンドウサイズ制約 -----

/// 動画ウィンドウのサイズ制約を適用する。
/// ディスプレイ寸法を一度だけ取得し、dwidth が確定するまでポーリングする。
fn apply_window_size_constraints() {
    // ディスプレイ寸法は起動中に変わらないため一度だけ取得する
    let disp_w = send_ipc(json!({"command": ["get_property", "display-width"]}))
        .ok()
        .and_then(|v| v["data"].as_f64())
        .unwrap_or(0.0);
    let disp_h = send_ipc(json!({"command": ["get_property", "display-height"]}))
        .ok()
        .and_then(|v| v["data"].as_f64())
        .unwrap_or(0.0);
    if disp_w <= 0.0 || disp_h <= 0.0 {
        return;
    }

    // macOS メニューバー等のシステム UI 分を除いた有効高さ
    let usable_h = disp_h - 28.0;

    // dwidth が確定するまで待つ（最大 2 秒）
    for _ in 0..10 {
        std::thread::sleep(Duration::from_millis(200));

        let w = send_ipc(json!({"command": ["get_property", "dwidth"]}))
            .ok()
            .and_then(|v| v["data"].as_f64())
            .unwrap_or(0.0);
        if w == 0.0 {
            continue;
        }

        let h = send_ipc(json!({"command": ["get_property", "dheight"]}))
            .ok()
            .and_then(|v| v["data"].as_f64())
            .unwrap_or(0.0);
        if h == 0.0 {
            break;
        }

        // 幅・高さそれぞれ 95% に収まるスケールのうち小さい方を採用
        let scale = (0.95 * disp_w / w).min(0.95 * usable_h / h);
        let _ = send_ipc(json!({"command": ["set_property", "window-scale", scale]}));
        break;
    }
}

// ----- Tauri コマンド -----

/// 動画を再生する。
/// mpv が起動済み (永続ライタあり) なら loadfile で切り替え、
/// 未起動 or 接続失敗なら mpv を (再) 起動して IPC リーダーを接続する。
#[tauri::command]
pub async fn play(
    app: tauri::AppHandle,
    state: tauri::State<'_, SharedMpvState>,
    settings: tauri::State<'_, SharedAppSettings>,
    path: String,
) -> Result<(), String> {
    let mpv_path = settings.lock().map_err(|e| e.to_string())?.mpv_path.clone();

    // ソケットが存在する（mpv 起動済み）なら loadfile で切り替え
    let writer_opt = state.lock().map_err(|e| e.to_string())?.writer.clone();
    if let Some(writer) = writer_opt {
        if std::path::Path::new(MPV_SOCKET).exists() {
            eprintln!("[play] mpv 起動中 → loadfile replace (send_cmd): {path}");
            match send_cmd(&writer, json!({"command": ["loadfile", path, "replace"]})) {
                Ok(_) => {
                    eprintln!("[play] loadfile 送信成功");
                    return Ok(());
                }
                Err(e) => {
                    eprintln!("[play] loadfile 失敗 ({e}) → mpv 再起動");
                }
            }
        }
    } else {
        eprintln!("[play] mpv 未起動 → 新規起動");
    }

    // ソケットファイルと古いプロセスを片付ける
    // generation を先にインクリメントして EOF ハンドラの誤発火を防ぐ
    let _ = std::fs::remove_file(MPV_SOCKET);
    let (old_child, gen_counter) = {
        let mut s = state.lock().map_err(|e| e.to_string())?;
        s.writer = None;
        s.generation.fetch_add(1, Ordering::SeqCst);
        let gen_counter = Arc::clone(&s.generation);
        (s.process.take(), gen_counter)
    };
    if let Some(mut child) = old_child {
        let _ = child.kill();
        // wait() はブロッキングのためバックグラウンドスレッドで実行し async を妨げない
        tokio::task::spawn_blocking(move || {
            let _ = child.wait();
        });
    }

    // mpv 起動
    eprintln!("[play] mpv 起動: {mpv_path} {path}");
    let mut child = Command::new(&mpv_path)
        .args([
            "--idle",
            "--no-terminal",
            "--autofit-larger=95%x95%",
            "--cache=yes",
            "--demuxer-max-bytes=150MiB",
            "--demuxer-max-back-bytes=50MiB",
            &format!("--input-ipc-server={MPV_SOCKET}"),
            &path,
        ])
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("mpv 起動失敗 ({}): {e}", mpv_path))?;

    // stderr を別スレッドでログ出力
    if let Some(stderr) = child.stderr.take() {
        std::thread::spawn(move || {
            let reader = BufReader::new(stderr);
            for line in reader.lines().flatten() {
                eprintln!("[mpv stderr] {line}");
            }
        });
    }

    {
        let mut s = state.lock().map_err(|e| e.to_string())?;
        s.process = Some(child);
    }

    let current_gen = gen_counter.load(Ordering::SeqCst);

    // ソケットが ready になるまで待つ（最大 3 秒）
    for _ in 0..30 {
        tokio::time::sleep(Duration::from_millis(100)).await;
        if std::path::Path::new(MPV_SOCKET).exists() {
            break;
        }
    }

    // IPC 接続・プロパティ購読・リーダースレッド起動
    let state_arc = Arc::clone(state.inner());
    let app_clone = app.clone();
    let gen_counter_clone = Arc::clone(&gen_counter);
    let writer = tokio::task::spawn_blocking(move || {
        connect_and_start_reader(state_arc, gen_counter_clone, current_gen, app_clone)
    })
    .await
    .map_err(|e| e.to_string())
    .and_then(|r| r.map_err(|e| { eprintln!("[play] IPC 接続失敗: {e}"); e }))?;

    eprintln!("[play] IPC 接続成功 gen={current_gen}");
    state.lock().map_err(|e| e.to_string())?.writer = Some(writer);

    tokio::task::spawn_blocking(apply_window_size_constraints);

    Ok(())
}

/// 一時停止 / 再開をトグルする。
#[tauri::command]
pub async fn pause_resume(state: tauri::State<'_, SharedMpvState>) -> Result<(), String> {
    let writer = state
        .lock()
        .map_err(|e| e.to_string())?
        .writer
        .clone()
        .ok_or("mpv が起動していません")?;
    send_cmd(&writer, json!({"command": ["cycle", "pause"]}))
}

/// 再生位置を指定秒数に移動する。
#[tauri::command]
pub async fn seek(state: tauri::State<'_, SharedMpvState>, seconds: f64) -> Result<(), String> {
    let writer = state
        .lock()
        .map_err(|e| e.to_string())?
        .writer
        .clone()
        .ok_or("mpv が起動していません")?;
    send_cmd(&writer, json!({"command": ["set_property", "playback-time", seconds]}))
}

/// 現在の再生位置（秒）を返す（デバッグ・フォールバック用）。
#[tauri::command]
pub async fn get_playback_time(
    _state: tauri::State<'_, SharedMpvState>,
) -> Result<f64, String> {
    let val = send_ipc(json!({"command": ["get_property", "playback-time"]}))?;
    val["data"]
        .as_f64()
        .ok_or_else(|| "再生位置の取得失敗".to_string())
}

/// 現在位置から相対的にシークする。
#[tauri::command]
pub async fn relative_seek(
    state: tauri::State<'_, SharedMpvState>,
    seconds: f64,
) -> Result<(), String> {
    let writer = state
        .lock()
        .map_err(|e| e.to_string())?
        .writer
        .clone()
        .ok_or("mpv が起動していません")?;
    send_cmd(&writer, json!({"command": ["seek", seconds, "relative"]}))
}

/// 音量を delta 分だけ増減する。
#[tauri::command]
pub async fn adjust_volume(
    state: tauri::State<'_, SharedMpvState>,
    delta: f64,
) -> Result<(), String> {
    let writer = state
        .lock()
        .map_err(|e| e.to_string())?
        .writer
        .clone()
        .ok_or("mpv が起動していません")?;
    send_cmd(&writer, json!({"command": ["add", "volume", delta]}))
}

/// フルスクリーンをトグルする。
#[tauri::command]
pub async fn toggle_fullscreen(
    state: tauri::State<'_, SharedMpvState>,
) -> Result<(), String> {
    let writer = state
        .lock()
        .map_err(|e| e.to_string())?
        .writer
        .clone()
        .ok_or("mpv が起動していません")?;
    send_cmd(&writer, json!({"command": ["cycle", "fullscreen"]}))
}

/// ループ再生を設定する。
#[tauri::command]
pub async fn set_loop(
    state: tauri::State<'_, SharedMpvState>,
    enabled: bool,
) -> Result<(), String> {
    let writer = state
        .lock()
        .map_err(|e| e.to_string())?
        .writer
        .clone()
        .ok_or("mpv が起動していません")?;
    let value = if enabled {
        serde_json::Value::String("inf".to_string())
    } else {
        serde_json::Value::String("no".to_string())
    };
    send_cmd(&writer, json!({"command": ["set_property", "loop-file", value]}))
}

/// mpv を終了する。
#[tauri::command]
pub async fn quit_mpv(state: tauri::State<'_, SharedMpvState>) -> Result<(), String> {
    let (writer_opt, child_opt) = {
        let mut s = state.lock().map_err(|e| e.to_string())?;
        (s.writer.take(), s.process.take())
    };

    if let Some(writer) = writer_opt {
        let _ = send_cmd(&writer, json!({"command": ["quit"]}));
    }

    let _ = std::fs::remove_file(MPV_SOCKET);

    if let Some(mut child) = child_opt {
        // ["quit"] IPC でウィンドウは即座に閉じる。プロセス回収はバックグラウンドで行い
        // フロントエンドをブロックしない。3 秒以内に終了しない場合は強制終了する。
        tokio::task::spawn_blocking(move || {
            let deadline = std::time::Instant::now() + Duration::from_secs(3);
            loop {
                match child.try_wait() {
                    Ok(Some(_)) => return,
                    Ok(None) => {
                        if std::time::Instant::now() >= deadline {
                            let _ = child.kill();
                            let _ = child.wait();
                            return;
                        }
                        std::thread::sleep(Duration::from_millis(50));
                    }
                    Err(_) => {
                        let _ = child.kill();
                        let _ = child.wait();
                        return;
                    }
                }
            }
        });
    }

    Ok(())
}
