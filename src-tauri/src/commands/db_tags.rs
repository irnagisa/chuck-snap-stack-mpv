use rusqlite::OptionalExtension;
use serde::{Deserialize, Serialize};
use tauri::State;

use crate::db::DbState;

#[derive(Serialize, Deserialize)]
pub struct Tag {
    pub id: i64,
    pub name: String,
    pub color: String,
    pub icon: Option<String>,
    pub tag_category_id: Option<i64>,
    pub created_at: String,
}

#[derive(Serialize, Deserialize)]
pub struct Category {
    pub id: i64,
    pub name: String,
    pub color: String,
    pub icon: Option<String>,
    pub parent_id: Option<i64>,
    pub created_at: String,
}

#[derive(Serialize, Deserialize)]
pub struct TagCategory {
    pub id: i64,
    pub name: String,
    pub created_at: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VideoTagRow {
    pub video_id: i64,
    pub id: i64,
    pub name: String,
    pub color: String,
    pub icon: Option<String>,
    pub tag_category_id: Option<i64>,
    pub created_at: String,
}

// ── fetch ────────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn db_fetch_tags(state: State<'_, DbState>) -> Result<Vec<Tag>, String> {
    let conn = state.conn()?;
    let mut stmt = conn
        .prepare("SELECT id, name, color, icon, tag_category_id, created_at FROM tags ORDER BY name")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |r| {
            Ok(Tag {
                id: r.get(0)?,
                name: r.get(1)?,
                color: r.get(2)?,
                icon: r.get(3)?,
                tag_category_id: r.get(4)?,
                created_at: r.get(5)?,
            })
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<rusqlite::Result<_>>().map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn db_fetch_categories(state: State<'_, DbState>) -> Result<Vec<Category>, String> {
    let conn = state.conn()?;
    let mut stmt = conn
        .prepare(
            "SELECT id, name, color, icon, parent_id, created_at FROM categories ORDER BY name",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |r| {
            Ok(Category {
                id: r.get(0)?,
                name: r.get(1)?,
                color: r.get(2)?,
                icon: r.get(3)?,
                parent_id: r.get(4)?,
                created_at: r.get(5)?,
            })
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<rusqlite::Result<_>>().map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn db_fetch_tag_categories(
    state: State<'_, DbState>,
) -> Result<Vec<TagCategory>, String> {
    let conn = state.conn()?;
    let mut stmt = conn
        .prepare("SELECT id, name, created_at FROM tag_categories ORDER BY name")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |r| {
            Ok(TagCategory {
                id: r.get(0)?,
                name: r.get(1)?,
                created_at: r.get(2)?,
            })
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<rusqlite::Result<_>>().map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn db_fetch_video_tags_for_ids(
    state: State<'_, DbState>,
    video_ids: Vec<i64>,
) -> Result<Vec<VideoTagRow>, String> {
    if video_ids.is_empty() {
        return Ok(vec![]);
    }
    let conn = state.conn()?;
    // Build IN (...) placeholder (up to 499 params)
    let ph = video_ids.iter().map(|_| "?").collect::<Vec<_>>().join(", ");
    let sql = format!(
        "SELECT vt.video_id, t.id, t.name, t.color, t.icon, t.tag_category_id, t.created_at
         FROM video_tags vt JOIN tags t ON vt.tag_id = t.id
         WHERE vt.video_id IN ({ph})"
    );
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let params: Vec<rusqlite::types::Value> = video_ids
        .iter()
        .map(|&id| rusqlite::types::Value::Integer(id))
        .collect();
    let rows = stmt
        .query_map(rusqlite::params_from_iter(params.iter()), |r| {
            Ok(VideoTagRow {
                video_id: r.get(0)?,
                id: r.get(1)?,
                name: r.get(2)?,
                color: r.get(3)?,
                icon: r.get(4)?,
                tag_category_id: r.get(5)?,
                created_at: r.get(6)?,
            })
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<rusqlite::Result<_>>().map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn db_fetch_video_tags(
    state: State<'_, DbState>,
    video_id: i64,
) -> Result<Vec<Tag>, String> {
    let conn = state.conn()?;
    let mut stmt = conn
        .prepare(
            "SELECT t.id, t.name, t.color, t.icon, t.tag_category_id, t.created_at
             FROM tags t JOIN video_tags vt ON t.id = vt.tag_id
             WHERE vt.video_id = ?1 ORDER BY t.name",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([video_id], |r| {
            Ok(Tag {
                id: r.get(0)?,
                name: r.get(1)?,
                color: r.get(2)?,
                icon: r.get(3)?,
                tag_category_id: r.get(4)?,
                created_at: r.get(5)?,
            })
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<rusqlite::Result<_>>().map_err(|e| e.to_string())
}

// ── tag CRUD ─────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn db_create_tag(
    state: State<'_, DbState>,
    name: String,
    color: String,
    icon: Option<String>,
) -> Result<Tag, String> {
    let conn = state.conn()?;
    let rows_affected = conn
        .execute(
            "INSERT OR IGNORE INTO tags (name, color, icon) VALUES (?1, ?2, ?3)",
            rusqlite::params![name, color, icon],
        )
        .map_err(|e| e.to_string())?;

    if rows_affected > 0 {
        let id = conn.last_insert_rowid();
        let created_at = conn
            .query_row("SELECT created_at FROM tags WHERE id = ?1", [id], |r| {
                r.get::<_, String>(0)
            })
            .map_err(|e| e.to_string())?;
        Ok(Tag {
            id,
            name,
            color,
            icon,
            tag_category_id: None,
            created_at,
        })
    } else {
        conn.query_row(
            "SELECT id, name, color, icon, tag_category_id, created_at FROM tags WHERE name = ?1",
            [&name],
            |r| {
                Ok(Tag {
                    id: r.get(0)?,
                    name: r.get(1)?,
                    color: r.get(2)?,
                    icon: r.get(3)?,
                    tag_category_id: r.get(4)?,
                    created_at: r.get(5)?,
                })
            },
        )
        .map_err(|e| e.to_string())
    }
}

#[tauri::command]
pub async fn db_update_tag(
    state: State<'_, DbState>,
    tag_id: i64,
    name: String,
    color: String,
    tag_category_id: Option<i64>,
    icon: Option<String>,
) -> Result<(), String> {
    let conn = state.conn()?;
    conn.execute(
        "UPDATE tags SET name = ?1, color = ?2, tag_category_id = ?3, icon = ?4 WHERE id = ?5",
        rusqlite::params![name, color, tag_category_id, icon, tag_id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn db_delete_tag(state: State<'_, DbState>, tag_id: i64) -> Result<(), String> {
    let conn = state.conn()?;
    conn.execute("DELETE FROM tags WHERE id = ?1", [tag_id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn db_set_tag_category(
    state: State<'_, DbState>,
    tag_id: i64,
    tag_category_id: Option<i64>,
) -> Result<(), String> {
    let conn = state.conn()?;
    conn.execute(
        "UPDATE tags SET tag_category_id = ?1 WHERE id = ?2",
        rusqlite::params![tag_category_id, tag_id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

// ── tag category CRUD ────────────────────────────────────────────────────────

#[tauri::command]
pub async fn db_create_tag_category(
    state: State<'_, DbState>,
    name: String,
) -> Result<TagCategory, String> {
    let conn = state.conn()?;
    let rows_affected = conn
        .execute(
            "INSERT OR IGNORE INTO tag_categories (name) VALUES (?1)",
            [&name],
        )
        .map_err(|e| e.to_string())?;
    if rows_affected > 0 {
        let id = conn.last_insert_rowid();
        let created_at = conn
            .query_row(
                "SELECT created_at FROM tag_categories WHERE id = ?1",
                [id],
                |r| r.get::<_, String>(0),
            )
            .map_err(|e| e.to_string())?;
        Ok(TagCategory { id, name, created_at })
    } else {
        conn.query_row(
            "SELECT id, name, created_at FROM tag_categories WHERE name = ?1",
            [&name],
            |r| {
                Ok(TagCategory {
                    id: r.get(0)?,
                    name: r.get(1)?,
                    created_at: r.get(2)?,
                })
            },
        )
        .map_err(|e| e.to_string())
    }
}

#[tauri::command]
pub async fn db_update_tag_category(
    state: State<'_, DbState>,
    id: i64,
    name: String,
) -> Result<(), String> {
    let conn = state.conn()?;
    conn.execute(
        "UPDATE tag_categories SET name = ?1 WHERE id = ?2",
        rusqlite::params![name, id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn db_delete_tag_category(
    state: State<'_, DbState>,
    id: i64,
) -> Result<(), String> {
    let conn = state.conn()?;
    conn.execute(
        "UPDATE tags SET tag_category_id = NULL WHERE tag_category_id = ?1",
        [id],
    )
    .map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM tag_categories WHERE id = ?1", [id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

// ── category CRUD ─────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn db_create_category(
    state: State<'_, DbState>,
    name: String,
    color: String,
    parent_id: Option<i64>,
    icon: Option<String>,
) -> Result<Category, String> {
    let conn = state.conn()?;
    let rows_affected = conn
        .execute(
            "INSERT OR IGNORE INTO categories (name, color, parent_id, icon) VALUES (?1, ?2, ?3, ?4)",
            rusqlite::params![name, color, parent_id, icon],
        )
        .map_err(|e| e.to_string())?;
    if rows_affected > 0 {
        let id = conn.last_insert_rowid();
        let created_at = conn
            .query_row(
                "SELECT created_at FROM categories WHERE id = ?1",
                [id],
                |r| r.get::<_, String>(0),
            )
            .map_err(|e| e.to_string())?;
        Ok(Category {
            id,
            name,
            color,
            icon,
            parent_id,
            created_at,
        })
    } else {
        // Return existing record
        let row = if let Some(pid) = parent_id {
            conn.query_row(
                "SELECT id, name, color, icon, parent_id, created_at FROM categories WHERE name = ?1 AND parent_id = ?2",
                rusqlite::params![name, pid],
                |r| Ok(Category { id: r.get(0)?, name: r.get(1)?, color: r.get(2)?, icon: r.get(3)?, parent_id: r.get(4)?, created_at: r.get(5)? }),
            )
        } else {
            conn.query_row(
                "SELECT id, name, color, icon, parent_id, created_at FROM categories WHERE name = ?1 AND parent_id IS NULL",
                [&name],
                |r| Ok(Category { id: r.get(0)?, name: r.get(1)?, color: r.get(2)?, icon: r.get(3)?, parent_id: r.get(4)?, created_at: r.get(5)? }),
            )
        };
        row.map_err(|e| e.to_string())
    }
}

#[tauri::command]
pub async fn db_update_category(
    state: State<'_, DbState>,
    category_id: i64,
    name: String,
    color: String,
    parent_id: Option<i64>,
    icon: Option<String>,
) -> Result<(), String> {
    let conn = state.conn()?;
    conn.execute(
        "UPDATE categories SET name = ?1, color = ?2, parent_id = ?3, icon = ?4 WHERE id = ?5",
        rusqlite::params![name, color, parent_id, icon, category_id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn db_delete_category(
    state: State<'_, DbState>,
    category_id: i64,
) -> Result<(), String> {
    let conn = state.conn()?;
    // Promote children to root
    conn.execute(
        "UPDATE categories SET parent_id = NULL WHERE parent_id = ?1",
        [category_id],
    )
    .map_err(|e| e.to_string())?;
    // Unset category on videos
    conn.execute(
        "UPDATE videos SET category_id = NULL WHERE category_id = ?1",
        [category_id],
    )
    .map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM categories WHERE id = ?1", [category_id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

// ── video-tag operations ──────────────────────────────────────────────────────

#[tauri::command]
pub async fn db_add_tag_to_video(
    state: State<'_, DbState>,
    video_id: i64,
    tag_id: i64,
) -> Result<(), String> {
    let conn = state.conn()?;
    conn.execute(
        "INSERT OR IGNORE INTO video_tags (video_id, tag_id) VALUES (?1, ?2)",
        [video_id, tag_id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn db_remove_tag_from_video(
    state: State<'_, DbState>,
    video_id: i64,
    tag_id: i64,
) -> Result<(), String> {
    let conn = state.conn()?;
    conn.execute(
        "DELETE FROM video_tags WHERE video_id = ?1 AND tag_id = ?2",
        [video_id, tag_id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn db_set_video_category(
    state: State<'_, DbState>,
    video_id: i64,
    category_id: Option<i64>,
) -> Result<(), String> {
    let conn = state.conn()?;
    conn.execute(
        "UPDATE videos SET category_id = ?1 WHERE id = ?2",
        rusqlite::params![category_id, video_id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn db_add_tag_to_multiple(
    state: State<'_, DbState>,
    video_ids: Vec<i64>,
    tag_id: i64,
) -> Result<(), String> {
    if video_ids.is_empty() {
        return Ok(());
    }
    let conn = state.conn()?;
    // Batch insert: 2 params per row, max 499 rows to stay under SQLite 999 limit
    let batch_size = 499;
    for chunk in video_ids.chunks(batch_size) {
        let ph = chunk.iter().map(|_| "(?, ?)").collect::<Vec<_>>().join(", ");
        let sql = format!("INSERT OR IGNORE INTO video_tags (video_id, tag_id) VALUES {ph}");
        let mut params: Vec<rusqlite::types::Value> = Vec::with_capacity(chunk.len() * 2);
        for &vid in chunk {
            params.push(rusqlite::types::Value::Integer(vid));
            params.push(rusqlite::types::Value::Integer(tag_id));
        }
        conn.execute(&sql, rusqlite::params_from_iter(params.iter()))
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub async fn db_set_category_multiple(
    state: State<'_, DbState>,
    video_ids: Vec<i64>,
    category_id: Option<i64>,
) -> Result<(), String> {
    if video_ids.is_empty() {
        return Ok(());
    }
    let conn = state.conn()?;
    // 1 param for category_id + up to 498 ids per batch
    let batch_size = 498;
    for chunk in video_ids.chunks(batch_size) {
        let ph = chunk.iter().map(|_| "?").collect::<Vec<_>>().join(", ");
        let sql = format!("UPDATE videos SET category_id = ? WHERE id IN ({ph})");
        let mut params: Vec<rusqlite::types::Value> = Vec::with_capacity(chunk.len() + 1);
        match category_id {
            Some(id) => params.push(rusqlite::types::Value::Integer(id)),
            None => params.push(rusqlite::types::Value::Null),
        }
        for &vid in chunk {
            params.push(rusqlite::types::Value::Integer(vid));
        }
        conn.execute(&sql, rusqlite::params_from_iter(params.iter()))
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Build category hierarchy from a relative dir path like "Movies/Action".
/// Returns the leaf category id. Used by scan commands.
pub fn build_category_hierarchy(
    conn: &rusqlite::Connection,
    rel_dir_path: &str,
    cache: &mut std::collections::HashMap<String, i64>,
    color: &str,
) -> rusqlite::Result<Option<i64>> {
    let segments: Vec<&str> = rel_dir_path.split('/').filter(|s| !s.is_empty()).collect();
    if segments.is_empty() {
        return Ok(None);
    }
    let mut parent_id: Option<i64> = None;
    let mut leaf_id: Option<i64> = None;
    for &name in &segments {
        let cache_key = format!("{}/{name}", parent_id.map(|id| id.to_string()).unwrap_or_default());
        if let Some(&cached) = cache.get(&cache_key) {
            leaf_id = Some(cached);
        } else {
            let existing_id: Option<i64> = if parent_id.is_none() {
                conn.query_row(
                    "SELECT id FROM categories WHERE name = ?1 AND parent_id IS NULL",
                    [name],
                    |r| r.get(0),
                )
                .optional()?
            } else {
                conn.query_row(
                    "SELECT id FROM categories WHERE name = ?1 AND parent_id = ?2",
                    rusqlite::params![name, parent_id.unwrap()],
                    |r| r.get(0),
                )
                .optional()?
            };
            let id = if let Some(eid) = existing_id {
                eid
            } else {
                conn.execute(
                    "INSERT INTO categories (name, color, icon, parent_id) VALUES (?1, ?2, 'folder', ?3)",
                    rusqlite::params![name, color, parent_id],
                )?;
                conn.last_insert_rowid()
            };
            cache.insert(cache_key, id);
            leaf_id = Some(id);
        }
        parent_id = leaf_id;
    }
    Ok(leaf_id)
}
