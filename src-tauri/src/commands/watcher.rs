use notify::{EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use tauri::Emitter;
use std::collections::HashMap;
use std::sync::{Arc, Mutex};

pub type SharedWatcherState = Arc<Mutex<HashMap<String, RecommendedWatcher>>>;

pub fn new_watcher_state() -> SharedWatcherState {
    Arc::new(Mutex::new(HashMap::new()))
}

const VIDEO_EXTENSIONS: &[&str] = &["mp4", "mkv", "webm", "avi", "mov", "m4v", "flv", "wmv"];

#[derive(Clone, serde::Serialize)]
pub struct FileEventPayload {
    pub path: String,
    pub title: String,
}

#[tauri::command]
pub async fn start_watching(
    state: tauri::State<'_, SharedWatcherState>,
    app_handle: tauri::AppHandle,
    path: String,
) -> Result<(), String> {
    let canonical = std::fs::canonicalize(&path)
        .map_err(|e| e.to_string())?
        .to_string_lossy()
        .to_string();

    {
        let guard = state.lock().unwrap();
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

    state.lock().unwrap().insert(canonical, watcher);

    let handle = app_handle.clone();
    std::thread::spawn(move || {
        let is_video = |p: &std::path::Path| {
            p.extension()
                .and_then(|e| e.to_str())
                .map(|ext| VIDEO_EXTENSIONS.contains(&ext))
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
                    _ => {}
                }
            }
        }
    });

    Ok(())
}

#[tauri::command]
pub async fn stop_watching(
    state: tauri::State<'_, SharedWatcherState>,
    path: String,
) -> Result<(), String> {
    let canonical = std::fs::canonicalize(&path)
        .unwrap_or_else(|_| std::path::PathBuf::from(&path))
        .to_string_lossy()
        .to_string();
    state.lock().unwrap().remove(&canonical);
    Ok(())
}
