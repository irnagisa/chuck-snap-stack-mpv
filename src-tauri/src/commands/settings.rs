// アプリ設定の保持・更新コマンド

use std::sync::{Arc, Mutex};

pub struct AppSettings {
    pub mpv_path: String,
    pub ffmpeg_path: String,
    pub ffprobe_path: String,
    pub ytdlp_path: String,
}

pub type SharedAppSettings = Arc<Mutex<AppSettings>>;

impl AppSettings {
    pub fn new() -> SharedAppSettings {
        Arc::new(Mutex::new(AppSettings {
            mpv_path: detect_mpv_path(),
            ffmpeg_path: "ffmpeg".to_string(),
            ffprobe_path: "ffprobe".to_string(),
            ytdlp_path: String::new(),
        }))
    }
}

/// macOS の一般的なインストール場所を順に試し、最初に見つかったパスを返す。
/// 見つからない場合は "mpv"（PATH 依存）を返す。
fn detect_mpv_path() -> String {
    const CANDIDATES: &[&str] = &[
        "/opt/homebrew/bin/mpv",  // Apple Silicon Homebrew
        "/usr/local/bin/mpv",     // Intel Homebrew
        "/usr/bin/mpv",
    ];
    for path in CANDIDATES {
        if std::path::Path::new(path).exists() {
            return path.to_string();
        }
    }
    "mpv".to_string()
}

/// 自動検出した mpv パスをフロントエンドに返す。
#[tauri::command]
pub async fn get_default_mpv_path() -> String {
    detect_mpv_path()
}

/// 指定パスがファイルとして存在するか確認する。
#[tauri::command]
pub async fn path_exists(path: String) -> bool {
    std::path::Path::new(&path).exists()
}

/// 実行ファイルパスを検証する。
/// - NULL バイト・改行文字を拒否
/// - `..` を含む相対パスを拒否 (PATH ハイジャック防止)
/// - 絶対パスの場合はファイル存在・実行権限を確認
fn validate_executable_path(path: &str, name: &str) -> Result<(), String> {
    if path.is_empty() {
        return Err(format!("{name} のパスが空です"));
    }
    if path.contains('\0') || path.contains('\n') || path.contains('\r') {
        return Err(format!("{name} のパスに無効な文字が含まれています"));
    }
    // `..` コンポーネントを含むパスは PATH ハイジャックに悪用される恐れがある
    for component in std::path::Path::new(path).components() {
        if component == std::path::Component::ParentDir {
            return Err(format!("{name} のパスに '..' を含めることはできません"));
        }
    }
    // 絶対パスの場合のみ存在・実行可能チェック
    if path.starts_with('/') {
        let meta = std::fs::metadata(path)
            .map_err(|_| format!("{name} が見つかりません。パスが正しいか確認してください"))?;
        if !meta.is_file() {
            return Err(format!("{name} はファイルではありません"));
        }
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            if meta.permissions().mode() & 0o111 == 0 {
                return Err(format!("{name} は実行可能ではありません"));
            }
        }
    }
    Ok(())
}

/// フロントエンドから設定値を受け取り、Rust 側の状態を更新する。
#[tauri::command]
pub async fn update_settings(
    state: tauri::State<'_, SharedAppSettings>,
    mpv_path: String,
    ffmpeg_path: String,
    ffprobe_path: String,
    ytdlp_path: String,
) -> Result<(), String> {
    validate_executable_path(&mpv_path, "mpv")?;
    validate_executable_path(&ffmpeg_path, "ffmpeg")?;
    validate_executable_path(&ffprobe_path, "ffprobe")?;
    // ytdlp_path は空可（PATH 依存）なので空の場合はスキップ
    if !ytdlp_path.is_empty() {
        validate_executable_path(&ytdlp_path, "yt-dlp")?;
    }

    let mut s = state.lock().map_err(|e| e.to_string())?;
    s.mpv_path = mpv_path;
    s.ffmpeg_path = ffmpeg_path;
    s.ffprobe_path = ffprobe_path;
    s.ytdlp_path = ytdlp_path;
    Ok(())
}
