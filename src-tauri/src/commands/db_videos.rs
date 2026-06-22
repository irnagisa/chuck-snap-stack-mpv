use rusqlite::OptionalExtension;
use serde::{Deserialize, Serialize};
use tauri::State;

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

pub(crate) fn escape_like_dir(dir: &str) -> String {
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

pub(crate) fn media_type_for_path(path: &str) -> &'static str {
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


// ── fetch videos ──────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn db_fetch_videos(
    state: State<'_, DbState>,
    filter: VideoFilter,
) -> Result<FetchVideosResult, String> {
    let conn = state.conn()?;
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
    let conn = state.conn()?;
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
    let conn = state.conn()?;
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
    let conn = state.conn()?;
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
    let conn = state.conn()?;
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
    let conn = state.conn()?;
    conn.execute(
        "UPDATE videos SET thumbnail = ?1 WHERE id = ?2",
        rusqlite::params![thumbnail, video_id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn db_delete_video(state: State<'_, DbState>, video_id: i64) -> Result<(), String> {
    let conn = state.conn()?;
    conn.execute("DELETE FROM videos WHERE id = ?1", [video_id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn db_remove_video(state: State<'_, DbState>, video_id: i64) -> Result<(), String> {
    let conn = state.conn()?;
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
    let conn = state.conn()?;
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
    let conn = state.conn()?;
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
    let conn = state.conn()?;
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
    let conn = state.conn()?;
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
    let conn = state.conn()?;
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
    let conn = state.conn()?;
    conn.execute("UPDATE videos SET path = ?1 WHERE id = ?2", rusqlite::params![new_path, video_id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

pub(crate) fn remove_conflicting_videos(
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
    let conn = state.conn()?;
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
    let conn = state.conn()?;
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
    let conn = state.conn()?;
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
    let conn = state.conn()?;
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

/// .jpg サムネイルを持つ動画レコードの thumbnail を NULL にリセットする。
/// WebP 移行時に既存 .jpg サムネイルを再生成対象にするために使用する。
#[tauri::command]
pub async fn db_reset_jpg_thumbnails(
    state: State<'_, DbState>,
) -> Result<u32, String> {
    let conn = state.conn()?;
    let count = conn
        .execute(
            "UPDATE videos SET thumbnail = NULL WHERE thumbnail LIKE '%.jpg'",
            [],
        )
        .map_err(|e| e.to_string())?;
    Ok(count as u32)
}

#[tauri::command]
pub async fn db_update_thumbnails_batch(
    state: State<'_, DbState>,
    updates: Vec<ThumbnailUpdate>,
) -> Result<(), String> {
    if updates.is_empty() {
        return Ok(());
    }
    let conn = state.conn()?;

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
    let conn = state.conn()?;

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

