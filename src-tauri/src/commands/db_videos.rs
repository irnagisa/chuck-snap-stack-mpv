use rusqlite::OptionalExtension;
use serde::{Deserialize, Serialize};
use tauri::State;

use crate::commands::db_tags::build_category_hierarchy;
use crate::commands::library::scan_dir_core;
use crate::db::DbState;

// ── Types ─────────────────────────────────────────────────────────────────────

#[derive(Serialize, Deserialize, Clone)]
pub struct Video {
    pub id: i64,
    pub path: String,
    pub title: Option<String>,
    pub duration: Option<f64>,
    pub thumbnail: Option<String>,
    pub watched_at: Option<String>,
    pub progress: f64,
    pub rating: i64,
    pub category_id: Option<i64>,
    pub has_audio: Option<i64>,
    pub watch_count: i64,
    pub created_at: String,
    pub media_type: Option<String>,
    pub source_url: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FetchVideosResult {
    pub videos: Vec<Video>,
    pub total_count: i64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VideoFilter {
    pub filter_search: String,
    pub filter_category_id: Option<i64>,
    pub filter_tag_ids: Vec<i64>,
    pub filter_tag_mode: String,
    pub filter_min_rating: i64,
    pub filter_has_audio: Option<i64>,
    pub filter_min_duration: f64,
    pub filter_watched_status: String,
    pub filter_watch_dir: Option<String>,
    pub filter_media_type: String,
    pub filter_sort_by: String,
    pub filter_sort_order: String,
    pub current_page: i64,
    pub page_size: i64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WatchDir {
    pub path: String,
    pub use_dir_as_category: i64,
}

#[derive(Serialize)]
pub struct PendingThumbnail {
    pub id: i64,
    pub path: String,
    pub thumbnail: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ThumbnailUpdate {
    pub id: i64,
    pub thumbnail: Option<String>,
    pub duration: Option<f64>,
    pub has_audio: i64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioUpdate {
    pub id: i64,
    pub has_audio: i64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanImportResult {
    pub new_count: i64,
    pub scanned_count: i64,
    pub errors: Vec<String>,
    pub truncated: bool,
    pub skipped_count: u32,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RescanResult {
    pub new_count: i64,
    pub scanned_count: i64,
    pub errors: Vec<String>,
    pub truncated: bool,
    pub skipped_count: u32,
}

#[derive(Deserialize)]
pub struct WatcherCreate {
    pub path: String,
    pub title: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WatcherRename {
    pub old_path: String,
    pub new_path: String,
    pub title: String,
}

#[derive(Serialize)]
pub struct VideoIdPath {
    pub id: i64,
    pub path: String,
}

// ── helpers ───────────────────────────────────────────────────────────────────

pub fn video_from_row(r: &rusqlite::Row<'_>) -> rusqlite::Result<Video> {
    Ok(Video {
        id: r.get(0)?,
        path: r.get(1)?,
        title: r.get(2)?,
        duration: r.get(3)?,
        thumbnail: r.get(4)?,
        watched_at: r.get(5)?,
        progress: r.get::<_, Option<f64>>(6)?.unwrap_or(0.0),
        rating: r.get::<_, Option<i64>>(7)?.unwrap_or(0),
        category_id: r.get(8)?,
        has_audio: r.get(9)?,
        watch_count: r.get::<_, Option<i64>>(10)?.unwrap_or(0),
        created_at: r.get(11)?,
        media_type: r.get(12)?,
        source_url: r.get(13)?,
    })
}

fn get_category_descendants(
    conn: &rusqlite::Connection,
    category_id: i64,
) -> rusqlite::Result<Vec<i64>> {
    let mut stmt = conn.prepare(
        "WITH RECURSIVE cat_tree AS (
           SELECT id FROM categories WHERE id = ?1
           UNION ALL
           SELECT c.id FROM categories c JOIN cat_tree ct ON c.parent_id = ct.id
         ) SELECT id FROM cat_tree",
    )?;
    let rows = stmt.query_map([category_id], |r| r.get::<_, i64>(0))?;
    rows.collect()
}

fn escape_like_dir(dir: &str) -> String {
    dir.replace('\\', "/")
        .trim_end_matches('/')
        .replace('!', "!!")
        .replace('%', "!%")
        .replace('_', "!_")
}

fn build_where_clause(
    conn: &rusqlite::Connection,
    filter: &VideoFilter,
) -> (String, Vec<rusqlite::types::Value>) {
    use rusqlite::types::Value;
    let mut conditions = Vec::<String>::new();
    let mut params = Vec::<Value>::new();

    if !filter.filter_search.trim().is_empty() {
        conditions.push("(v.title LIKE ? OR v.path LIKE ?)".to_string());
        let s = format!("%{}%", filter.filter_search.trim());
        params.push(Value::Text(s.clone()));
        params.push(Value::Text(s));
    }

    if let Some(cat_id) = filter.filter_category_id {
        if cat_id == -1 {
            conditions.push("v.category_id IS NULL".to_string());
        } else {
            let ids = get_category_descendants(conn, cat_id).unwrap_or_else(|_| vec![cat_id]);
            let ph = ids.iter().map(|_| "?").collect::<Vec<_>>().join(", ");
            conditions.push(format!("v.category_id IN ({ph})"));
            for id in ids {
                params.push(Value::Integer(id));
            }
        }
    }

    if !filter.filter_tag_ids.is_empty() {
        let ph = filter.filter_tag_ids.iter().map(|_| "?").collect::<Vec<_>>().join(", ");
        if filter.filter_tag_mode == "or" {
            conditions.push(format!(
                "v.id IN (SELECT vt.video_id FROM video_tags vt WHERE vt.tag_id IN ({ph}))"
            ));
            for &tid in &filter.filter_tag_ids {
                params.push(Value::Integer(tid));
            }
        } else {
            conditions.push(format!(
                "v.id IN (SELECT vt.video_id FROM video_tags vt WHERE vt.tag_id IN ({ph}) GROUP BY vt.video_id HAVING COUNT(*) = ?)"
            ));
            for &tid in &filter.filter_tag_ids {
                params.push(Value::Integer(tid));
            }
            params.push(Value::Integer(filter.filter_tag_ids.len() as i64));
        }
    }

    if filter.filter_min_rating == -1 {
        conditions.push("(v.rating = 0 OR v.rating IS NULL)".to_string());
    } else if filter.filter_min_rating > 0 {
        conditions.push("v.rating >= ?".to_string());
        params.push(Value::Integer(filter.filter_min_rating));
    }

    if let Some(has_audio) = filter.filter_has_audio {
        conditions.push("v.has_audio = ?".to_string());
        params.push(Value::Integer(has_audio));
    }

    if filter.filter_min_duration > 0.0 {
        conditions.push("v.duration >= ?".to_string());
        params.push(Value::Real(filter.filter_min_duration));
    }

    match filter.filter_watched_status.as_str() {
        "unwatched" => conditions.push("v.watched_at IS NULL".to_string()),
        "watched" => conditions.push("v.watched_at IS NOT NULL".to_string()),
        _ => {}
    }

    if let Some(ref dir) = filter.filter_watch_dir {
        conditions.push("REPLACE(v.path, '\\', '/') LIKE ? ESCAPE '!'".to_string());
        params.push(Value::Text(format!("{}/%" , escape_like_dir(dir))));
    }

    if filter.filter_media_type != "all" {
        conditions.push("v.media_type = ?".to_string());
        params.push(Value::Text(filter.filter_media_type.clone()));
    }

    let where_clause = if conditions.is_empty() {
        String::new()
    } else {
        format!("WHERE {}", conditions.join(" AND "))
    };

    (where_clause, params)
}

fn media_type_for_path(path: &str) -> &'static str {
    let ext = path.rsplit('.').next().unwrap_or("").to_lowercase();
    let ext = ext.as_str();
    if ["mp3", "flac", "aac", "wav", "ogg", "opus", "m4a", "wma"].contains(&ext) {
        "audio"
    } else if ["jpg", "jpeg", "png", "gif", "webp", "bmp", "tiff", "heic", "avif"].contains(&ext) {
        "image"
    } else {
        "video"
    }
}

fn get_relative_dir_path(file_path: &str, root_dir: &str) -> Option<String> {
    let norm_file = file_path.replace('\\', "/");
    let norm_root = root_dir.replace('\\', "/").trim_end_matches('/').to_string();
    let dir = norm_file.rsplit_once('/').map(|(d, _)| d).unwrap_or("");
    if dir == norm_root {
        Some(String::new()) // root dir directly
    } else if dir.starts_with(&format!("{norm_root}/")) {
        Some(dir[norm_root.len() + 1..].to_string())
    } else {
        None
    }
}

// ── fetch videos ──────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn db_fetch_videos(
    state: State<'_, DbState>,
    filter: VideoFilter,
) -> Result<FetchVideosResult, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let (where_clause, params) = build_where_clause(&conn, &filter);

    let total_count: i64 = {
        let sql = format!("SELECT COUNT(*) FROM videos v {where_clause}");
        let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
        stmt.query_row(rusqlite::params_from_iter(params.iter()), |r| r.get(0))
            .map_err(|e| e.to_string())?
    };

    let max_page = std::cmp::max(1, (total_count + filter.page_size - 1) / filter.page_size);
    let page = filter.current_page.min(max_page);
    let offset = (page - 1) * filter.page_size;

    let sort_col = match filter.filter_sort_by.as_str() {
        "duration" => "COALESCE(v.duration, -1)",
        "rating" => "v.rating",
        _ => "v.created_at",
    };
    let dir = if filter.filter_sort_order == "asc" { "ASC" } else { "DESC" };

    let sql = format!(
        "SELECT v.id, v.path, v.title, v.duration, v.thumbnail, v.watched_at,
                v.progress, v.rating, v.category_id, v.has_audio, v.watch_count,
                v.created_at, v.media_type, v.source_url
         FROM videos v {where_clause}
         ORDER BY {sort_col} {dir}
         LIMIT ? OFFSET ?"
    );

    let mut all_params: Vec<rusqlite::types::Value> = params;
    all_params.push(rusqlite::types::Value::Integer(filter.page_size));
    all_params.push(rusqlite::types::Value::Integer(offset));

    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(rusqlite::params_from_iter(all_params.iter()), video_from_row)
        .map_err(|e| e.to_string())?;
    let videos = rows.collect::<rusqlite::Result<Vec<_>>>().map_err(|e| e.to_string())?;

    Ok(FetchVideosResult { videos, total_count })
}

#[tauri::command]
pub async fn db_fetch_all_for_shuffle(
    state: State<'_, DbState>,
    filter: VideoFilter,
) -> Result<Vec<Video>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let (where_clause, params) = build_where_clause(&conn, &filter);

    let sort_col = match filter.filter_sort_by.as_str() {
        "duration" => "COALESCE(v.duration, -1)",
        "rating" => "v.rating",
        _ => "v.created_at",
    };
    let dir = if filter.filter_sort_order == "asc" { "ASC" } else { "DESC" };

    let sql = format!(
        "SELECT v.id, v.path, v.title, v.duration, v.thumbnail, v.watched_at,
                v.progress, v.rating, v.category_id, v.has_audio, v.watch_count,
                v.created_at, v.media_type, v.source_url
         FROM videos v {where_clause}
         ORDER BY {sort_col} {dir}"
    );

    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(rusqlite::params_from_iter(params.iter()), video_from_row)
        .map_err(|e| e.to_string())?;
    rows.collect::<rusqlite::Result<Vec<_>>>().map_err(|e| e.to_string())
}

// ── simple video mutations ────────────────────────────────────────────────────

#[tauri::command]
pub async fn db_increment_watch_count(
    state: State<'_, DbState>,
    video_id: i64,
) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE videos SET watch_count = COALESCE(watch_count, 0) + 1 WHERE id = ?1",
        [video_id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn db_update_progress(
    state: State<'_, DbState>,
    video_id: i64,
    progress: f64,
) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE videos SET progress = ?1, watched_at = CURRENT_TIMESTAMP WHERE id = ?2",
        rusqlite::params![progress, video_id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn db_update_video(
    state: State<'_, DbState>,
    video_id: i64,
    title: Option<String>,
    rating: Option<i64>,
    path: Option<String>,
    media_type: Option<String>,
    source_url: Option<String>,
) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    // Build SET clause dynamically
    let mut set_parts = Vec::new();
    let mut params: Vec<rusqlite::types::Value> = Vec::new();

    if let Some(v) = title {
        set_parts.push("title = ?");
        params.push(rusqlite::types::Value::Text(v));
    }
    if let Some(v) = rating {
        set_parts.push("rating = ?");
        params.push(rusqlite::types::Value::Integer(v));
    }
    if let Some(v) = path {
        set_parts.push("path = ?");
        params.push(rusqlite::types::Value::Text(v));
    }
    if let Some(v) = media_type {
        set_parts.push("media_type = ?");
        params.push(rusqlite::types::Value::Text(v));
    }
    if let Some(v) = source_url {
        set_parts.push("source_url = ?");
        params.push(rusqlite::types::Value::Text(v));
    }

    if set_parts.is_empty() {
        return Ok(());
    }

    params.push(rusqlite::types::Value::Integer(video_id));
    let sql = format!("UPDATE videos SET {} WHERE id = ?", set_parts.join(", "));
    conn.execute(&sql, rusqlite::params_from_iter(params.iter()))
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn db_update_video_thumbnail(
    state: State<'_, DbState>,
    video_id: i64,
    thumbnail: Option<String>,
) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE videos SET thumbnail = ?1 WHERE id = ?2",
        rusqlite::params![thumbnail, video_id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn db_delete_video(state: State<'_, DbState>, video_id: i64) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM videos WHERE id = ?1", [video_id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn db_remove_video(state: State<'_, DbState>, video_id: i64) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    conn.execute_batch("BEGIN").map_err(|e| e.to_string())?;
    let result: Result<(), String> = (|| {
        conn.execute("DELETE FROM playlist_items WHERE video_id = ?1", [video_id])
            .map_err(|e| e.to_string())?;
        conn.execute("DELETE FROM video_tags WHERE video_id = ?1", [video_id])
            .map_err(|e| e.to_string())?;
        conn.execute("DELETE FROM videos WHERE id = ?1", [video_id])
            .map_err(|e| e.to_string())?;
        Ok(())
    })();
    if result.is_ok() {
        conn.execute_batch("COMMIT").map_err(|e| e.to_string())?;
    } else {
        let _ = conn.execute_batch("ROLLBACK");
    }
    result
}

#[tauri::command]
pub async fn db_remove_multiple(
    state: State<'_, DbState>,
    video_ids: Vec<i64>,
) -> Result<(), String> {
    if video_ids.is_empty() {
        return Ok(());
    }
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    // Batch DELETE in chunks of 400
    let batch_size = 400;
    conn.execute_batch("BEGIN").map_err(|e| e.to_string())?;
    let result: Result<(), String> = (|| {
        for chunk in video_ids.chunks(batch_size) {
            let ph = chunk.iter().map(|_| "?").collect::<Vec<_>>().join(", ");
            let params: Vec<rusqlite::types::Value> =
                chunk.iter().map(|&id| rusqlite::types::Value::Integer(id)).collect();
            conn.execute(
                &format!("DELETE FROM playlist_items WHERE video_id IN ({ph})"),
                rusqlite::params_from_iter(params.iter()),
            )
            .map_err(|e| e.to_string())?;
            conn.execute(
                &format!("DELETE FROM video_tags WHERE video_id IN ({ph})"),
                rusqlite::params_from_iter(params.iter()),
            )
            .map_err(|e| e.to_string())?;
            conn.execute(
                &format!("DELETE FROM videos WHERE id IN ({ph})"),
                rusqlite::params_from_iter(params.iter()),
            )
            .map_err(|e| e.to_string())?;
        }
        Ok(())
    })();
    if result.is_ok() {
        conn.execute_batch("COMMIT").map_err(|e| e.to_string())?;
    } else {
        let _ = conn.execute_batch("ROLLBACK");
    }
    result
}

#[tauri::command]
pub async fn db_add_video_from_path(
    state: State<'_, DbState>,
    path: String,
    title: String,
    source_url: Option<String>,
) -> Result<Option<i64>, String> {
    let media_type = media_type_for_path(&path);
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT OR IGNORE INTO videos (path, title, media_type, source_url) VALUES (?1, ?2, ?3, ?4)",
        rusqlite::params![path, title, media_type, source_url],
    )
    .map_err(|e| e.to_string())?;
    let id: Option<i64> = conn
        .query_row("SELECT id FROM videos WHERE path = ?1", [&path], |r| r.get(0))
        .optional()
        .map_err(|e| e.to_string())?;
    Ok(id)
}

#[tauri::command]
pub async fn db_remove_video_by_path(
    state: State<'_, DbState>,
    path: String,
) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let id: Option<i64> = conn
        .query_row("SELECT id FROM videos WHERE path = ?1", [&path], |r| r.get(0))
        .optional()
        .map_err(|e| e.to_string())?;
    if let Some(video_id) = id {
        conn.execute_batch("BEGIN").map_err(|e| e.to_string())?;
        let result: Result<(), String> = (|| {
            conn.execute("DELETE FROM playlist_items WHERE video_id = ?1", [video_id])
                .map_err(|e| e.to_string())?;
            conn.execute("DELETE FROM video_tags WHERE video_id = ?1", [video_id])
                .map_err(|e| e.to_string())?;
            conn.execute("DELETE FROM videos WHERE id = ?1", [video_id])
                .map_err(|e| e.to_string())?;
            Ok(())
        })();
        if result.is_ok() {
            conn.execute_batch("COMMIT").map_err(|e| e.to_string())?;
        } else {
            let _ = conn.execute_batch("ROLLBACK");
        }
        return result;
    }
    Ok(())
}

#[tauri::command]
pub async fn db_update_video_path(
    state: State<'_, DbState>,
    old_path: String,
    new_path: String,
) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let video_id: Option<i64> = conn
        .query_row("SELECT id FROM videos WHERE path = ?1", [&old_path], |r| r.get(0))
        .optional()
        .map_err(|e| e.to_string())?;
    let Some(video_id) = video_id else {
        return Ok(());
    };
    // Remove conflicting entries
    remove_conflicting_videos(&conn, &new_path, video_id)?;
    conn.execute("UPDATE videos SET path = ?1 WHERE id = ?2", rusqlite::params![new_path, video_id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn db_rename_video_file(
    state: State<'_, DbState>,
    video_id: i64,
    new_path: String,
) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    remove_conflicting_videos(&conn, &new_path, video_id)?;
    conn.execute("UPDATE videos SET path = ?1 WHERE id = ?2", rusqlite::params![new_path, video_id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn db_move_video_file_db(
    state: State<'_, DbState>,
    video_id: i64,
    new_path: String,
) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    conn.execute("UPDATE videos SET path = ?1 WHERE id = ?2", rusqlite::params![new_path, video_id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

fn remove_conflicting_videos(
    conn: &rusqlite::Connection,
    path: &str,
    exclude_id: i64,
) -> Result<(), String> {
    let mut stmt = conn
        .prepare("SELECT id FROM videos WHERE path = ?1 AND id != ?2")
        .map_err(|e| e.to_string())?;
    let ids: Vec<i64> = stmt
        .query_map(rusqlite::params![path, exclude_id], |r| r.get(0))
        .map_err(|e| e.to_string())?
        .collect::<rusqlite::Result<_>>()
        .map_err(|e| e.to_string())?;
    if !ids.is_empty() {
        let ph = ids.iter().map(|_| "?").collect::<Vec<_>>().join(", ");
        let params: Vec<rusqlite::types::Value> =
            ids.iter().map(|&id| rusqlite::types::Value::Integer(id)).collect();
        conn.execute(
            &format!("DELETE FROM playlist_items WHERE video_id IN ({ph})"),
            rusqlite::params_from_iter(params.iter()),
        )
        .map_err(|e| e.to_string())?;
        conn.execute(
            &format!("DELETE FROM video_tags WHERE video_id IN ({ph})"),
            rusqlite::params_from_iter(params.iter()),
        )
        .map_err(|e| e.to_string())?;
        conn.execute(
            &format!("DELETE FROM videos WHERE id IN ({ph})"),
            rusqlite::params_from_iter(params.iter()),
        )
        .map_err(|e| e.to_string())?;
    }
    Ok(())
}

// ── watch dirs ────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn db_add_watch_dir(
    state: State<'_, DbState>,
    path: String,
    use_dir_as_category: bool,
) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT OR REPLACE INTO watch_dirs (path, use_dir_as_category) VALUES (?1, ?2)",
        rusqlite::params![path, use_dir_as_category as i64],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn db_remove_watch_dir(
    state: State<'_, DbState>,
    path: String,
) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let escaped = escape_like_dir(&path);
    // Find all videos under this dir
    let mut stmt_v = conn
        .prepare("SELECT id FROM videos WHERE path LIKE ? ESCAPE '!'")
        .map_err(|e| e.to_string())?;
    let videos: Vec<i64> = stmt_v
        .query_map([format!("{escaped}/%")], |r| r.get(0))
        .map_err(|e| e.to_string())?
        .collect::<rusqlite::Result<_>>()
        .map_err(|e| e.to_string())?;
    // Batch delete
    let batch_size = 400;
    if !videos.is_empty() {
        conn.execute_batch("BEGIN").map_err(|e| e.to_string())?;
        let result: Result<(), String> = (|| {
            for chunk in videos.chunks(batch_size) {
                let ph = chunk.iter().map(|_| "?").collect::<Vec<_>>().join(", ");
                let params: Vec<rusqlite::types::Value> =
                    chunk.iter().map(|&id| rusqlite::types::Value::Integer(id)).collect();
                conn.execute(
                    &format!("DELETE FROM playlist_items WHERE video_id IN ({ph})"),
                    rusqlite::params_from_iter(params.iter()),
                )
                .map_err(|e| e.to_string())?;
                conn.execute(
                    &format!("DELETE FROM video_tags WHERE video_id IN ({ph})"),
                    rusqlite::params_from_iter(params.iter()),
                )
                .map_err(|e| e.to_string())?;
                conn.execute(
                    &format!("DELETE FROM videos WHERE id IN ({ph})"),
                    rusqlite::params_from_iter(params.iter()),
                )
                .map_err(|e| e.to_string())?;
            }
            Ok(())
        })();
        if result.is_ok() {
            conn.execute_batch("COMMIT").map_err(|e| e.to_string())?;
        } else {
            let _ = conn.execute_batch("ROLLBACK");
            return result;
        }
    }
    conn.execute("DELETE FROM watch_dirs WHERE path = ?1", [&path])
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn db_get_watch_dirs(state: State<'_, DbState>) -> Result<Vec<WatchDir>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare("SELECT path, use_dir_as_category FROM watch_dirs")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |r| {
            Ok(WatchDir {
                path: r.get(0)?,
                use_dir_as_category: r.get(1)?,
            })
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<rusqlite::Result<_>>().map_err(|e| e.to_string())
}

// ── thumbnail / audio batch ───────────────────────────────────────────────────

#[tauri::command]
pub async fn db_get_pending_thumbnails(
    state: State<'_, DbState>,
    limit: i64,
) -> Result<Vec<PendingThumbnail>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare(
            "SELECT id, path, thumbnail FROM videos
             WHERE thumbnail IS NULL OR has_audio IS NULL
             LIMIT ?1",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([limit], |r| {
            Ok(PendingThumbnail {
                id: r.get(0)?,
                path: r.get(1)?,
                thumbnail: r.get(2)?,
            })
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<rusqlite::Result<_>>().map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn db_update_thumbnails_batch(
    state: State<'_, DbState>,
    updates: Vec<ThumbnailUpdate>,
) -> Result<(), String> {
    if updates.is_empty() {
        return Ok(());
    }
    let conn = state.0.lock().map_err(|e| e.to_string())?;

    let when_clause = updates.iter().map(|_| "WHEN ? THEN ?").collect::<Vec<_>>().join(" ");
    let id_ph = updates.iter().map(|_| "?").collect::<Vec<_>>().join(", ");
    let sql = format!(
        "UPDATE videos SET
           thumbnail = CASE id {when_clause} ELSE thumbnail END,
           duration  = CASE id {when_clause} ELSE duration END,
           has_audio = CASE id {when_clause} ELSE has_audio END
         WHERE id IN ({id_ph})"
    );

    let mut params: Vec<rusqlite::types::Value> = Vec::new();
    for u in &updates {
        params.push(rusqlite::types::Value::Integer(u.id));
        match &u.thumbnail {
            Some(t) => params.push(rusqlite::types::Value::Text(t.clone())),
            None => params.push(rusqlite::types::Value::Null),
        }
    }
    for u in &updates {
        params.push(rusqlite::types::Value::Integer(u.id));
        match u.duration {
            Some(d) => params.push(rusqlite::types::Value::Real(d)),
            None => params.push(rusqlite::types::Value::Null),
        }
    }
    for u in &updates {
        params.push(rusqlite::types::Value::Integer(u.id));
        params.push(rusqlite::types::Value::Integer(u.has_audio));
    }
    for u in &updates {
        params.push(rusqlite::types::Value::Integer(u.id));
    }

    conn.execute(&sql, rusqlite::params_from_iter(params.iter()))
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn db_update_audio_only_batch(
    state: State<'_, DbState>,
    updates: Vec<AudioUpdate>,
) -> Result<(), String> {
    if updates.is_empty() {
        return Ok(());
    }
    let conn = state.0.lock().map_err(|e| e.to_string())?;

    let when_clause = updates.iter().map(|_| "WHEN ? THEN ?").collect::<Vec<_>>().join(" ");
    let id_ph = updates.iter().map(|_| "?").collect::<Vec<_>>().join(", ");
    let sql = format!(
        "UPDATE videos SET has_audio = CASE id {when_clause} ELSE has_audio END WHERE id IN ({id_ph})"
    );

    let mut params: Vec<rusqlite::types::Value> = Vec::new();
    for u in &updates {
        params.push(rusqlite::types::Value::Integer(u.id));
        params.push(rusqlite::types::Value::Integer(u.has_audio));
    }
    for u in &updates {
        params.push(rusqlite::types::Value::Integer(u.id));
    }

    conn.execute(&sql, rusqlite::params_from_iter(params.iter()))
        .map_err(|e| e.to_string())?;
    Ok(())
}

// ── scan & import ─────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn db_scan_and_import(
    state: State<'_, DbState>,
    path: String,
    use_dir_as_category: bool,
) -> Result<ScanImportResult, String> {
    // Step 1: Scan files (blocking I/O, don't hold DB lock)
    let path_clone = path.clone();
    let scan = tokio::task::spawn_blocking(move || scan_dir_core(&path_clone))
        .await
        .map_err(|e| e.to_string())?;

    let errors = scan.errors.clone();
    let truncated = scan.truncated;
    let skipped_count = scan.skipped_count;
    let scanned_count = scan.files.len() as i64;

    // Step 2: DB operations (acquire lock)
    let conn = state.0.lock().map_err(|e| e.to_string())?;

    // Upsert watch_dir
    conn.execute(
        "INSERT OR REPLACE INTO watch_dirs (path, use_dir_as_category) VALUES (?1, ?2)",
        rusqlite::params![path, use_dir_as_category as i64],
    )
    .map_err(|e| e.to_string())?;

    if scan.files.is_empty() {
        return Ok(ScanImportResult {
            new_count: 0,
            scanned_count,
            errors,
            truncated,
            skipped_count,
        });
    }

    // Build category map if use_dir_as_category
    let mut category_id_map: std::collections::HashMap<String, i64> = std::collections::HashMap::new();
    if use_dir_as_category {
        let mut rel_paths: Vec<String> = scan
            .files
            .iter()
            .filter_map(|f| get_relative_dir_path(&f.path, &path))
            .filter(|p| !p.is_empty())
            .collect::<std::collections::HashSet<_>>()
            .into_iter()
            .collect();
        rel_paths.sort_by_key(|p| p.chars().filter(|&c| c == '/').count());

        if !rel_paths.is_empty() {
            let mut cat_cache = std::collections::HashMap::new();
            for rel_path in &rel_paths {
                if let Ok(Some(leaf_id)) =
                    build_category_hierarchy(&conn, rel_path, &mut cat_cache, "#6366f1")
                {
                    category_id_map.insert(rel_path.clone(), leaf_id);
                }
            }
        }
    }

    // Batch INSERT
    const INSERT_BATCH_4: usize = 249;
    let mut new_count: i64 = 0;
    conn.execute_batch("BEGIN").map_err(|e| e.to_string())?;
    let result: Result<(), String> = (|| {
        for chunk in scan.files.chunks(INSERT_BATCH_4) {
            let ph = chunk.iter().map(|_| "(?, ?, ?, ?)").collect::<Vec<_>>().join(", ");
            let sql =
                format!("INSERT OR IGNORE INTO videos (path, title, category_id, media_type) VALUES {ph}");
            let mut params: Vec<rusqlite::types::Value> = Vec::with_capacity(chunk.len() * 4);
            for file in chunk {
                let rel_path = if use_dir_as_category {
                    get_relative_dir_path(&file.path, &path)
                } else {
                    None
                };
                let cat_id = rel_path.as_deref().and_then(|r| category_id_map.get(r)).copied();
                params.push(rusqlite::types::Value::Text(file.path.clone()));
                params.push(rusqlite::types::Value::Text(file.title.clone()));
                match cat_id {
                    Some(id) => params.push(rusqlite::types::Value::Integer(id)),
                    None => params.push(rusqlite::types::Value::Null),
                }
                params.push(rusqlite::types::Value::Text(file.media_type.clone()));
            }
            let affected = conn
                .execute(&sql, rusqlite::params_from_iter(params.iter()))
                .map_err(|e| e.to_string())?;
            new_count += affected as i64;
        }
        Ok(())
    })();
    if result.is_ok() {
        conn.execute_batch("COMMIT").map_err(|e| e.to_string())?;
    } else {
        let _ = conn.execute_batch("ROLLBACK");
        return Err(result.unwrap_err());
    }

    Ok(ScanImportResult { new_count, scanned_count, errors, truncated, skipped_count })
}

#[tauri::command]
pub async fn db_rescan_all_dirs(
    state: State<'_, DbState>,
    target_dir: Option<String>,
    download_dir: Option<String>,
) -> Result<RescanResult, String> {
    // Step 1: Get dirs to scan from DB
    let dirs_to_scan: Vec<(String, bool)> = {
        let conn = state.0.lock().map_err(|e| e.to_string())?;
        if let Some(ref dir) = target_dir {
            let use_cat: i64 = conn
                .query_row(
                    "SELECT use_dir_as_category FROM watch_dirs WHERE path = ?1",
                    [dir],
                    |r| r.get(0),
                )
                .unwrap_or(0);
            vec![(dir.clone(), use_cat == 1)]
        } else {
            let mut stmt = conn
                .prepare("SELECT path, use_dir_as_category FROM watch_dirs")
                .map_err(|e| e.to_string())?;
            let x = stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)? == 1)))
                .map_err(|e| e.to_string())?
                .collect::<rusqlite::Result<_>>()
                .map_err(|e| e.to_string())?;
            x
        }
    };

    if dirs_to_scan.is_empty() {
        return Ok(RescanResult {
            new_count: 0,
            scanned_count: 0,
            errors: vec![],
            truncated: false,
            skipped_count: 0,
        });
    }

    // Step 2: Scan all directories (release DB lock while scanning)
    let mut all_errors = Vec::new();
    let mut total_truncated = false;
    let mut total_skipped = 0u32;
    let mut dir_scan_results: Vec<(String, bool, crate::commands::library::ScanResult)> = Vec::new();

    for (dir, use_cat) in &dirs_to_scan {
        let dir_clone = dir.clone();
        let scan = tokio::task::spawn_blocking(move || scan_dir_core(&dir_clone))
            .await
            .map_err(|e| e.to_string())?;
        all_errors.extend(scan.errors.iter().cloned());
        if scan.truncated {
            total_truncated = true;
        }
        total_skipped += scan.skipped_count;
        dir_scan_results.push((dir.clone(), *use_cat, scan));
    }

    // Step 3: DB operations
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let mut total_new_count: i64 = 0;
    let mut total_scanned_count: i64 = 0;

    for (dir, use_cat, scan) in &dir_scan_results {
        total_scanned_count += scan.files.len() as i64;
        if scan.files.is_empty() {
            continue;
        }

        let prev_max_id: i64 = conn
            .query_row("SELECT COALESCE(MAX(id), 0) FROM videos", [], |r| r.get(0))
            .unwrap_or(0);

        const INSERT_BATCH_3: usize = 333;
        let mut dir_new_count: i64 = 0;
        conn.execute_batch("BEGIN").map_err(|e| e.to_string())?;
        let insert_result: Result<(), String> = (|| {
            for chunk in scan.files.chunks(INSERT_BATCH_3) {
                let ph = chunk.iter().map(|_| "(?, ?, ?)").collect::<Vec<_>>().join(", ");
                let sql = format!(
                    "INSERT OR IGNORE INTO videos (path, title, media_type) VALUES {ph}"
                );
                let mut params: Vec<rusqlite::types::Value> = Vec::with_capacity(chunk.len() * 3);
                for file in chunk {
                    params.push(rusqlite::types::Value::Text(file.path.clone()));
                    params.push(rusqlite::types::Value::Text(file.title.clone()));
                    params.push(rusqlite::types::Value::Text(file.media_type.clone()));
                }
                let affected = conn
                    .execute(&sql, rusqlite::params_from_iter(params.iter()))
                    .map_err(|e| e.to_string())?;
                dir_new_count += affected as i64;
            }
            Ok(())
        })();
        if insert_result.is_ok() {
            conn.execute_batch("COMMIT").map_err(|e| e.to_string())?;
        } else {
            let _ = conn.execute_batch("ROLLBACK");
            return Err(insert_result.unwrap_err());
        }
        total_new_count += dir_new_count;

        // Assign categories for new files if use_dir_as_category
        if *use_cat && dir_new_count > 0 {
            let new_ids: Vec<i64> = {
                let mut stmt = conn
                    .prepare("SELECT id FROM videos WHERE id > ?1")
                    .map_err(|e| e.to_string())?;
                let x = stmt.query_map([prev_max_id], |r| r.get(0))
                    .map_err(|e| e.to_string())?
                    .collect::<rusqlite::Result<_>>()
                    .map_err(|e| e.to_string())?;
                x
            };
            if !new_ids.is_empty() {
                let _ = assign_categories_for_ids(&conn, &new_ids, &[dir.clone()]);
            }
        }
    }

    // Step 4: Delete missing files in scanned dirs
    {
        let dir_conditions: Vec<String> = dirs_to_scan
            .iter()
            .map(|_| "REPLACE(path, '\\\\', '/') LIKE ? ESCAPE '!'".to_string())
            .collect();
        let dir_cond_sql = dir_conditions.join(" OR ");
        let dir_params: Vec<rusqlite::types::Value> = dirs_to_scan
            .iter()
            .map(|(d, _)| rusqlite::types::Value::Text(format!("{}/%" , escape_like_dir(d))))
            .collect();

        let db_videos: Vec<(i64, String)> = {
            let sql = format!("SELECT id, path FROM videos WHERE {dir_cond_sql}");
            let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
            let x = stmt.query_map(rusqlite::params_from_iter(dir_params.iter()), |r| {
                Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?))
            })
            .map_err(|e| e.to_string())?
            .collect::<rusqlite::Result<_>>()
            .map_err(|e| e.to_string())?;
            x
        };

        if !db_videos.is_empty() {
            let missing_ids: Vec<i64> = db_videos
                .iter()
                .filter(|(_, path)| !std::path::Path::new(path).exists())
                .map(|(id, _)| *id)
                .collect();
            if !missing_ids.is_empty() {
                delete_video_ids_tx(&conn, &missing_ids)?;
            }
        }
    }

    // Step 5 (full rescan only): Delete videos not in any registered dir
    if target_dir.is_none() && !dirs_to_scan.is_empty() {
        let mut trusted_dirs: Vec<String> = dirs_to_scan.iter().map(|(d, _)| d.clone()).collect();
        if let Some(ref dl) = download_dir {
            if !dl.is_empty() {
                trusted_dirs.push(dl.clone());
            }
        }
        let registered_conditions: Vec<String> = trusted_dirs
            .iter()
            .map(|_| "REPLACE(path, '\\\\', '/') LIKE ? ESCAPE '!'".to_string())
            .collect();
        let reg_params: Vec<rusqlite::types::Value> = trusted_dirs
            .iter()
            .map(|d| rusqlite::types::Value::Text(format!("{}/%" , escape_like_dir(d))))
            .collect();
        let reg_sql = registered_conditions.join(" OR ");
        let unregistered_ids: Vec<i64> = {
            let sql = format!("SELECT id FROM videos WHERE NOT ({reg_sql})");
            let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
            let x = stmt.query_map(rusqlite::params_from_iter(reg_params.iter()), |r| r.get(0))
                .map_err(|e| e.to_string())?
                .collect::<rusqlite::Result<_>>()
                .map_err(|e| e.to_string())?;
            x
        };
        if !unregistered_ids.is_empty() {
            delete_video_ids_tx(&conn, &unregistered_ids)?;
        }
    }

    Ok(RescanResult {
        new_count: total_new_count,
        scanned_count: total_scanned_count,
        errors: all_errors,
        truncated: total_truncated,
        skipped_count: total_skipped,
    })
}

fn delete_video_ids_tx(conn: &rusqlite::Connection, ids: &[i64]) -> Result<(), String> {
    const BATCH: usize = 400;
    conn.execute_batch("BEGIN").map_err(|e| e.to_string())?;
    let result: Result<(), String> = (|| {
        for chunk in ids.chunks(BATCH) {
            let ph = chunk.iter().map(|_| "?").collect::<Vec<_>>().join(", ");
            let params: Vec<rusqlite::types::Value> =
                chunk.iter().map(|&id| rusqlite::types::Value::Integer(id)).collect();
            conn.execute(
                &format!("DELETE FROM playlist_items WHERE video_id IN ({ph})"),
                rusqlite::params_from_iter(params.iter()),
            )
            .map_err(|e| e.to_string())?;
            conn.execute(
                &format!("DELETE FROM video_tags WHERE video_id IN ({ph})"),
                rusqlite::params_from_iter(params.iter()),
            )
            .map_err(|e| e.to_string())?;
            conn.execute(
                &format!("DELETE FROM videos WHERE id IN ({ph})"),
                rusqlite::params_from_iter(params.iter()),
            )
            .map_err(|e| e.to_string())?;
        }
        Ok(())
    })();
    if result.is_ok() {
        conn.execute_batch("COMMIT").map_err(|e| e.to_string())?;
    } else {
        let _ = conn.execute_batch("ROLLBACK");
    }
    result
}

fn assign_categories_for_ids(
    conn: &rusqlite::Connection,
    video_ids: &[i64],
    watch_dirs: &[String],
) -> Result<i64, String> {
    if video_ids.is_empty() {
        return Ok(0);
    }
    // Fetch video paths
    const SELECT_BATCH: usize = 499;
    let mut rows: Vec<(i64, String)> = Vec::new();
    for chunk in video_ids.chunks(SELECT_BATCH) {
        let ph = chunk.iter().map(|_| "?").collect::<Vec<_>>().join(", ");
        let sql = format!("SELECT id, path FROM videos WHERE id IN ({ph})");
        let params: Vec<rusqlite::types::Value> =
            chunk.iter().map(|&id| rusqlite::types::Value::Integer(id)).collect();
        let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
        let batch: Vec<(i64, String)> = stmt
            .query_map(rusqlite::params_from_iter(params.iter()), |r| {
                Ok((r.get(0)?, r.get(1)?))
            })
            .map_err(|e| e.to_string())?
            .collect::<rusqlite::Result<_>>()
            .map_err(|e| e.to_string())?;
        rows.extend(batch);
    }

    let root_dirs: Vec<String> = watch_dirs
        .iter()
        .map(|d| d.replace('\\', "/").trim_end_matches('/').to_string())
        .collect();

    let get_rel_path = |file_path: &str| -> Option<String> {
        for root in &root_dirs {
            if let Some(rel) = get_relative_dir_path(file_path, root) {
                return Some(rel);
            }
        }
        // fallback: immediate parent dir name
        let binding = file_path.replace('\\', "/");
        let parts: Vec<&str> = binding.split('/').collect();
        let name_idx = parts.len().saturating_sub(2);
        parts.get(name_idx).map(|s| s.to_string())
    };

    let unique_rel_paths: Vec<String> = {
        let mut set = std::collections::HashSet::new();
        for (_, path) in &rows {
            if let Some(rel) = get_rel_path(path) {
                if !rel.is_empty() {
                    set.insert(rel);
                }
            }
        }
        let mut v: Vec<String> = set.into_iter().collect();
        v.sort_by_key(|p| p.chars().filter(|&c| c == '/').count());
        v
    };

    let mut cat_cache = std::collections::HashMap::new();
    let mut category_id_map: std::collections::HashMap<String, i64> =
        std::collections::HashMap::new();
    for rel_path in &unique_rel_paths {
        if let Ok(Some(leaf_id)) =
            build_category_hierarchy(conn, rel_path, &mut cat_cache, "#6366f1")
        {
            category_id_map.insert(rel_path.clone(), leaf_id);
        }
    }

    // Group by category_id and batch UPDATE
    let mut category_groups: std::collections::HashMap<i64, Vec<i64>> =
        std::collections::HashMap::new();
    for (id, path) in &rows {
        let rel = get_rel_path(path);
        if let Some(cat_id) = rel.as_deref().and_then(|r| category_id_map.get(r)).copied() {
            category_groups.entry(cat_id).or_default().push(*id);
        }
    }

    const UPDATE_BATCH: usize = 498;
    let mut assigned = 0i64;
    conn.execute_batch("BEGIN").map_err(|e| e.to_string())?;
    let result: Result<(), String> = (|| {
        for (cat_id, ids) in &category_groups {
            for chunk in ids.chunks(UPDATE_BATCH) {
                let ph = chunk.iter().map(|_| "?").collect::<Vec<_>>().join(", ");
                let sql =
                    format!("UPDATE videos SET category_id = ? WHERE id IN ({ph})");
                let mut params: Vec<rusqlite::types::Value> =
                    vec![rusqlite::types::Value::Integer(*cat_id)];
                params.extend(chunk.iter().map(|&id| rusqlite::types::Value::Integer(id)));
                conn.execute(&sql, rusqlite::params_from_iter(params.iter()))
                    .map_err(|e| e.to_string())?;
                assigned += chunk.len() as i64;
            }
        }
        Ok(())
    })();
    if result.is_ok() {
        conn.execute_batch("COMMIT").map_err(|e| e.to_string())?;
    } else {
        let _ = conn.execute_batch("ROLLBACK");
        return Err(result.unwrap_err());
    }
    Ok(assigned)
}

#[tauri::command]
pub async fn db_assign_category_from_path(
    state: State<'_, DbState>,
    video_ids: Vec<i64>,
) -> Result<i64, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let watch_dirs: Vec<String> = {
        let mut stmt = conn
            .prepare("SELECT path FROM watch_dirs")
            .map_err(|e| e.to_string())?;
        let x = stmt.query_map([], |r| r.get(0))
            .map_err(|e| e.to_string())?
            .collect::<rusqlite::Result<_>>()
            .map_err(|e| e.to_string())?;
        x
    };
    assign_categories_for_ids(&conn, &video_ids, &watch_dirs)
}

// ── batch watcher update ──────────────────────────────────────────────────────

#[tauri::command]
pub async fn db_batch_watcher_update(
    state: State<'_, DbState>,
    creates: Vec<WatcherCreate>,
    removes: Vec<String>,
    renames: Vec<WatcherRename>,
) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;

    // Removals
    if !removes.is_empty() {
        let batch_size = 499;
        let mut remove_ids: Vec<i64> = Vec::new();
        for chunk in removes.chunks(batch_size) {
            let ph = chunk.iter().map(|_| "?").collect::<Vec<_>>().join(", ");
            let params: Vec<rusqlite::types::Value> = chunk
                .iter()
                .map(|p| rusqlite::types::Value::Text(p.clone()))
                .collect();
            let mut stmt = conn
                .prepare(&format!("SELECT id FROM videos WHERE path IN ({ph})"))
                .map_err(|e| e.to_string())?;
            let ids: Vec<i64> = stmt
                .query_map(rusqlite::params_from_iter(params.iter()), |r| r.get(0))
                .map_err(|e| e.to_string())?
                .collect::<rusqlite::Result<_>>()
                .map_err(|e| e.to_string())?;
            remove_ids.extend(ids);
        }
        if !remove_ids.is_empty() {
            delete_video_ids_tx(&conn, &remove_ids)?;
        }
    }

    // Renames
    let mut extra_creates: Vec<WatcherCreate> = Vec::new();
    for r in &renames {
        let video_id: Option<i64> = conn
            .query_row("SELECT id FROM videos WHERE path = ?1", [&r.old_path], |row| row.get(0))
            .optional()
            .map_err(|e| e.to_string())?;
        let Some(video_id) = video_id else {
            extra_creates.push(WatcherCreate {
                path: r.new_path.clone(),
                title: r.title.clone(),
            });
            continue;
        };
        remove_conflicting_videos(&conn, &r.new_path, video_id)?;
        conn.execute(
            "UPDATE videos SET path = ?1, title = ?2 WHERE id = ?3",
            rusqlite::params![r.new_path, r.title, video_id],
        )
        .map_err(|e| e.to_string())?;
    }

    // Creates (including extra_creates from renames)
    let all_creates: Vec<&WatcherCreate> = creates.iter().chain(extra_creates.iter()).collect();
    if !all_creates.is_empty() {
        let prev_max_id: i64 = conn
            .query_row("SELECT COALESCE(MAX(id), 0) FROM videos", [], |r| r.get(0))
            .unwrap_or(0);

        const INSERT_BATCH: usize = 332;
        for chunk in all_creates.chunks(INSERT_BATCH) {
            let ph = chunk.iter().map(|_| "(?, ?, ?)").collect::<Vec<_>>().join(", ");
            let sql =
                format!("INSERT OR IGNORE INTO videos (path, title, media_type) VALUES {ph}");
            let mut params: Vec<rusqlite::types::Value> = Vec::with_capacity(chunk.len() * 3);
            for f in chunk {
                let media_type = media_type_for_path(&f.path);
                params.push(rusqlite::types::Value::Text(f.path.clone()));
                params.push(rusqlite::types::Value::Text(f.title.clone()));
                params.push(rusqlite::types::Value::Text(media_type.to_string()));
            }
            conn.execute(&sql, rusqlite::params_from_iter(params.iter()))
                .map_err(|e| e.to_string())?;
        }

        // Check if any watch dir has use_dir_as_category=1
        let has_cat_dir: bool = conn
            .query_row(
                "SELECT use_dir_as_category FROM watch_dirs WHERE use_dir_as_category = 1 LIMIT 1",
                [],
                |r| r.get::<_, i64>(0),
            )
            .optional()
            .map_err(|e| e.to_string())?
            .is_some();

        if has_cat_dir {
            let new_ids: Vec<i64> = {
                let mut stmt = conn
                    .prepare("SELECT id FROM videos WHERE id > ?1")
                    .map_err(|e| e.to_string())?;
                let x = stmt.query_map([prev_max_id], |r| r.get(0))
                    .map_err(|e| e.to_string())?
                    .collect::<rusqlite::Result<_>>()
                    .map_err(|e| e.to_string())?;
                x
            };
            if !new_ids.is_empty() {
                let watch_dirs: Vec<String> = {
                    let mut stmt = conn
                        .prepare("SELECT path FROM watch_dirs")
                        .map_err(|e| e.to_string())?;
                    let x = stmt.query_map([], |r| r.get(0))
                        .map_err(|e| e.to_string())?
                        .collect::<rusqlite::Result<_>>()
                        .map_err(|e| e.to_string())?;
                    x
                };
                let _ = assign_categories_for_ids(&conn, &new_ids, &watch_dirs);
            }
        }
    }

    Ok(())
}

#[tauri::command]
pub async fn db_get_videos_for_paths(
    state: State<'_, DbState>,
    paths: Vec<String>,
) -> Result<Vec<VideoIdPath>, String> {
    if paths.is_empty() {
        return Ok(vec![]);
    }
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    const BATCH: usize = 499;
    let mut results = Vec::new();
    for chunk in paths.chunks(BATCH) {
        let ph = chunk.iter().map(|_| "?").collect::<Vec<_>>().join(", ");
        let sql = format!("SELECT id, path FROM videos WHERE path IN ({ph})");
        let params: Vec<rusqlite::types::Value> = chunk
            .iter()
            .map(|p| rusqlite::types::Value::Text(p.clone()))
            .collect();
        let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
        let rows: Vec<VideoIdPath> = stmt
            .query_map(rusqlite::params_from_iter(params.iter()), |r| {
                Ok(VideoIdPath { id: r.get(0)?, path: r.get(1)? })
            })
            .map_err(|e| e.to_string())?
            .collect::<rusqlite::Result<_>>()
            .map_err(|e| e.to_string())?;
        results.extend(rows);
    }
    Ok(results)
}
