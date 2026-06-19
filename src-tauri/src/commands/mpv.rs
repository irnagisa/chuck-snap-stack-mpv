// mpv プロセス管理・IPC コマンド

use std::{
    io::{BufRead, BufReader, Write},
    os::unix::net::UnixStream,
    process::{Child, Command, Stdio},
    sync::{
        atomic::{AtomicU32, Ordering},
        Arc, Mutex,
    },
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use serde_json::{json, Value};
use tauri::Emitter;

use super::settings::SharedAppSettings;

/// プロセス固有の IPC ソケットパスを返す。
/// オーナーのみアクセス可能な専用ディレクトリ (0700) を作成し、
/// その中にソケットを配置することで他プロセスからの盗聴・改ざんを防ぐ。
fn mpv_socket_path() -> String {
    use std::sync::OnceLock;
    static SOCKET_PATH: OnceLock<String> = OnceLock::new();
    SOCKET_PATH
        .get_or_init(|| {
            let token = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.subsec_nanos() ^ std::process::id().wrapping_mul(0x9e37_79b9))
                .unwrap_or(std::process::id());
            let tmpdir = std::env::var("TMPDIR")
                .unwrap_or_else(|_| std::env::temp_dir().to_string_lossy().into_owned());
            let sock_dir = format!(
                "{}/mpv-chuck-{}-{token:08x}",
                tmpdir.trim_end_matches('/'),
                std::process::id()
            );
            // オーナー専用ディレクトリ (0700) を作成して他ユーザーからアクセス不可にする
            #[cfg(unix)]
            {
                let _ = std::fs::create_dir_all(&sock_dir);
                use std::os::unix::fs::PermissionsExt;
                let _ = std::fs::set_permissions(
                    &sock_dir,
                    std::fs::Permissions::from_mode(0o700),
                );
            }
            #[cfg(not(unix))]
            {
                let _ = std::fs::create_dir_all(&sock_dir);
            }
            format!("{sock_dir}/mpv.sock")
        })
        .clone()
}

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
        UnixStream::connect(mpv_socket_path()).map_err(|e| format!("IPC 接続失敗: {e}"))?;
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
        UnixStream::connect(mpv_socket_path()).map_err(|e| format!("IPC 接続失敗: {e}"))?;
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
        // playback-time は ~200ms に1回だけ emit してスロットリング
        let mut last_playback_emit_ms: u64 = 0;
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
                            let _ = std::fs::remove_file(mpv_socket_path());
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
                Err(e) => {
                    // I/O エラー (ECONNRESET 等): EOF と同様にクリーンアップして終了する
                    eprintln!("[reader gen={current_gen}] read error: {e} → cleanup");
                    let is_current = gen_counter.load(Ordering::Acquire) == current_gen;
                    if is_current {
                        let child_opt = state.lock().ok().and_then(|mut s| {
                            s.writer = None;
                            s.process.take()
                        });
                        if let Some(mut child) = child_opt {
                            std::thread::spawn(move || {
                                let _ = child.kill();
                                let _ = child.wait();
                            });
                        }
                        let still_current = gen_counter.load(Ordering::Acquire) == current_gen;
                        if still_current {
                            eprintln!("[reader gen={current_gen}] error → mpv//closed 送信");
                            let _ = std::fs::remove_file(mpv_socket_path());
                            let _ = app.emit("mpv://closed", ());
                        }
                    }
                    return;
                }
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
                                let now_ms = SystemTime::now()
                                    .duration_since(UNIX_EPOCH)
                                    .map(|d| d.as_millis() as u64)
                                    .unwrap_or(0);
                                if now_ms.saturating_sub(last_playback_emit_ms) >= 200 {
                                    last_playback_emit_ms = now_ms;
                                    let _ = app.emit("mpv://playback-time", t);
                                }
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
/// gen_counter/current_gen を渡すことで、古い play() 呼び出しから起動した
/// スレッドが新しい mpv に誤ったスケールを適用しないようにする。
fn apply_window_size_constraints(gen_counter: Arc<AtomicU32>, current_gen: u32) {
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
        // 世代チェック: 新しい play() が呼ばれていたら即終了
        if gen_counter.load(Ordering::Acquire) != current_gen {
            return;
        }

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

        // 世代チェック: dwidth/dheight 取得後にも確認
        if gen_counter.load(Ordering::Acquire) != current_gen {
            return;
        }

        // 75% 以上を確保するスケール（両辺とも 75% 以上になるよう大きい方を採用）
        let min_scale = (0.75 * disp_w / w).max(0.75 * usable_h / h);
        // 95% を超えないスケール（両辺とも 95% 以下になるよう小さい方を採用）
        let max_scale = (0.95 * disp_w / w).min(0.95 * usable_h / h);
        // 75% を基準とし、いずれかの辺が 95% を超えるなら 95% を上限とする
        let scale = min_scale.min(max_scale);
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

    // ソケットが存在する（mpv 起動済み）なら永続 writer で loadfile を送信する。
    // send_ipc (新規コネクション) を使うと 2 秒タイムアウト時に正常動作中の mpv を
    // 誤って再起動してしまう。send_cmd はカーネルバッファへの書き込み成功を確認するため、
    // ソケットが切断済みなら EPIPE/ECONNRESET を返し再起動フローに進む。
    let writer_opt = state.lock().map_err(|e| e.to_string())?.writer.clone();
    if let Some(ref writer) = writer_opt {
        if std::path::Path::new(&mpv_socket_path()).exists() {
            eprintln!("[play] mpv 起動中 → loadfile replace (send_cmd): {path}");
            match send_cmd(writer, json!({"command": ["loadfile", path, "replace"]})) {
                Ok(()) => {
                    eprintln!("[play] loadfile 送信成功");
                    return Ok(());
                }
                Err(e) => {
                    eprintln!("[play] loadfile send_cmd 失敗 ({e}) → 再起動");
                }
            }
        } else {
            eprintln!("[play] ソケット消失 → 再起動");
        }
    } else {
        eprintln!("[play] mpv 未起動 → 新規起動");
    }

    // ソケットファイルと古いプロセスを片付ける
    // generation を先にインクリメントして EOF ハンドラの誤発火を防ぐ
    let _ = std::fs::remove_file(mpv_socket_path());
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
    eprintln!("[play] mpv 起動");
    let socket_path = mpv_socket_path();
    let ipc_server_arg = format!("--input-ipc-server={socket_path}");
    let mut child = Command::new(&mpv_path)
        .args([
            "--idle",
            "--no-terminal",
            "--autofit-smaller=75%x75%",
            "--autofit-larger=95%x95%",
            "--cache=yes",
            "--demuxer-max-bytes=150MiB",
            "--demuxer-max-back-bytes=50MiB",
            &ipc_server_arg,
            &path,
        ])
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("メディアプレイヤーの起動に失敗しました ({})", e.kind()))?;

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
        if std::path::Path::new(&mpv_socket_path()).exists() {
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

    let gen_for_constraints = Arc::clone(&gen_counter);
    tokio::task::spawn_blocking(move || {
        apply_window_size_constraints(gen_for_constraints, current_gen)
    });

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

/// 再生速度を設定する (0.1 〜 10.0)。
#[tauri::command]
pub async fn set_playback_speed(
    state: tauri::State<'_, SharedMpvState>,
    speed: f64,
) -> Result<(), String> {
    let speed = speed.clamp(0.1, 10.0);
    let writer = state
        .lock()
        .map_err(|e| e.to_string())?
        .writer
        .clone()
        .ok_or("mpv が起動していません")?;
    send_cmd(&writer, serde_json::json!({"command": ["set_property", "speed", speed]}))
}

/// 現在フレームのスクリーンショットを指定パスに保存する。
#[tauri::command]
pub async fn take_screenshot(
    state: tauri::State<'_, SharedMpvState>,
    output_path: String,
) -> Result<(), String> {
    // パストラバーサル防止
    if output_path.contains('\0') || output_path.contains("..") {
        return Err("不正なパスです".to_string());
    }
    let writer = state
        .lock()
        .map_err(|e| e.to_string())?
        .writer
        .clone()
        .ok_or("mpv が起動していません")?;
    send_cmd(&writer, serde_json::json!({"command": ["screenshot-to-file", output_path, "video"]}))
}

/// A-B ループの A 点を現在の再生位置に設定する。
#[tauri::command]
pub async fn set_ab_loop_a(state: tauri::State<'_, SharedMpvState>) -> Result<(), String> {
    let writer = state
        .lock()
        .map_err(|e| e.to_string())?
        .writer
        .clone()
        .ok_or("mpv が起動していません")?;
    send_cmd(&writer, serde_json::json!({"command": ["ab-loop"]}))
}

/// A-B ループの B 点を現在の再生位置に設定する（A 点設定後に呼び出す）。
#[tauri::command]
pub async fn set_ab_loop_b(state: tauri::State<'_, SharedMpvState>) -> Result<(), String> {
    let writer = state
        .lock()
        .map_err(|e| e.to_string())?
        .writer
        .clone()
        .ok_or("mpv が起動していません")?;
    send_cmd(&writer, serde_json::json!({"command": ["ab-loop"]}))
}

/// A-B ループをクリアする。
#[tauri::command]
pub async fn clear_ab_loop(state: tauri::State<'_, SharedMpvState>) -> Result<(), String> {
    let writer = state
        .lock()
        .map_err(|e| e.to_string())?
        .writer
        .clone()
        .ok_or("mpv が起動していません")?;
    // ab-loop-a と ab-loop-b を "no" に設定してクリア
    send_cmd(&writer, serde_json::json!({"command": ["set_property", "ab-loop-a", "no"]}))?;
    send_cmd(&writer, serde_json::json!({"command": ["set_property", "ab-loop-b", "no"]}))
}

/// 字幕ファイルをロードする。
#[tauri::command]
pub async fn load_subtitle(
    state: tauri::State<'_, SharedMpvState>,
    path: String,
) -> Result<(), String> {
    // パス検証
    if path.contains('\0') {
        return Err("不正なパスです".to_string());
    }
    let writer = state
        .lock()
        .map_err(|e| e.to_string())?
        .writer
        .clone()
        .ok_or("mpv が起動していません")?;
    send_cmd(&writer, serde_json::json!({"command": ["sub-add", path, "select"]}))
}

/// mpv を終了する。
#[tauri::command]
pub async fn quit_mpv(state: tauri::State<'_, SharedMpvState>) -> Result<(), String> {
    let (writer_opt, child_opt) = {
        let mut s = state.lock().map_err(|e| e.to_string())?;
        // generation をインクリメントしてリーダースレッドが mpv://closed を
        // emit しないようにする（ユーザー操作による明示的な終了のため不要）
        s.generation.fetch_add(1, Ordering::SeqCst);
        (s.writer.take(), s.process.take())
    };

    if let Some(writer) = writer_opt {
        let _ = send_cmd(&writer, json!({"command": ["quit"]}));
    }

    let _ = std::fs::remove_file(mpv_socket_path());

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

/// アプリ終了時に mpv プロセスを同期的に強制終了する。
/// IPC quit を試みた後、3 秒以内に終了しなければ SIGKILL を送る。
pub fn kill_on_exit(state: &SharedMpvState) {
    let (writer_opt, child_opt) = {
        let Ok(mut s) = state.lock() else { return };
        s.generation.fetch_add(1, Ordering::SeqCst);
        (s.writer.take(), s.process.take())
    };

    if let Some(writer) = writer_opt {
        let _ = send_cmd(&writer, json!({"command": ["quit"]}));
    }
    let _ = std::fs::remove_file(mpv_socket_path());

    if let Some(mut child) = child_opt {
        let deadline = std::time::Instant::now() + Duration::from_secs(3);
        loop {
            match child.try_wait() {
                Ok(Some(_)) => break,
                Ok(None) => {
                    if std::time::Instant::now() >= deadline {
                        let _ = child.kill();
                        let _ = child.wait();
                        break;
                    }
                    std::thread::sleep(Duration::from_millis(50));
                }
                Err(_) => {
                    let _ = child.kill();
                    let _ = child.wait();
                    break;
                }
            }
        }
    }
}
