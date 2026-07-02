// mpv プロセス管理・IPC コマンド

use std::{
    io::{BufRead, BufReader, Write},
    process::{Child, Command, Stdio},
    sync::{
        atomic::{AtomicU32, Ordering},
        Arc, Mutex,
    },
    time::{Duration, SystemTime, UNIX_EPOCH},
};

#[cfg(unix)]
use std::os::unix::net::UnixStream;

/// プラットフォーム別の IPC ストリーム型。
/// Unix: UnixStream (UNIX ドメインソケット)
/// Windows: File (Named Pipe を File として開く)
#[cfg(unix)]
type IpcStream = UnixStream;
#[cfg(windows)]
type IpcStream = std::fs::File;

use serde_json::{json, Value};
use tauri::Emitter;

use super::settings::SharedAppSettings;

/// プロセス固有の IPC ソケットパスを返す (Unix)。
/// オーナーのみアクセス可能な専用ディレクトリ (0700) を作成し、
/// その中にソケットを配置することで他プロセスからの盗聴・改ざんを防ぐ。
#[cfg(unix)]
fn mpv_socket_path() -> String {
    use std::sync::OnceLock;
    static SOCKET_PATH: OnceLock<String> = OnceLock::new();
    SOCKET_PATH
        .get_or_init(|| {
            let token: u64 = rand::random();
            let tmpdir = std::env::var("TMPDIR")
                .unwrap_or_else(|_| std::env::temp_dir().to_string_lossy().into_owned());
            let sock_dir = format!(
                "{}/mpv-chuck-{}-{token:016x}",
                tmpdir.trim_end_matches('/'),
                std::process::id()
            );
            // オーナー専用ディレクトリ (0700) を作成して他ユーザーからアクセス不可にする
            {
                let _ = std::fs::create_dir_all(&sock_dir);
                use std::os::unix::fs::PermissionsExt;
                let _ = std::fs::set_permissions(
                    &sock_dir,
                    std::fs::Permissions::from_mode(0o700),
                );
            }
            format!("{sock_dir}/mpv.sock")
        })
        .clone()
}

/// プロセス固有の Named Pipe パスを返す (Windows)。
/// Named Pipe は接続を閉じると自動消滅するためファイル削除不要。
#[cfg(windows)]
fn mpv_socket_path() -> String {
    use std::sync::OnceLock;
    static PIPE_PATH: OnceLock<String> = OnceLock::new();
    PIPE_PATH
        .get_or_init(|| {
            let token: u64 = rand::random();
            format!(r"\\.\pipe\mpv-chuck-{}-{:016x}", std::process::id(), token)
        })
        .clone()
}

/// mpv の --input-ipc-server に渡す文字列を返す。
/// Unix: ソケットファイルの絶対パスをそのまま渡す。
/// Windows: mpv は内部で \\.\pipe\ プレフィックスを自動付加するため、
///          名前部分のみ渡してプレフィックスの二重付与を防ぐ。
fn mpv_ipc_arg() -> String {
    #[cfg(unix)]
    {
        mpv_socket_path()
    }
    #[cfg(windows)]
    {
        let path = mpv_socket_path();
        path.strip_prefix(r"\\.\pipe\")
            .unwrap_or(&path)
            .to_string()
    }
}

/// IPC エンドポイントが利用可能かどうかを確認する。
/// Unix: ソケットファイルの存在確認。
/// Windows: Named Pipe への接続試行で確認。
fn ipc_ready() -> bool {
    #[cfg(unix)]
    {
        std::path::Path::new(&mpv_socket_path()).exists()
    }
    #[cfg(windows)]
    {
        std::fs::OpenOptions::new()
            .read(true)
            .write(true)
            .open(mpv_socket_path())
            .is_ok()
    }
}

/// IPC エンドポイントに接続し IpcStream を返す。
#[cfg(unix)]
fn connect_ipc() -> Result<IpcStream, String> {
    UnixStream::connect(mpv_socket_path()).map_err(|e| format!("IPC 接続失敗: {e}"))
}

#[cfg(windows)]
fn connect_ipc() -> Result<IpcStream, String> {
    std::fs::OpenOptions::new()
        .read(true)
        .write(true)
        .open(mpv_socket_path())
        .map_err(|e| format!("IPC 接続失敗: {e}"))
}

// ----- 共有状態 -----

pub struct MpvState {
    process: Option<Child>,
    /// モニタ/リーダースレッドの世代番号。mpv 再起動時にインクリメントし、旧スレッドを終了させる。
    /// Arc<AtomicU32> にすることでリーダースレッドがロックなしに世代チェックできる。
    generation: Arc<AtomicU32>,
    /// 送信専用の永続 IPC ライタ。
    writer: Option<Arc<Mutex<IpcStream>>>,
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
fn send_cmd(writer: &Arc<Mutex<IpcStream>>, cmd: Value) -> Result<(), String> {
    let mut w = writer.lock().map_err(|e| e.to_string())?;
    let msg = cmd.to_string() + "\n";
    w.write_all(msg.as_bytes()).map_err(|e| e.to_string())
}

/// 一時接続でコマンドを送信しレスポンスを読む（一回限りの問い合わせ用）。
/// Unix: UnixStream の set_read_timeout で 2 秒タイムアウト。
/// Windows: std::fs::File (Named Pipe) は set_read_timeout 非対応のため
///          別スレッドで実行し std::sync::mpsc::Receiver::recv_timeout で 2 秒を保証する。
fn send_ipc(cmd: Value) -> Result<Value, String> {
    #[cfg(unix)]
    {
        let stream = connect_ipc()?;
        stream
            .set_read_timeout(Some(Duration::from_secs(2)))
            .map_err(|e| e.to_string())?;
        send_ipc_on(stream, cmd)
    }
    #[cfg(windows)]
    {
        let stream = connect_ipc()?;
        let (tx, rx) = std::sync::mpsc::channel();
        std::thread::spawn(move || {
            tx.send(send_ipc_on(stream, cmd)).ok();
        });
        rx.recv_timeout(Duration::from_secs(2))
            .map_err(|_| "mpv IPC タイムアウト (2秒)".to_string())
            .and_then(|r| r)
    }
}

/// 既存の IpcStream にコマンドを送信しレスポンスを読む。
fn send_ipc_on(mut stream: IpcStream, cmd: Value) -> Result<Value, String> {
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
) -> Result<Arc<Mutex<IpcStream>>, String> {
    let stream = connect_ipc()?;
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
                    log::debug!("[reader gen={current_gen}] EOF 受信");
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
                            log::debug!("[reader gen={current_gen}] mpv//closed 送信");
                            #[cfg(unix)]
                            let _ = std::fs::remove_file(mpv_socket_path());
                            let _ = app.emit("mpv://closed", ());
                        } else {
                            log::debug!("[reader gen={current_gen}] generation 変化 → closed をスキップ");
                        }
                    } else {
                        log::debug!("[reader gen={current_gen}] is_current=false → スキップ");
                    }
                    return;
                }
                Ok(_) => {}
                Err(e) => {
                    // I/O エラー (ECONNRESET 等): EOF と同様にクリーンアップして終了する
                    log::debug!("[reader gen={current_gen}] read error: {e} → cleanup");
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
                            log::debug!("[reader gen={current_gen}] error → mpv//closed 送信");
                            #[cfg(unix)]
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
                    log::debug!("[reader gen={current_gen}] end-file reason={reason}");
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
    let disp_w = match send_ipc(json!({"command": ["get_property", "display-width"]})) {
        Ok(v) => v["data"].as_f64().unwrap_or(0.0),
        Err(e) => { log::warn!("[window-constraints] display-width 取得失敗: {e}"); 0.0 }
    };
    let disp_h = match send_ipc(json!({"command": ["get_property", "display-height"]})) {
        Ok(v) => v["data"].as_f64().unwrap_or(0.0),
        Err(e) => { log::warn!("[window-constraints] display-height 取得失敗: {e}"); 0.0 }
    };
    if disp_w <= 0.0 || disp_h <= 0.0 {
        log::warn!("[window-constraints] ディスプレイ寸法が取得できません (w={disp_w}, h={disp_h}) → スキップ");
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
        if ipc_ready() {
            log::debug!("[play] mpv 起動中 → loadfile replace (send_cmd): {path}");
            match send_cmd(writer, json!({"command": ["loadfile", path, "replace"]})) {
                Ok(()) => {
                    log::debug!("[play] loadfile 送信成功");
                    return Ok(());
                }
                Err(e) => {
                    log::debug!("[play] loadfile send_cmd 失敗 ({e}) → 再起動");
                }
            }
        } else {
            log::debug!("[play] ソケット消失 → 再起動");
        }
    } else {
        log::debug!("[play] mpv 未起動 → 新規起動");
    }

    // ソケットファイルと古いプロセスを片付ける
    // generation を先にインクリメントして EOF ハンドラの誤発火を防ぐ
    #[cfg(unix)]
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
    log::debug!("[play] mpv 起動");
    let ipc_server_arg = format!("--input-ipc-server={}", mpv_ipc_arg());
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
                log::debug!("[mpv stderr] {line}");
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
        if ipc_ready() {
            break;
        }
    }
    if !ipc_ready() {
        log::error!("[play] ソケット待機タイムアウト (3秒): mpv が起動しましたがソケットが生成されません");
        return Err(
            "mpv が起動しましたが IPC ソケットの準備がタイムアウトしました。\
             mpv が正しくインストールされているか確認してください。"
                .to_string(),
        );
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
    .and_then(|r| r.map_err(|e| { log::error!("[play] IPC 接続失敗: {e}"); e }))?;

    log::debug!("[play] IPC 接続成功 gen={current_gen}");
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
/// send_ipc はブロッキング I/O のため spawn_blocking でラップする。
#[tauri::command]
pub async fn get_playback_time(
    _state: tauri::State<'_, SharedMpvState>,
) -> Result<f64, String> {
    tokio::task::spawn_blocking(|| {
        let val = send_ipc(json!({"command": ["get_property", "playback-time"]}))?;
        val["data"]
            .as_f64()
            .ok_or_else(|| "再生位置の取得失敗".to_string())
    })
    .await
    .map_err(|e| e.to_string())
    .and_then(|r| r)
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
    super::utils::validate_image_output_path(&output_path)?;
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
    super::utils::validate_path(&path)?;
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

    #[cfg(unix)]
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
    #[cfg(unix)]
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
