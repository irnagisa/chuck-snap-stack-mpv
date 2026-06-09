use std::path::PathBuf;
use std::sync::Mutex;

use axum::{
    body::Body,
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    routing::get,
    Json, Router,
};
use rusqlite::{Connection, OpenFlags};
use serde::Serialize;
use tauri::Manager;
use tokio::io::{AsyncReadExt, AsyncSeekExt};
use tokio::task::JoinHandle;
use tower_http::cors::{Any, CorsLayer};

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

pub struct WebServerState {
    handle: tokio::sync::Mutex<Option<JoinHandle<()>>>,
    port: Mutex<Option<u16>>,
}

impl WebServerState {
    pub fn new() -> Self {
        Self {
            handle: tokio::sync::Mutex::new(None),
            port: Mutex::new(None),
        }
    }
}

// ---------------------------------------------------------------------------
// Axum shared state
// ---------------------------------------------------------------------------

#[derive(Clone)]
struct AxumState {
    db_path: PathBuf,
    thumbnails_dir: PathBuf,
}

// ---------------------------------------------------------------------------
// Data types
// ---------------------------------------------------------------------------

#[derive(Serialize)]
struct VideoInfo {
    id: i64,
    path: String,
    title: Option<String>,
    duration: Option<f64>,
    thumbnail: Option<String>,
    rating: i64,
    progress: f64,
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

/// GET / — ブラウザ向け HTML UI
async fn index_page() -> Response {
    let html = r#"<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Chuck Snap Stack</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: system-ui, sans-serif; background: #111; color: #eee; min-height: 100vh; }
    header { background: #1a1a2e; padding: 14px 20px; display: flex; align-items: center; gap: 12px; border-bottom: 1px solid #333; position: sticky; top: 0; z-index: 10; }
    header h1 { font-size: 1.1rem; font-weight: 600; letter-spacing: .02em; }
    #search { flex: 1; max-width: 320px; padding: 6px 12px; border-radius: 6px; border: 1px solid #444; background: #222; color: #eee; font-size: .9rem; outline: none; }
    #search:focus { border-color: #6366f1; }
    #count { font-size: .8rem; color: #888; margin-left: auto; }
    #grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 12px; padding: 16px; }
    .card { background: #1c1c1c; border-radius: 8px; overflow: hidden; cursor: pointer; transition: transform .15s, box-shadow .15s; border: 1px solid #2a2a2a; }
    .card:hover { transform: translateY(-3px); box-shadow: 0 6px 20px rgba(0,0,0,.5); }
    .thumb { width: 100%; aspect-ratio: 16/9; object-fit: cover; background: #222; display: block; }
    .thumb-placeholder { width: 100%; aspect-ratio: 16/9; background: #222; display: flex; align-items: center; justify-content: center; font-size: 2rem; color: #444; }
    .info { padding: 8px 10px 10px; }
    .title { font-size: .78rem; font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; color: #ddd; }
    .meta { font-size: .7rem; color: #666; margin-top: 3px; display: flex; gap: 8px; }
    .stars { color: #f59e0b; }
    #overlay { display: none; position: fixed; inset: 0; background: rgba(0,0,0,.9); z-index: 100; flex-direction: column; align-items: center; justify-content: center; gap: 12px; }
    #overlay.open { display: flex; }
    #player { width: 90vw; max-width: 960px; max-height: 80vh; border-radius: 8px; background: #000; outline: none; }
    #overlay-title { font-size: .95rem; color: #ccc; max-width: 960px; width: 90vw; text-align: left; }
    #overlay-close { position: absolute; top: 16px; right: 20px; background: none; border: none; color: #aaa; font-size: 1.6rem; cursor: pointer; line-height: 1; }
    #overlay-close:hover { color: #fff; }
    #loading { text-align: center; padding: 80px 20px; color: #555; font-size: .9rem; }
  </style>
</head>
<body>
  <header>
    <h1>Chuck Snap Stack</h1>
    <input id="search" type="search" placeholder="タイトル・パスで検索..." />
    <span id="count"></span>
  </header>
  <div id="grid"><div id="loading">読み込み中...</div></div>

  <div id="overlay">
    <button id="overlay-close" onclick="closePlayer()">&#x2715;</button>
    <p id="overlay-title"></p>
    <video id="player" controls autoplay></video>
  </div>

  <script>
    let allVideos = [];

    function formatDuration(sec) {
      if (!sec) return '';
      const h = Math.floor(sec / 3600);
      const m = Math.floor((sec % 3600) / 60);
      const s = Math.floor(sec % 60);
      return h > 0
        ? h + ':' + String(m).padStart(2,'0') + ':' + String(s).padStart(2,'0')
        : m + ':' + String(s).padStart(2,'0');
    }

    function starsHtml(rating) {
      if (!rating) return '';
      return '<span class="stars">' + '\u2605'.repeat(rating) + '</span>';
    }

    function displayName(v) {
      if (v.title) return v.title;
      return v.path.split('/').pop() || v.path;
    }

    function thumbnailSrc(v) {
      if (!v.thumbnail) return null;
      const filename = v.thumbnail.split('/').pop();
      return '/api/thumbnails/' + encodeURIComponent(filename);
    }

    function escHtml(s) {
      return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    }

    function renderGrid(videos) {
      const grid = document.getElementById('grid');
      document.getElementById('count').textContent = videos.length + ' \u4ef6';
      if (videos.length === 0) {
        grid.innerHTML = '<div id="loading">\u52d5\u753b\u304c\u3042\u308a\u307e\u305b\u3093</div>';
        return;
      }
      grid.innerHTML = videos.map(v => {
        const name = displayName(v);
        const thumb = thumbnailSrc(v);
        const thumbHtml = thumb
          ? '<img class="thumb" src="' + thumb + '" loading="lazy" onerror="this.replaceWith(Object.assign(document.createElement(\'div\'),{className:\'thumb-placeholder\',textContent:\'\uD83C\uDFAC\'}))" />'
          : '<div class="thumb-placeholder">\uD83C\uDFAC</div>';
        const dur = formatDuration(v.duration);
        const prog = v.progress > 3 ? formatDuration(v.progress) : '';
        return '<div class="card" data-id="' + v.id + '" data-name="' + escHtml(name) + '">'
          + thumbHtml
          + '<div class="info">'
          + '<p class="title" title="' + escHtml(name) + '">' + escHtml(name) + '</p>'
          + '<p class="meta">'
          + (dur ? '<span>' + dur + '</span>' : '')
          + (prog ? '<span>\u25b6 ' + prog + '</span>' : '')
          + starsHtml(v.rating)
          + '</p></div></div>';
      }).join('');

      grid.querySelectorAll('.card').forEach(card => {
        card.addEventListener('click', () => {
          openPlayer(Number(card.dataset.id), card.dataset.name);
        });
      });
    }

    async function load() {
      const res = await fetch('/api/videos');
      allVideos = await res.json();
      renderGrid(allVideos);
    }

    document.getElementById('search').addEventListener('input', function() {
      const q = this.value.toLowerCase();
      const filtered = allVideos.filter(v =>
        displayName(v).toLowerCase().includes(q) || v.path.toLowerCase().includes(q)
      );
      renderGrid(filtered);
    });

    function openPlayer(id, title) {
      const overlay = document.getElementById('overlay');
      const player = document.getElementById('player');
      document.getElementById('overlay-title').textContent = title;
      player.src = '/api/stream/' + id;
      overlay.classList.add('open');
      player.focus();
    }

    function closePlayer() {
      const player = document.getElementById('player');
      player.pause();
      player.src = '';
      document.getElementById('overlay').classList.remove('open');
    }

    document.getElementById('overlay').addEventListener('click', function(e) {
      if (e.target === this) closePlayer();
    });

    document.addEventListener('keydown', function(e) {
      if (e.key === 'Escape') closePlayer();
    });

    load();
  </script>
</body>
</html>"#;

    Response::builder()
        .header("Content-Type", "text/html; charset=utf-8")
        .body(Body::from(html))
        .unwrap()
}

/// GET /api/videos — ライブラリ一覧を JSON で返す
async fn list_videos(State(state): State<AxumState>) -> Response {
    let db_path = state.db_path.clone();
    let result = tokio::task::spawn_blocking(move || {
        let conn = Connection::open_with_flags(
            &db_path,
            OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
        )?;
        let mut stmt = conn.prepare(
            "SELECT id, path, title, duration, thumbnail, rating, progress \
             FROM videos ORDER BY created_at DESC",
        )?;
        let videos: Vec<VideoInfo> = stmt
            .query_map([], |row| {
                Ok(VideoInfo {
                    id: row.get(0)?,
                    path: row.get(1)?,
                    title: row.get(2)?,
                    duration: row.get(3)?,
                    thumbnail: row.get(4)?,
                    rating: row.get(5)?,
                    progress: row.get(6)?,
                })
            })?
            .filter_map(|r| r.ok())
            .collect();
        Ok::<Vec<VideoInfo>, rusqlite::Error>(videos)
    })
    .await;

    match result {
        Ok(Ok(videos)) => Json(videos).into_response(),
        _ => StatusCode::INTERNAL_SERVER_ERROR.into_response(),
    }
}

/// GET /api/thumbnails/:filename — サムネイル画像を返す
async fn serve_thumbnail(
    State(state): State<AxumState>,
    Path(filename): Path<String>,
) -> Response {
    // パストラバーサル対策
    if !filename
        .chars()
        .all(|c| c.is_alphanumeric() || c == '_' || c == '.')
    {
        return StatusCode::BAD_REQUEST.into_response();
    }
    let path = state.thumbnails_dir.join(&filename);
    match tokio::fs::read(&path).await {
        Ok(bytes) => Response::builder()
            .header("Content-Type", "image/jpeg")
            .header("Cache-Control", "public, max-age=86400")
            .body(Body::from(bytes))
            .unwrap(),
        Err(_) => StatusCode::NOT_FOUND.into_response(),
    }
}

/// GET /api/stream/:id — HTTP Range に対応した動画ストリーミング
async fn stream_video(
    State(state): State<AxumState>,
    Path(id): Path<i64>,
    req_headers: HeaderMap,
) -> Response {
    // DB からパスを取得
    let db_path = state.db_path.clone();
    let path_result = tokio::task::spawn_blocking(move || {
        let conn = Connection::open_with_flags(
            &db_path,
            OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
        )?;
        let path: String = conn.query_row(
            "SELECT path FROM videos WHERE id = ?1",
            rusqlite::params![id],
            |row| row.get(0),
        )?;
        Ok::<String, rusqlite::Error>(path)
    })
    .await;

    let video_path = match path_result {
        Ok(Ok(p)) => p,
        _ => return StatusCode::NOT_FOUND.into_response(),
    };

    // ファイルを開く
    let mut file = match tokio::fs::File::open(&video_path).await {
        Ok(f) => f,
        Err(_) => return StatusCode::NOT_FOUND.into_response(),
    };
    let metadata = match file.metadata().await {
        Ok(m) => m,
        Err(_) => return StatusCode::INTERNAL_SERVER_ERROR.into_response(),
    };
    let file_size = metadata.len();

    // Range ヘッダーを解析
    let (start, end) = if let Some(range) = req_headers.get("range") {
        range
            .to_str()
            .ok()
            .and_then(|s| parse_range(s, file_size))
            .unwrap_or((0, file_size - 1))
    } else {
        (0, file_size - 1)
    };

    // 指定位置にシーク
    if start > 0 {
        if file.seek(std::io::SeekFrom::Start(start)).await.is_err() {
            return StatusCode::INTERNAL_SERVER_ERROR.into_response();
        }
    }

    let content_length = end - start + 1;
    let stream = tokio_util::io::ReaderStream::new(file.take(content_length));
    let mime = detect_mime(&video_path);

    let status = if start > 0 || end < file_size - 1 {
        StatusCode::PARTIAL_CONTENT
    } else {
        StatusCode::OK
    };

    Response::builder()
        .status(status)
        .header("Content-Type", mime)
        .header("Content-Length", content_length.to_string())
        .header(
            "Content-Range",
            format!("bytes {}-{}/{}", start, end, file_size),
        )
        .header("Accept-Ranges", "bytes")
        .body(Body::from_stream(stream))
        .unwrap_or_else(|_| StatusCode::INTERNAL_SERVER_ERROR.into_response())
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn parse_range(range_str: &str, file_size: u64) -> Option<(u64, u64)> {
    // "bytes=start-end" または "bytes=start-"
    let bytes_range = range_str.strip_prefix("bytes=")?;
    let parts: Vec<&str> = bytes_range.splitn(2, '-').collect();
    if parts.len() != 2 {
        return None;
    }
    let start = parts[0].parse::<u64>().ok()?;
    let end = if parts[1].is_empty() {
        file_size - 1
    } else {
        parts[1].parse::<u64>().ok()?.min(file_size - 1)
    };
    if start > end {
        return None;
    }
    Some((start, end))
}

fn detect_mime(path: &str) -> &'static str {
    let ext = std::path::Path::new(path)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();
    match ext.as_str() {
        "mp4" | "m4v" => "video/mp4",
        "mkv" => "video/x-matroska",
        "webm" => "video/webm",
        "avi" => "video/x-msvideo",
        "mov" => "video/quicktime",
        "flv" => "video/x-flv",
        _ => "application/octet-stream",
    }
}

// ---------------------------------------------------------------------------
// Tauri コマンド
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn start_web_server(
    app: tauri::AppHandle,
    state: tauri::State<'_, WebServerState>,
    port: u16,
) -> Result<u16, String> {
    let mut handle = state.handle.lock().await;
    if handle.is_some() {
        return Err("Web server is already running".to_string());
    }

    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e: tauri::Error| e.to_string())?;
    let db_path = app_data_dir.join("videos.db");
    let thumbnails_dir = app_data_dir.join("thumbnails");

    let axum_state = AxumState {
        db_path,
        thumbnails_dir,
    };

    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any);

    let router = Router::new()
        .route("/", get(index_page))
        .route("/api/videos", get(list_videos))
        .route("/api/thumbnails/:filename", get(serve_thumbnail))
        .route("/api/stream/:id", get(stream_video))
        .layer(cors)
        .with_state(axum_state);

    let listener = tokio::net::TcpListener::bind(format!("0.0.0.0:{}", port))
        .await
        .map_err(|e| e.to_string())?;

    let actual_port = listener
        .local_addr()
        .map_err(|e| e.to_string())?
        .port();

    let server_handle = tokio::spawn(async move {
        let _ = axum::serve(listener, router).await;
    });

    *handle = Some(server_handle);
    *state.port.lock().unwrap() = Some(actual_port);

    Ok(actual_port)
}

#[tauri::command]
pub async fn stop_web_server(state: tauri::State<'_, WebServerState>) -> Result<(), String> {
    let mut handle = state.handle.lock().await;
    if let Some(h) = handle.take() {
        h.abort();
    }
    *state.port.lock().unwrap() = None;
    Ok(())
}

#[tauri::command]
pub fn get_web_server_port(state: tauri::State<'_, WebServerState>) -> Option<u16> {
    *state.port.lock().unwrap()
}

/// LAN 向けのローカル IP アドレスを返す
#[tauri::command]
pub fn get_local_ip() -> Option<String> {
    use std::net::UdpSocket;
    // 実際には送信しない。ルーティングテーブルから送信元 IP を取得するだけ
    let socket = UdpSocket::bind("0.0.0.0:0").ok()?;
    socket.connect("8.8.8.8:80").ok()?;
    let addr = socket.local_addr().ok()?;
    Some(addr.ip().to_string())
}
