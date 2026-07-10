use rusqlite::OptionalExtension;
use serde::{Deserialize, Serialize};
use std::path::Path;
use tauri::State;

use crate::db::DbState;
use super::utils::resolve_unique_path;
use super::db_videos::auto_graduate_if_complete;

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
    let conn = state.conn_read()?;
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
    let conn = state.conn_read()?;
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
    let conn = state.conn_read()?;
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
    let conn = state.conn_read()?;
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
    let conn = state.conn_read()?;
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

// ── Sync モード用ヘルパー ──────────────────────────────────────────────────────

/// カテゴリの相対ディレクトリパスを構築する (例: "Movies/Action")
fn build_category_rel_path(conn: &rusqlite::Connection, category_id: i64) -> Result<String, String> {
    let mut parts: Vec<String> = Vec::new();
    let mut current_id = category_id;
    loop {
        let row: Option<(String, Option<i64>)> = conn
            .query_row(
                "SELECT name, parent_id FROM categories WHERE id = ?1",
                [current_id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .optional()
            .map_err(|e| e.to_string())?;
        match row {
            None => break,
            Some((name, parent)) => {
                parts.push(name);
                match parent {
                    Some(pid) => current_id = pid,
                    None => break,
                }
            }
        }
    }
    parts.reverse();
    Ok(parts.join("/"))
}

/// 新しい parent_id と name から相対パスを構築する (DB 更新前の新パス計算用)
fn build_new_category_rel_path(
    conn: &rusqlite::Connection,
    parent_id: Option<i64>,
    name: &str,
) -> Result<String, String> {
    match parent_id {
        None => Ok(name.to_string()),
        Some(pid) => {
            let parent_path = build_category_rel_path(conn, pid)?;
            Ok(format!("{parent_path}/{name}"))
        }
    }
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
    // Step 1: 現在の状態を読み取る (DB ロックを短時間だけ保持)
    let (old_rel_path, new_rel_path, sync_watch_dirs) = {
        let conn = state.conn()?;

        let (old_name, old_parent_id): (String, Option<i64>) = conn
            .query_row(
                "SELECT name, parent_id FROM categories WHERE id = ?1",
                [category_id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .map_err(|e| e.to_string())?;

        let sync_dirs: Vec<String> = {
            let mut stmt = conn
                .prepare("SELECT path FROM watch_dirs WHERE use_dir_as_category = 1")
                .map_err(|e| e.to_string())?;
            let result = stmt
                .query_map([], |r| r.get(0))
                .map_err(|e| e.to_string())?
                .collect::<rusqlite::Result<Vec<String>>>()
                .map_err(|e| e.to_string())?;
            result
        };

        let needs_fs = !sync_dirs.is_empty() && (old_name != name || old_parent_id != parent_id);

        if needs_fs {
            let old_rel = build_category_rel_path(&conn, category_id)?;
            let new_rel = build_new_category_rel_path(&conn, parent_id, &name)?;
            (old_rel, new_rel, sync_dirs)
        } else {
            (String::new(), String::new(), Vec::new())
        }
    }; // DB ロック解放

    // Step 2: FS リネーム (DB ロック外)
    for watch_dir in &sync_watch_dirs {
        let old_abs = Path::new(watch_dir).join(&old_rel_path);
        let new_abs = Path::new(watch_dir).join(&new_rel_path);

        if !old_abs.exists() {
            continue;
        }
        if new_abs.exists() {
            return Err(format!(
                "カテゴリ名変更失敗: 移動先ディレクトリが既に存在します: {}",
                new_abs.display()
            ));
        }
        if let Some(new_parent) = new_abs.parent() {
            std::fs::create_dir_all(new_parent)
                .map_err(|e| format!("親ディレクトリ作成失敗: {e}"))?;
        }
        std::fs::rename(&old_abs, &new_abs)
            .map_err(|e| format!("ディレクトリリネーム失敗: {e}"))?;
    }

    // Step 3: DB 更新 (videos.path + categories)
    {
        let conn = state.conn()?;
        for watch_dir in &sync_watch_dirs {
            let old_abs = Path::new(watch_dir).join(&old_rel_path).to_string_lossy().into_owned();
            let new_abs = Path::new(watch_dir).join(&new_rel_path).to_string_lossy().into_owned();
            // パスが old_abs/ 以下のファイルを一括更新
            conn.execute(
                "UPDATE videos SET path = ?1 || substr(path, length(?2) + 1) WHERE path LIKE ?3",
                rusqlite::params![new_abs, old_abs, format!("{old_abs}/%")],
            )
            .map_err(|e| e.to_string())?;
        }
        conn.execute(
            "UPDATE categories SET name = ?1, color = ?2, parent_id = ?3, icon = ?4 WHERE id = ?5",
            rusqlite::params![name, color, parent_id, icon, category_id],
        )
        .map_err(|e| e.to_string())?;
    }

    Ok(())
}

#[tauri::command]
pub async fn db_delete_category(
    state: State<'_, DbState>,
    category_id: i64,
) -> Result<(), String> {
    // Step 1: 必要な情報を収集 (DB ロックを短時間だけ保持)
    struct CatInfo {
        cat_rel_path: String,
        parent_rel_path: Option<String>,
        children_names: Vec<String>,
        sync_watch_dirs: Vec<String>,
    }

    let info = {
        let conn = state.conn()?;

        let (_, parent_id): (String, Option<i64>) = conn
            .query_row(
                "SELECT name, parent_id FROM categories WHERE id = ?1",
                [category_id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .map_err(|e| e.to_string())?;

        let cat_rel_path = build_category_rel_path(&conn, category_id)?;

        let parent_rel_path = match parent_id {
            Some(pid) => Some(build_category_rel_path(&conn, pid)?),
            None => None,
        };

        let children_names: Vec<String> = {
            let mut stmt = conn
                .prepare("SELECT name FROM categories WHERE parent_id = ?1")
                .map_err(|e| e.to_string())?;
            let result = stmt
                .query_map([category_id], |r| r.get(0))
                .map_err(|e| e.to_string())?
                .collect::<rusqlite::Result<Vec<String>>>()
                .map_err(|e| e.to_string())?;
            result
        };

        let sync_watch_dirs: Vec<String> = {
            let mut stmt = conn
                .prepare("SELECT path FROM watch_dirs WHERE use_dir_as_category = 1")
                .map_err(|e| e.to_string())?;
            let result = stmt
                .query_map([], |r| r.get(0))
                .map_err(|e| e.to_string())?
                .collect::<rusqlite::Result<Vec<String>>>()
                .map_err(|e| e.to_string())?;
            result
        };

        CatInfo { cat_rel_path, parent_rel_path, children_names, sync_watch_dirs }
    }; // DB ロック解放

    // Step 2: FS 操作 (DB ロック外)
    // (old_path, new_path) のリスト: ファイル移動の追跡用
    let mut exact_updates: Vec<(String, String)> = Vec::new(); // ファイル単位
    let mut prefix_updates: Vec<(String, String)> = Vec::new(); // ディレクトリ単位

    if !info.sync_watch_dirs.is_empty() {
        for watch_dir in &info.sync_watch_dirs {
            let cat_abs = Path::new(watch_dir).join(&info.cat_rel_path);
            if !cat_abs.exists() {
                continue;
            }

            // 直接ファイルの移動先: 親カテゴリ dir か Unsorted
            let dest_for_files = match &info.parent_rel_path {
                Some(p) => Path::new(watch_dir).join(p),
                None => Path::new(watch_dir).join("Unsorted"),
            };

            // 子カテゴリディレクトリの衝突を事前確認
            for child_name in &info.children_names {
                let child_old = cat_abs.join(child_name);
                let child_new = Path::new(watch_dir).join(child_name);
                if child_old.exists() && child_new.exists() {
                    return Err(format!(
                        "カテゴリ削除失敗: 子カテゴリ '{}' のディレクトリが既に存在します: {}",
                        child_name,
                        child_new.display()
                    ));
                }
            }

            // 移動先ディレクトリを作成
            std::fs::create_dir_all(&dest_for_files)
                .map_err(|e| format!("移動先ディレクトリ作成失敗: {e}"))?;

            // cat_abs の直下ファイル (サブディレクトリは除く) を移動
            for entry in std::fs::read_dir(&cat_abs).map_err(|e| e.to_string())? {
                let entry = entry.map_err(|e| e.to_string())?;
                let entry_path = entry.path();
                if !entry_path.is_file() {
                    continue;
                }
                let filename = entry_path.file_name().unwrap();
                let dest_path = resolve_unique_path(&dest_for_files.join(filename));

                // TOCTOU 防止: 移動先をアトミックに確保してから rename
                std::fs::OpenOptions::new()
                    .write(true)
                    .create_new(true)
                    .open(&dest_path)
                    .map_err(|e| format!("移動先ファイル確保失敗: {e}"))?;

                if let Err(e) = std::fs::rename(&entry_path, &dest_path) {
                    let _ = std::fs::remove_file(&dest_path);
                    return Err(format!("ファイル移動失敗: {e}"));
                }

                exact_updates.push((
                    entry_path.to_string_lossy().into_owned(),
                    dest_path.to_string_lossy().into_owned(),
                ));
            }

            // 子カテゴリディレクトリを watch_dir 直下へ移動 (root 昇格に対応)
            for child_name in &info.children_names {
                let child_old = cat_abs.join(child_name);
                let child_new = Path::new(watch_dir).join(child_name);
                if !child_old.exists() {
                    continue;
                }
                std::fs::rename(&child_old, &child_new)
                    .map_err(|e| format!("子カテゴリディレクトリ移動失敗: {e}"))?;

                prefix_updates.push((
                    format!("{}/", child_old.to_string_lossy()),
                    format!("{}/", child_new.to_string_lossy()),
                ));
            }

            // 空になったカテゴリディレクトリを削除 (失敗は無視)
            let _ = std::fs::remove_dir(&cat_abs);
        }
    }

    // Step 3: videos.path を DB 更新
    if !exact_updates.is_empty() || !prefix_updates.is_empty() {
        let conn = state.conn()?;
        for (old_path, new_path) in &exact_updates {
            conn.execute(
                "UPDATE videos SET path = ?1 WHERE path = ?2",
                rusqlite::params![new_path, old_path],
            )
            .map_err(|e| e.to_string())?;
        }
        for (old_prefix, new_prefix) in &prefix_updates {
            let old_no_slash = old_prefix.trim_end_matches('/');
            let new_no_slash = new_prefix.trim_end_matches('/');
            conn.execute(
                "UPDATE videos SET path = ?1 || substr(path, length(?2) + 1) WHERE path LIKE ?3",
                rusqlite::params![new_no_slash, old_no_slash, format!("{old_prefix}%")],
            )
            .map_err(|e| e.to_string())?;
        }
    }

    // Step 4: カテゴリ構造を DB 更新
    {
        let conn = state.conn()?;
        conn.execute(
            "UPDATE categories SET parent_id = NULL WHERE parent_id = ?1",
            [category_id],
        )
        .map_err(|e| e.to_string())?;
        conn.execute(
            "UPDATE videos SET category_id = NULL, status = 'inbox' WHERE category_id = ?1",
            [category_id],
        )
        .map_err(|e| e.to_string())?;
        conn.execute("DELETE FROM categories WHERE id = ?1", [category_id])
            .map_err(|e| e.to_string())?;
    }

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
    auto_graduate_if_complete(&conn, video_id).map_err(|e| e.to_string())?;
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
    if category_id.is_none() {
        conn.execute(
            "UPDATE videos SET category_id = NULL, status = 'inbox' WHERE id = ?1",
            [video_id],
        )
        .map_err(|e| e.to_string())?;
    } else {
        conn.execute(
            "UPDATE videos SET category_id = ?1 WHERE id = ?2",
            rusqlite::params![category_id, video_id],
        )
        .map_err(|e| e.to_string())?;
        auto_graduate_if_complete(&conn, video_id).map_err(|e| e.to_string())?;
    }
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

        // タグが追加されたのでカテゴリ・評価が揃っていれば自動卒業
        let id_ph = chunk.iter().map(|_| "?").collect::<Vec<_>>().join(", ");
        let graduate_sql = format!(
            "UPDATE videos SET status = NULL WHERE id IN ({id_ph}) AND status = 'inbox'
             AND category_id IS NOT NULL AND rating IS NOT NULL AND rating > 0"
        );
        let id_params: Vec<rusqlite::types::Value> =
            chunk.iter().map(|&id| rusqlite::types::Value::Integer(id)).collect();
        conn.execute(&graduate_sql, rusqlite::params_from_iter(id_params.iter()))
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
    if category_id.is_none() {
        // カテゴリ解除 → status を 'inbox' に戻す。params は id のみ (batch_size 999)
        let batch_size = 999;
        for chunk in video_ids.chunks(batch_size) {
            let ph = chunk.iter().map(|_| "?").collect::<Vec<_>>().join(", ");
            let sql = format!(
                "UPDATE videos SET category_id = NULL, status = 'inbox' WHERE id IN ({ph})"
            );
            let params: Vec<rusqlite::types::Value> = chunk
                .iter()
                .map(|&id| rusqlite::types::Value::Integer(id))
                .collect();
            conn.execute(&sql, rusqlite::params_from_iter(params.iter()))
                .map_err(|e| e.to_string())?;
        }
    } else {
        // 1 param for category_id + up to 498 ids per batch
        let batch_size = 498;
        for chunk in video_ids.chunks(batch_size) {
            let ph = chunk.iter().map(|_| "?").collect::<Vec<_>>().join(", ");
            let sql = format!("UPDATE videos SET category_id = ? WHERE id IN ({ph})");
            let mut params: Vec<rusqlite::types::Value> = Vec::with_capacity(chunk.len() + 1);
            params.push(rusqlite::types::Value::Integer(category_id.unwrap()));
            for &vid in chunk {
                params.push(rusqlite::types::Value::Integer(vid));
            }
            conn.execute(&sql, rusqlite::params_from_iter(params.iter()))
                .map_err(|e| e.to_string())?;

            // カテゴリが設定されたので評価・タグが揃っていれば自動卒業
            let id_ph = chunk.iter().map(|_| "?").collect::<Vec<_>>().join(", ");
            let graduate_sql = format!(
                "UPDATE videos SET status = NULL WHERE id IN ({id_ph}) AND status = 'inbox'
                 AND rating IS NOT NULL AND rating > 0
                 AND id IN (SELECT DISTINCT video_id FROM video_tags)"
            );
            let id_params: Vec<rusqlite::types::Value> =
                chunk.iter().map(|&id| rusqlite::types::Value::Integer(id)).collect();
            conn.execute(&graduate_sql, rusqlite::params_from_iter(id_params.iter()))
                .map_err(|e| e.to_string())?;
        }
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
