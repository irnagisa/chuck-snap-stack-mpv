use serde::Serialize;
use walkdir::WalkDir;

const VIDEO_EXTENSIONS: &[&str] = &["mp4", "mkv", "webm", "avi", "mov", "m4v", "flv", "wmv"];

#[derive(Serialize)]
pub struct ScannedFile {
    pub path: String,
    pub title: String,
}

#[tauri::command]
pub async fn scan_directory(path: String) -> Result<Vec<ScannedFile>, String> {
    let mut files = Vec::new();

    for entry in WalkDir::new(&path).follow_links(true) {
        let entry = entry.map_err(|e| e.to_string())?;
        if !entry.file_type().is_file() {
            continue;
        }
        let ext = entry
            .path()
            .extension()
            .and_then(|e| e.to_str())
            .map(|e| e.to_lowercase())
            .unwrap_or_default();
        if VIDEO_EXTENSIONS.contains(&ext.as_str()) {
            let title = entry
                .path()
                .file_stem()
                .and_then(|s| s.to_str())
                .unwrap_or("")
                .to_string();
            files.push(ScannedFile {
                path: entry.path().to_string_lossy().to_string(),
                title,
            });
        }
    }

    Ok(files)
}
