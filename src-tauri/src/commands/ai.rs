use std::path::PathBuf;
use tauri::{AppHandle, Manager};
use tauri::Emitter;
use tauri_plugin_notification::NotificationExt;
use serde::Serialize;
use crate::ai::{AiTaggerState, ModelKind, Tagger, suggest};
use crate::ai::suggest::AiSuggestionResult;
use crate::ai::wd_tagger::WdTagger;
use crate::ai::joytag::JoyTagger;
use crate::db::DbState;

// ── WD Tagger ────────────────────────────────────────────────────────────────

const WD_MODEL_URL: &str =
    "https://huggingface.co/SmilingWolf/wd-vit-tagger-v3/resolve/main/model.onnx";
const WD_TAGS_URL: &str =
    "https://huggingface.co/SmilingWolf/wd-vit-tagger-v3/resolve/main/selected_tags.csv";
const WD_MODEL_SHA256: &str =
    "35f23693620b668f4d53fd3c62bf65e40af739bc52c7eb0fbc49258b58d065b6";
const WD_TAGS_SHA256: &str =
    "298633d94d0031d2081c0893f29c82eab7f0df00b08483ba8f29d1e979441217";

// ── JoyTag ───────────────────────────────────────────────────────────────────

const JOYTAG_MODEL_URL: &str =
    "https://huggingface.co/fancyfeast/joytag/resolve/main/model.onnx";
const JOYTAG_TAGS_URL: &str =
    "https://huggingface.co/fancyfeast/joytag/resolve/main/top_tags.txt";
const JOYTAG_MODEL_SHA256: &str =
    "f85b7130e6e549b5b0822537007b7482e8c4c8e754c8d9a5bee08e27050e1097";
const JOYTAG_TAGS_SHA256: &str =
    "32b1963a234af848643b2bbf47d8eff1f1c7889406810c57b980f41b2b9e01d0";

// ─────────────────────────────────────────────────────────────────────────────

#[derive(Serialize)]
pub struct ModelStatus {
    pub downloaded: bool,
    pub downloading: bool,
    pub progress: f32,
}

fn ai_dir(app: &AppHandle, model_kind: &ModelKind) -> Result<PathBuf, String> {
    let base = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?;
    Ok(base.join("ai").join(model_kind.as_str()))
}

fn model_path(app: &AppHandle, kind: &ModelKind) -> Result<PathBuf, String> {
    Ok(ai_dir(app, kind)?.join("model.onnx"))
}

fn tags_path(app: &AppHandle, kind: &ModelKind) -> Result<PathBuf, String> {
    let filename = match kind {
        ModelKind::WdTagger => "selected_tags.csv",
        ModelKind::JoyTag => "top_tags.txt",
    };
    Ok(ai_dir(app, kind)?.join(filename))
}

/// Returns current model download / load status for the specified model type.
#[tauri::command]
pub async fn check_ai_model_status(
    app: AppHandle,
    state: tauri::State<'_, AiTaggerState>,
    model_type: String,
) -> Result<ModelStatus, String> {
    let kind = ModelKind::from_str(&model_type);
    let inner = state.0.lock().map_err(|e| e.to_string())?;
    let model_exists = model_path(&app, &kind)?.exists() && tags_path(&app, &kind)?.exists();
    Ok(ModelStatus {
        downloaded: model_exists,
        downloading: inner.downloading,
        progress: inner.download_progress,
    })
}

/// Download model files for the specified model type; emits "ai://download-progress" events.
#[tauri::command]
pub async fn download_ai_model(
    app: AppHandle,
    state: tauri::State<'_, AiTaggerState>,
    model_type: String,
) -> Result<(), String> {
    let kind = ModelKind::from_str(&model_type);

    // Guard: already downloading?
    {
        let mut inner = state.0.lock().map_err(|e| e.to_string())?;
        if inner.downloading {
            return Err("既にダウンロード中です".into());
        }
        inner.downloading = true;
        inner.download_progress = 0.0;
    }

    let dir = ai_dir(&app, &kind)?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;

    let result = download_files(&app, &dir, &state, &kind).await;

    {
        let mut inner = state.0.lock().map_err(|e| e.to_string())?;
        inner.downloading = false;
        inner.download_progress = if result.is_ok() { 1.0 } else { 0.0 };
        // Unload any cached tagger so the newly downloaded model is loaded fresh.
        if result.is_ok() {
            inner.tagger = None;
            inner.loaded_kind = None;
        }
    }

    if result.is_ok() {
        if let Err(e) = app.notification()
            .builder()
            .title("AIモデルのダウンロード完了")
            .body("AIタグ解析モデルがダウンロードされました")
            .show()
        {
            log::warn!("[notification] AIモデル通知の送信に失敗しました: {e}");
        }
    }

    result
}

async fn download_files(
    app: &AppHandle,
    dir: &PathBuf,
    state: &tauri::State<'_, AiTaggerState>,
    kind: &ModelKind,
) -> Result<(), String> {
    use futures_util::StreamExt;

    let (tags_url, tags_sha256, model_url, model_sha256, tags_filename) = match kind {
        ModelKind::WdTagger => (
            WD_TAGS_URL, WD_TAGS_SHA256,
            WD_MODEL_URL, WD_MODEL_SHA256,
            "selected_tags.csv",
        ),
        ModelKind::JoyTag => (
            JOYTAG_TAGS_URL, JOYTAG_TAGS_SHA256,
            JOYTAG_MODEL_URL, JOYTAG_MODEL_SHA256,
            "top_tags.txt",
        ),
    };

    // Tags file is small — download first as 0–5%
    let tags_dest = dir.join(tags_filename);
    if !tags_dest.exists() {
        let resp = reqwest::get(tags_url).await.map_err(|e| e.to_string())?;
        let bytes = resp.bytes().await.map_err(|e| e.to_string())?;
        std::fs::write(&tags_dest, &bytes).map_err(|e| e.to_string())?;
        if !tags_sha256.is_empty() {
            verify_sha256(&tags_dest, tags_sha256)?;
        }
    }
    emit_progress(app, state, 0.05);

    // Model ONNX is large — stream with progress
    let model_dest = dir.join("model.onnx");
    if !model_dest.exists() {
        let resp = reqwest::get(model_url).await.map_err(|e| e.to_string())?;
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
        if !model_sha256.is_empty() {
            verify_sha256(&tmp, model_sha256)?;
        }
        std::fs::rename(&tmp, &model_dest).map_err(|e| e.to_string())?;
    }

    emit_progress(app, state, 1.0);
    Ok(())
}

/// Compute the SHA-256 digest of `path` and compare it to `expected` (lowercase hex).
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
/// The model used is determined by the `ai_model_type` DB setting.
#[tauri::command]
pub async fn analyze_thumbnail_for_tags(
    app: AppHandle,
    db: tauri::State<'_, DbState>,
    ai: tauri::State<'_, AiTaggerState>,
    video_id: i64,
) -> Result<AiSuggestionResult, String> {
    // Read model type from settings
    let model_kind = {
        let conn = db.conn()?;
        let kind_str: Option<String> = conn
            .query_row(
                "SELECT value FROM settings WHERE key = 'ai_model_type'",
                [],
                |r| r.get(0),
            )
            .ok();
        ModelKind::from_str(kind_str.as_deref().unwrap_or("wd-tagger"))
    };

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

    // Lazy-load model — reload if a different model type is now selected
    let needs_load = {
        let inner = ai.0.lock().map_err(|e| e.to_string())?;
        inner.tagger.is_none() || inner.loaded_kind.as_ref() != Some(&model_kind)
    };

    if needs_load {
        let mp = model_path(&app, &model_kind)?;
        let tp = tags_path(&app, &model_kind)?;
        if !mp.exists() || !tp.exists() {
            return Err("AIモデルがダウンロードされていません".into());
        }

        let kind_for_load = model_kind.clone();
        let tagger: std::sync::Arc<dyn Tagger + Send + Sync> = match kind_for_load {
            ModelKind::WdTagger => {
                let mp2 = mp.clone();
                let tp2 = tp.clone();
                let t = tokio::task::spawn_blocking(move || {
                    verify_sha256(&mp2, WD_MODEL_SHA256)?;
                    verify_sha256(&tp2, WD_TAGS_SHA256)?;
                    WdTagger::load(&mp2, &tp2)
                })
                .await
                .map_err(|e| e.to_string())??;
                std::sync::Arc::new(t)
            }
            ModelKind::JoyTag => {
                let t = tokio::task::spawn_blocking(move || {
                    JoyTagger::load(&mp, &tp)
                })
                .await
                .map_err(|e| e.to_string())??;
                std::sync::Arc::new(t)
            }
        };

        let mut inner = ai.0.lock().map_err(|e| e.to_string())?;
        inner.tagger = Some(tagger);
        inner.loaded_kind = Some(model_kind.clone());
    }

    // Run inference — clone Arc to release the lock before the blocking call
    let tagger = {
        let inner = ai.0.lock().map_err(|e| e.to_string())?;
        inner.tagger.clone().ok_or("モデルのロードに失敗")?
    };
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
