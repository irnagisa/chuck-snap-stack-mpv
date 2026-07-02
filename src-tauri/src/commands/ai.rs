use std::path::PathBuf;
use tauri::{AppHandle, Manager};
use tauri::Emitter;
use serde::Serialize;
use crate::ai::{AiTaggerState, suggest};
use crate::ai::suggest::AiSuggestionResult;
use crate::ai::wd_tagger::WdTagger;
use crate::db::DbState;

const MODEL_URL: &str =
    "https://huggingface.co/SmilingWolf/wd-vit-tagger-v3/resolve/main/model.onnx";
const TAGS_URL: &str =
    "https://huggingface.co/SmilingWolf/wd-vit-tagger-v3/resolve/main/selected_tags.csv";

/// Expected SHA-256 digests for the downloaded model files (LFS / curl-verified).
const MODEL_SHA256: &str = "35f23693620b668f4d53fd3c62bf65e40af739bc52c7eb0fbc49258b58d065b6";
const TAGS_SHA256: &str  = "298633d94d0031d2081c0893f29c82eab7f0df00b08483ba8f29d1e979441217";

#[derive(Serialize)]
pub struct ModelStatus {
    pub downloaded: bool,
    pub downloading: bool,
    pub progress: f32,
}

fn ai_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let base = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?;
    Ok(base.join("ai").join("wd-tagger"))
}

fn model_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(ai_dir(app)?.join("model.onnx"))
}

fn tags_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(ai_dir(app)?.join("selected_tags.csv"))
}

/// Returns current model download / load status.
#[tauri::command]
pub async fn check_ai_model_status(
    app: AppHandle,
    state: tauri::State<'_, AiTaggerState>,
) -> Result<ModelStatus, String> {
    let inner = state.0.lock().map_err(|e| e.to_string())?;
    let model_exists = model_path(&app)?.exists() && tags_path(&app)?.exists();
    Ok(ModelStatus {
        downloaded: model_exists,
        downloading: inner.downloading,
        progress: inner.download_progress,
    })
}

/// Download model files from HuggingFace; emits "ai://download-progress" events.
#[tauri::command]
pub async fn download_ai_model(
    app: AppHandle,
    state: tauri::State<'_, AiTaggerState>,
) -> Result<(), String> {
    // Guard: already downloading?
    {
        let mut inner = state.0.lock().map_err(|e| e.to_string())?;
        if inner.downloading {
            return Err("既にダウンロード中です".into());
        }
        inner.downloading = true;
        inner.download_progress = 0.0;
    }

    let dir = ai_dir(&app)?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;

    let result = download_files(&app, &dir, &state).await;

    {
        let mut inner = state.0.lock().map_err(|e| e.to_string())?;
        inner.downloading = false;
        inner.download_progress = if result.is_ok() { 1.0 } else { 0.0 };
    }

    result
}

async fn download_files(
    app: &AppHandle,
    dir: &PathBuf,
    state: &tauri::State<'_, AiTaggerState>,
) -> Result<(), String> {
    use futures_util::StreamExt;

    // Tags CSV is small (~1MB) — download first as 0-5%
    let tags_dest = dir.join("selected_tags.csv");
    if !tags_dest.exists() {
        let resp = reqwest::get(TAGS_URL).await.map_err(|e| e.to_string())?;
        let bytes = resp.bytes().await.map_err(|e| e.to_string())?;
        std::fs::write(&tags_dest, &bytes).map_err(|e| e.to_string())?;
        verify_sha256(&tags_dest, TAGS_SHA256)?;
    }
    emit_progress(app, state, 0.05);

    // Model ONNX is large (~200MB) — stream with progress
    let model_dest = dir.join("model.onnx");
    if !model_dest.exists() {
        let resp = reqwest::get(MODEL_URL).await.map_err(|e| e.to_string())?;
        let total = resp.content_length().unwrap_or(0);
        let mut stream = resp.bytes_stream();
        let tmp = dir.join("model.onnx.tmp");
        {
            use std::io::Write;
            let mut file = std::fs::File::create(&tmp).map_err(|e| e.to_string())?;
            let mut downloaded: u64 = 0;
            while let Some(chunk) = stream.next().await {
                let chunk = chunk.map_err(|e| e.to_string())?;
                file.write_all(&chunk).map_err(|e| e.to_string())?;
                downloaded += chunk.len() as u64;
                if total > 0 {
                    let frac = 0.05 + 0.95 * (downloaded as f32 / total as f32);
                    emit_progress(app, state, frac);
                }
            }
        }
        verify_sha256(&tmp, MODEL_SHA256)?;
        std::fs::rename(&tmp, &model_dest).map_err(|e| e.to_string())?;
    }

    emit_progress(app, state, 1.0);
    Ok(())
}

/// Compute the SHA-256 digest of `path` and compare it to `expected` (lowercase hex).
/// Returns `Err` if the file cannot be read or the digest does not match.
fn verify_sha256(path: &std::path::Path, expected: &str) -> Result<(), String> {
    use sha2::{Digest, Sha256};
    use std::io::Read;

    let mut file = std::fs::File::open(path).map_err(|e| e.to_string())?;
    let mut hasher = Sha256::new();
    let mut buf = [0u8; 65536];
    loop {
        let n = file.read(&mut buf).map_err(|e| e.to_string())?;
        if n == 0 { break; }
        hasher.update(&buf[..n]);
    }
    let actual = format!("{:x}", hasher.finalize());
    if actual != expected {
        // Remove the corrupted/untrusted file so the next download attempt starts fresh.
        let _ = std::fs::remove_file(path);
        return Err(format!(
            "整合性チェック失敗: {}\n  expected: {}\n  got:      {}",
            path.display(), expected, actual
        ));
    }
    Ok(())
}

fn emit_progress(
    app: &AppHandle,
    state: &tauri::State<'_, AiTaggerState>,
    progress: f32,
) {
    if let Ok(mut inner) = state.0.lock() {
        inner.download_progress = progress;
    }
    let _ = app.emit("ai://download-progress", progress);
}

/// Analyse the video's thumbnail and return tag suggestions.
#[tauri::command]
pub async fn analyze_thumbnail_for_tags(
    app: AppHandle,
    db: tauri::State<'_, DbState>,
    ai: tauri::State<'_, AiTaggerState>,
    video_id: i64,
) -> Result<AiSuggestionResult, String> {
    // Fetch thumbnail path and existing tags from DB
    let (thumbnail, user_tags) = {
        let conn = db.conn()?;
        let thumbnail: Option<String> = conn
            .query_row(
                "SELECT thumbnail FROM videos WHERE id = ?1",
                [video_id],
                |r| r.get(0),
            )
            .map_err(|e| e.to_string())?;

        let mut stmt = conn
            .prepare("SELECT id, name FROM tags")
            .map_err(|e| e.to_string())?;
        let user_tags: Vec<(i64, String)> = stmt
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))
            .map_err(|e| e.to_string())?
            .filter_map(|r| r.ok())
            .collect();

        (thumbnail, user_tags)
    };

    let thumb_path = thumbnail.ok_or_else(|| "サムネイルがありません".to_string())?;
    let thumb_path = std::path::PathBuf::from(&thumb_path);
    if !thumb_path.exists() {
        return Err("サムネイルファイルが見つかりません".into());
    }

    // Ensure model is loaded (lazy load)
    let needs_load = {
        let inner = ai.0.lock().map_err(|e| e.to_string())?;
        inner.tagger.is_none()
    };

    if needs_load {
        let mp = model_path(&app)?;
        let tp = tags_path(&app)?;
        if !mp.exists() || !tp.exists() {
            return Err("AIモデルがダウンロードされていません".into());
        }
        let tagger = tokio::task::spawn_blocking(move || {
            verify_sha256(&mp, MODEL_SHA256)?;
            verify_sha256(&tp, TAGS_SHA256)?;
            WdTagger::load(&mp, &tp)
        })
        .await
        .map_err(|e| e.to_string())??;
        let mut inner = ai.0.lock().map_err(|e| e.to_string())?;
        inner.tagger = Some(std::sync::Arc::new(tagger));
    }

    // Run inference — Arc::clone でロック解放後に推論する
    let tagger = {
        let inner = ai.0.lock().map_err(|e| e.to_string())?;
        inner.tagger.clone().ok_or("モデルのロードに失敗")?
    }; // ← ここでロック解放
    let ai_tags = tokio::task::block_in_place(|| tagger.run(&thumb_path))?;

    // Build suggestions
    let result = suggest::build_suggestions(&ai_tags, &user_tags, 20);

    // Persist to DB
    {
        let matched_json = serde_json::to_string(&result.matched_tags).unwrap_or_default();
        let new_json = serde_json::to_string(&result.new_suggestions).unwrap_or_default();
        let conn = db.conn()?;
        conn.execute(
            "UPDATE videos SET ai_tag_suggestions = ?1, ai_new_suggestions = ?2,
             ai_analyzed_at = datetime('now') WHERE id = ?3",
            rusqlite::params![matched_json, new_json, video_id],
        )
        .map_err(|e| e.to_string())?;
    }

    Ok(result)
}
