use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::State;

use crate::db::DbState;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupData {
    pub version: i32,
    pub exported_at: String,
    pub videos: Vec<Value>,
    pub categories: Vec<Value>,
    pub tags: Vec<Value>,
    pub tag_categories: Vec<Value>,
    pub video_tags: Vec<Value>,
    pub playlists: Vec<Value>,
    pub playlist_items: Vec<Value>,
    pub settings: Vec<Value>,
    pub watch_dirs: Vec<Value>,
    pub smart_playlists: Vec<Value>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportData {
    pub version: Option<i32>,
    pub videos: Option<Vec<Value>>,
    pub categories: Option<Vec<Value>>,
    pub tags: Option<Vec<Value>>,
    pub tag_categories: Option<Vec<Value>>,
    pub video_tags: Option<Vec<Value>>,
    pub playlists: Option<Vec<Value>>,
    pub playlist_items: Option<Vec<Value>>,
    pub settings: Option<Vec<Value>>,
    pub watch_dirs: Option<Vec<Value>>,
    pub smart_playlists: Option<Vec<Value>>,
}

fn select_all(conn: &rusqlite::Connection, table: &str) -> rusqlite::Result<Vec<Value>> {
    let mut stmt = conn.prepare(&format!("SELECT * FROM {table}"))?;
    let col_count = stmt.column_count();
    let col_names: Vec<String> = (0..col_count)
        .map(|i| stmt.column_name(i).unwrap_or("").to_string())
        .collect();
    let rows = stmt.query_map([], |row| {
        let mut map = serde_json::Map::new();
        for (i, name) in col_names.iter().enumerate() {
            let val = match row.get_ref(i)? {
                rusqlite::types::ValueRef::Null => Value::Null,
                rusqlite::types::ValueRef::Integer(n) => Value::from(n),
                rusqlite::types::ValueRef::Real(f) => Value::from(f),
                rusqlite::types::ValueRef::Text(s) => {
                    Value::String(String::from_utf8_lossy(s).into_owned())
                }
                rusqlite::types::ValueRef::Blob(b) => {
                    Value::String(base64_encode(b))
                }
            };
            map.insert(name.clone(), val);
        }
        Ok(Value::Object(map))
    })?;
    rows.collect()
}

fn base64_encode(data: &[u8]) -> String {
    // Simple base64 for blob fields (unlikely but safe)
    let mut out = String::new();
    let alphabet = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    for chunk in data.chunks(3) {
        let b0 = chunk[0] as usize;
        let b1 = if chunk.len() > 1 { chunk[1] as usize } else { 0 };
        let b2 = if chunk.len() > 2 { chunk[2] as usize } else { 0 };
        out.push(alphabet[(b0 >> 2) & 0x3f] as char);
        out.push(alphabet[((b0 << 4) | (b1 >> 4)) & 0x3f] as char);
        out.push(if chunk.len() > 1 { alphabet[((b1 << 2) | (b2 >> 6)) & 0x3f] as char } else { '=' });
        out.push(if chunk.len() > 2 { alphabet[b2 & 0x3f] as char } else { '=' });
    }
    out
}

#[tauri::command]
pub async fn db_export_backup(state: State<'_, DbState>) -> Result<BackupData, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let now = chrono_or_fallback();
    Ok(BackupData {
        version: 1,
        exported_at: now,
        videos: select_all(&conn, "videos").map_err(|e| e.to_string())?,
        categories: select_all(&conn, "categories").map_err(|e| e.to_string())?,
        tags: select_all(&conn, "tags").map_err(|e| e.to_string())?,
        tag_categories: select_all(&conn, "tag_categories").map_err(|e| e.to_string())?,
        video_tags: select_all(&conn, "video_tags").map_err(|e| e.to_string())?,
        playlists: select_all(&conn, "playlists").map_err(|e| e.to_string())?,
        playlist_items: select_all(&conn, "playlist_items").map_err(|e| e.to_string())?,
        settings: select_all(&conn, "settings").map_err(|e| e.to_string())?,
        watch_dirs: select_all(&conn, "watch_dirs").map_err(|e| e.to_string())?,
        smart_playlists: select_all(&conn, "smart_playlists")
            .unwrap_or_default(),
    })
}

#[tauri::command]
pub async fn db_import_backup(
    state: State<'_, DbState>,
    data: ImportData,
) -> Result<(), String> {
    if data.version.is_none() || data.videos.is_none() {
        return Err("バックアップファイルの形式が正しくありません".to_string());
    }
    let conn = state.0.lock().map_err(|e| e.to_string())?;

    conn.execute_batch("BEGIN").map_err(|e| e.to_string())?;

    let result: Result<(), String> = (|| {
        conn.execute_batch(
            "DELETE FROM playlist_items;
             DELETE FROM video_tags;
             DELETE FROM playlists;
             DELETE FROM videos;
             DELETE FROM tags;
             DELETE FROM categories;",
        )
        .map_err(|e| e.to_string())?;
        let _ = conn.execute_batch("DELETE FROM smart_playlists");

        // categories
        for row in data.categories.unwrap_or_default() {
            conn.execute(
                "INSERT OR IGNORE INTO categories (id, name, color, parent_id, icon, created_at) VALUES (?1,?2,?3,?4,?5,?6)",
                rusqlite::params![
                    row.get("id").and_then(|v| v.as_i64()),
                    row.get("name").and_then(|v| v.as_str()),
                    row.get("color").and_then(|v| v.as_str()),
                    row.get("parent_id").and_then(|v| v.as_i64()),
                    row.get("icon").and_then(|v| v.as_str()),
                    row.get("created_at").and_then(|v| v.as_str()),
                ],
            ).map_err(|e| e.to_string())?;
        }

        // tags
        for row in data.tags.unwrap_or_default() {
            conn.execute(
                "INSERT OR IGNORE INTO tags (id, name, color, tag_category_id, created_at) VALUES (?1,?2,?3,?4,?5)",
                rusqlite::params![
                    row.get("id").and_then(|v| v.as_i64()),
                    row.get("name").and_then(|v| v.as_str()),
                    row.get("color").and_then(|v| v.as_str()),
                    row.get("tag_category_id").and_then(|v| v.as_i64()),
                    row.get("created_at").and_then(|v| v.as_str()),
                ],
            ).map_err(|e| e.to_string())?;
        }

        // videos
        for row in data.videos.unwrap_or_default() {
            conn.execute(
                "INSERT OR IGNORE INTO videos
                  (id, path, title, duration, thumbnail, watched_at, progress, rating,
                   category_id, has_audio, watch_count, created_at)
                 VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12)",
                rusqlite::params![
                    row.get("id").and_then(|v| v.as_i64()),
                    row.get("path").and_then(|v| v.as_str()),
                    row.get("title").and_then(|v| v.as_str()),
                    row.get("duration").and_then(|v| v.as_f64()),
                    row.get("thumbnail").and_then(|v| v.as_str()),
                    row.get("watched_at").and_then(|v| v.as_str()),
                    row.get("progress").and_then(|v| v.as_f64()).unwrap_or(0.0),
                    row.get("rating").and_then(|v| v.as_i64()).unwrap_or(0),
                    row.get("category_id").and_then(|v| v.as_i64()),
                    row.get("has_audio").and_then(|v| v.as_i64()),
                    row.get("watch_count").and_then(|v| v.as_i64()).unwrap_or(0),
                    row.get("created_at").and_then(|v| v.as_str()),
                ],
            ).map_err(|e| e.to_string())?;
        }

        // video_tags
        for row in data.video_tags.unwrap_or_default() {
            conn.execute(
                "INSERT OR IGNORE INTO video_tags (video_id, tag_id) VALUES (?1,?2)",
                rusqlite::params![
                    row.get("video_id").and_then(|v| v.as_i64()),
                    row.get("tag_id").and_then(|v| v.as_i64()),
                ],
            ).map_err(|e| e.to_string())?;
        }

        // playlists
        for row in data.playlists.unwrap_or_default() {
            conn.execute(
                "INSERT OR IGNORE INTO playlists (id, name, created_at) VALUES (?1,?2,?3)",
                rusqlite::params![
                    row.get("id").and_then(|v| v.as_i64()),
                    row.get("name").and_then(|v| v.as_str()),
                    row.get("created_at").and_then(|v| v.as_str()),
                ],
            ).map_err(|e| e.to_string())?;
        }

        // playlist_items
        for row in data.playlist_items.unwrap_or_default() {
            conn.execute(
                "INSERT OR IGNORE INTO playlist_items (playlist_id, video_id, position) VALUES (?1,?2,?3)",
                rusqlite::params![
                    row.get("playlist_id").and_then(|v| v.as_i64()),
                    row.get("video_id").and_then(|v| v.as_i64()),
                    row.get("position").and_then(|v| v.as_i64()),
                ],
            ).map_err(|e| e.to_string())?;
        }

        // smart_playlists
        for row in data.smart_playlists.unwrap_or_default() {
            conn.execute(
                "INSERT OR IGNORE INTO smart_playlists (id, name, filter_json, created_at) VALUES (?1,?2,?3,?4)",
                rusqlite::params![
                    row.get("id").and_then(|v| v.as_i64()),
                    row.get("name").and_then(|v| v.as_str()),
                    row.get("filter_json").and_then(|v| v.as_str()),
                    row.get("created_at").and_then(|v| v.as_str()),
                ],
            ).map_err(|e| e.to_string())?;
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

fn chrono_or_fallback() -> String {
    // Use SQLite's CURRENT_TIMESTAMP equivalent without external crate
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| {
            let secs = d.as_secs();
            let s = secs % 60;
            let m = (secs / 60) % 60;
            let h = (secs / 3600) % 24;
            // rough ISO-8601 (not exact calendar date, just for logging)
            format!("2024-01-01T{h:02}:{m:02}:{s:02}Z (unix={secs})")
        })
        .unwrap_or_else(|_| "unknown".to_string())
}
