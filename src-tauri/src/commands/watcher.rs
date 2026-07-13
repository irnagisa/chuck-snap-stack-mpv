use notify::{EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use tauri::Emitter;
use std::collections::HashMap;
use std::sync::{Arc, Mutex};

pub type SharedWatcherState = Arc<Mutex<HashMap<String, RecommendedWatcher>>>;

pub fn new_watcher_state() -> SharedWatcherState {
    Arc::new(Mutex::new(HashMap::new()))
}

const VIDEO_EXTENSIONS: &[&str] = &["mp4", "mkv", "webm", "avi", "mov", "m4v", "flv", "wmv", "mpg", "mpeg", "media"];

#[derive(Clone, serde::Serialize)]
pub struct FileEventPayload {
    pub path: String,
    pub title: String,
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
    let canonical = tokio::fs::canonicalize(&path)
        .await
        .map_err(|e| format!("パスの正規化に失敗しました ({path}): {e}"))?
        .to_string_lossy()
        .to_string();

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
    let canonical_for_log = canonical;
    std::thread::spawn(move || {
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        let is_video = |p: &std::path::Path| {
            p.extension()
                .and_then(|e| e.to_str())
                .map(|ext| VIDEO_EXTENSIONS.contains(&ext.to_lowercase().as_str()))
                .unwrap_or(false)
        };
        for result in rx {
            if let Ok(event) = result {
                match event.kind {
                    EventKind::Create(_) => {
                        for p in event.paths.iter().filter(|p| is_video(p)) {
                            let payload = FileEventPayload {
                                path: p.to_string_lossy().to_string(),
                                title: p
                                    .file_stem()
                                    .and_then(|s| s.to_str())
                                    .unwrap_or("")
                                    .to_string(),
                            };
                            let _ = handle.emit("video-file-created", payload);
                        }
                    }
                    EventKind::Remove(_) => {
                        for p in event.paths.iter().filter(|p| is_video(p)) {
                            let _ = handle.emit(
                                "video-file-removed",
                                p.to_string_lossy().to_string(),
                            );
                        }
                    }
                    EventKind::Modify(notify::event::ModifyKind::Name(rename_mode)) => {
                        use notify::event::RenameMode;
                        match rename_mode {
                            RenameMode::Both => {
                                if event.paths.len() == 2 {
                                    let old = &event.paths[0];
                                    let new = &event.paths[1];
                                    if is_video(new) {
                                        let payload = RenameEventPayload {
                                            old_path: old.to_string_lossy().to_string(),
                                            new_path: new.to_string_lossy().to_string(),
                                            title: new
                                                .file_stem()
                                                .and_then(|s| s.to_str())
                                                .unwrap_or("")
                                                .to_string(),
                                        };
                                        let _ = handle.emit("video-file-renamed", payload);
                                    } else if is_video(old) {
                                        // 動画以外の拡張子にリネームされた場合は削除扱い
                                        let _ = handle.emit(
                                            "video-file-removed",
                                            old.to_string_lossy().to_string(),
                                        );
                                    }
                                }
                            }
                            RenameMode::From => {
                                // 旧パスのみ判明 (ディレクトリ外へ移動など): 削除扱い
                                for p in event.paths.iter().filter(|p| is_video(p)) {
                                    let _ = handle.emit(
                                        "video-file-removed",
                                        p.to_string_lossy().to_string(),
                                    );
                                }
                            }
                            RenameMode::To => {
                                // 新パスのみ判明 (ディレクトリ内へ移動など): 追加扱い
                                for p in event.paths.iter().filter(|p| is_video(p)) {
                                    let payload = FileEventPayload {
                                        path: p.to_string_lossy().to_string(),
                                        title: p
                                            .file_stem()
                                            .and_then(|s| s.to_str())
                                            .unwrap_or("")
                                            .to_string(),
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
            log::error!("[watcher] イベント処理スレッドがパニックしました (path={}): {msg}", canonical_for_log);
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
        .map(|p| p.to_string_lossy().into_owned());
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
