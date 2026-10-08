use notify::{EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use tauri::Emitter;
use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use super::utils::normalize_path_str;

pub type SharedWatcherState = Arc<Mutex<HashMap<String, RecommendedWatcher>>>;

pub fn new_watcher_state() -> SharedWatcherState {
    Arc::new(Mutex::new(HashMap::new()))
}

const VIDEO_EXTENSIONS: &[&str] = &["mp4", "mkv", "webm", "avi", "mov", "m4v", "flv", "wmv", "mpg", "mpeg", "media"];

/// notify (OS 通知) から得るパスは macOS では NFD 分解形の可能性があるため、
/// DB との突合前に NFC へ正規化する (normalize_path_str のドキュメント参照)。
fn normalize_event_path(p: &std::path::Path) -> String {
    normalize_path_str(&p.to_string_lossy())
}

fn event_title(p: &std::path::Path) -> String {
    normalize_path_str(p.file_stem().and_then(|s| s.to_str()).unwrap_or(""))
}

#[derive(Clone, serde::Serialize)]
pub struct FileEventPayload {
    pub path: String,
    pub title: String,
}

#[derive(Clone, serde::Serialize)]
pub struct WatchDirRenamedPayload {
    pub old_dir: String,
    pub new_dir: String,
}

#[derive(Clone, serde::Serialize)]
pub struct RenameEventPayload {
    pub old_path: String,
    pub new_path: String,
    pub title: String,
}

#[tauri::command]
pub async fn start_watching(
    state: tauri::State<'_, SharedWatcherState>,
    app_handle: tauri::AppHandle,
    path: String,
) -> Result<(), String> {
    let canonical = normalize_path_str(
        &tokio::fs::canonicalize(&path)
            .await
            .map_err(|e| format!("パスの正規化に失敗しました ({path}): {e}"))?
            .to_string_lossy(),
    );

    {
        let guard = state.lock().map_err(|e| e.to_string())?;
        if guard.contains_key(&canonical) {
            return Ok(());
        }
    }

    let (tx, rx) = std::sync::mpsc::channel();
    let mut watcher = notify::recommended_watcher(tx).map_err(|e| e.to_string())?;
    watcher
        .watch(
            std::path::Path::new(&canonical),
            RecursiveMode::Recursive,
        )
        .map_err(|e| e.to_string())?;

    state
        .lock()
        .map_err(|e| e.to_string())?
        .insert(canonical.clone(), watcher);

    let handle = app_handle.clone();
    let watched_dir = canonical;
    std::thread::spawn(move || {
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        let is_video = |p: &std::path::Path| {
            p.extension()
                .and_then(|e| e.to_str())
                .map(|ext| VIDEO_EXTENSIONS.contains(&ext.to_lowercase().as_str()))
                .unwrap_or(false)
        };
        let mut dir_removed_emitted = false;
        for result in rx {
            if let Ok(event) = result {
                let norm = normalize_event_path;
                let title_of = event_title;
                match event.kind {
                    EventKind::Create(_) => {
                        for p in event.paths.iter().filter(|p| is_video(p)) {
                            let payload = FileEventPayload {
                                path: norm(p),
                                title: title_of(p),
                            };
                            let _ = handle.emit("video-file-created", payload);
                        }
                    }
                    EventKind::Remove(_) => {
                        // 監視ディレクトリ自体が削除されたか確認
                        let dir_removed = event.paths.iter().any(|p| norm(p) == watched_dir);
                        if dir_removed && !dir_removed_emitted {
                            dir_removed_emitted = true;
                            let _ = handle.emit("watch-dir-removed", watched_dir.clone());
                        } else {
                            for p in event.paths.iter().filter(|p| is_video(p)) {
                                let _ = handle.emit("video-file-removed", norm(p));
                            }
                        }
                    }
                    EventKind::Modify(notify::event::ModifyKind::Name(rename_mode)) => {
                        use notify::event::RenameMode;
                        match rename_mode {
                            RenameMode::Both => {
                                if event.paths.len() == 2 {
                                    let old = &event.paths[0];
                                    let new = &event.paths[1];
                                    // 監視ディレクトリ自体がリネーム/移動された場合
                                    if norm(old) == watched_dir {
                                        let payload = WatchDirRenamedPayload {
                                            old_dir: norm(old),
                                            new_dir: norm(new),
                                        };
                                        let _ = handle.emit("watch-dir-renamed", payload);
                                    } else if is_video(new) {
                                        let payload = RenameEventPayload {
                                            old_path: norm(old),
                                            new_path: norm(new),
                                            title: title_of(new),
                                        };
                                        let _ = handle.emit("video-file-renamed", payload);
                                    } else if is_video(old) {
                                        // 動画以外の拡張子にリネームされた場合は削除扱い
                                        let _ = handle.emit("video-file-removed", norm(old));
                                    }
                                }
                            }
                            RenameMode::From => {
                                // 旧パスのみ判明 (ディレクトリ外へ移動など): 削除扱い
                                for p in event.paths.iter().filter(|p| is_video(p)) {
                                    let _ = handle.emit("video-file-removed", norm(p));
                                }
                            }
                            RenameMode::To => {
                                // 新パスのみ判明 (ディレクトリ内へ移動など): 追加扱い
                                for p in event.paths.iter().filter(|p| is_video(p)) {
                                    let payload = FileEventPayload {
                                        path: norm(p),
                                        title: title_of(p),
                                    };
                                    let _ = handle.emit("video-file-created", payload);
                                }
                            }
                            _ => {}
                        }
                    }
                    _ => {}
                }
            }
        }
        }));
        if let Err(e) = result {
            let msg = e.downcast_ref::<&str>().copied()
                .or_else(|| e.downcast_ref::<String>().map(|s| s.as_str()))
                .unwrap_or("不明なエラー");
            log::error!("[watcher] イベント処理スレッドがパニックしました (path={}): {msg}", watched_dir);
        }
    });

    Ok(())
}

#[tauri::command]
pub async fn stop_watching(
    state: tauri::State<'_, SharedWatcherState>,
    path: String,
) -> Result<(), String> {
    let canonical = tokio::fs::canonicalize(&path)
        .await
        .map(|p| normalize_path_str(&p.to_string_lossy()));
    let mut guard = state.lock().map_err(|e| e.to_string())?;
    // 正規化パスで検索し、見つからない場合は元パスでも試みる
    let removed = if let Ok(ref c) = canonical {
        guard.remove(c).is_some()
    } else {
        false
    };
    if !removed {
        guard.remove(&path);
    }
    Ok(())
}

#[tauri::command]
pub async fn get_watching_paths(
    state: tauri::State<'_, SharedWatcherState>,
) -> Result<Vec<String>, String> {
    let guard = state.lock().map_err(|e| e.to_string())?;
    Ok(guard.keys().cloned().collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalize_event_path_composes_nfd_path_to_nfc() {
        let nfd_path = std::path::Path::new("/Users/foo/\u{304B}\u{3099}.mp4");
        assert_eq!(normalize_event_path(nfd_path), "/Users/foo/\u{304C}.mp4");
    }

    #[test]
    fn event_title_composes_nfd_stem_to_nfc() {
        let nfd_path = std::path::Path::new("/Users/foo/\u{304B}\u{3099}.mp4");
        assert_eq!(event_title(nfd_path), "\u{304C}");
    }

    #[test]
    fn event_title_handles_no_stem() {
        let path = std::path::Path::new("/");
        assert_eq!(event_title(path), "");
    }
}
