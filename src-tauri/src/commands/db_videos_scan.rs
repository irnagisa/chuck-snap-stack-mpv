// スキャン・インポート・バッチウォッチャー更新コマンド

use rusqlite::OptionalExtension;
use tauri::State;

use crate::commands::db_tags::build_category_hierarchy;
use crate::commands::db_videos::{
    escape_like_dir, media_type_for_path, remove_conflicting_videos,
    ScanImportResult, RescanResult, VideoIdPath, WatcherCreate, WatcherRename,
};
use crate::commands::library::scan_dir_core;
use crate::db::DbState;

// ── helpers ───────────────────────────────────────────────────────────────────

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
        if let Err(rb_err) = conn.execute_batch("ROLLBACK") {
            log::error!("[DB] delete_video_ids_tx ROLLBACK 失敗: {rb_err}");
        }
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
        if let Err(rb_err) = conn.execute_batch("ROLLBACK") {
            log::error!("[DB] assign_categories_for_ids ROLLBACK 失敗: {rb_err}");
        }
        return Err(result.unwrap_err());
    }
    Ok(assigned)
}

// ── scan & import ─────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn db_scan_and_import(
    state: State<'_, DbState>,
    path: String,
    use_dir_as_category: bool,
) -> Result<ScanImportResult, String> {
    // パス検証: 絶対パス・パストラバーサル禁止・最低深度チェック
    super::utils::validate_path(&path)?;
    if std::path::Path::new(&path).components().count() < 3 {
        return Err(
            "ルートや最上位ディレクトリはスキャン対象に指定できません".to_string(),
        );
    }
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
    let conn = state.conn()?;

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
        if let Err(rb_err) = conn.execute_batch("ROLLBACK") {
            log::error!("[db_scan_and_import] ROLLBACK 失敗: {rb_err}");
        }
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
        let conn = state.conn()?;
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
    let conn = state.conn()?;
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
            if let Err(rb_err) = conn.execute_batch("ROLLBACK") {
                log::error!("[DB] db_rescan_all_dirs INSERT ROLLBACK 失敗: {rb_err}");
            }
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
    // アクセス可能なディレクトリのみ対象（ドライブ未接続時はスキップしてデータ保護）
    {
        let accessible_dirs: Vec<&(String, bool)> = dirs_to_scan
            .iter()
            .filter(|(d, _)| std::path::Path::new(d).is_dir())
            .collect();
        if accessible_dirs.is_empty() {
            return Ok(RescanResult {
                new_count: total_new_count,
                scanned_count: total_scanned_count,
                errors: all_errors,
                truncated: total_truncated,
                skipped_count: total_skipped,
            });
        }
        let dir_conditions: Vec<String> = accessible_dirs
            .iter()
            .map(|_| "REPLACE(path, '\\\\', '/') LIKE ? ESCAPE '!'".to_string())
            .collect();
        let dir_cond_sql = dir_conditions.join(" OR ");
        let dir_params: Vec<rusqlite::types::Value> = accessible_dirs
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

#[tauri::command]
pub async fn db_assign_category_from_path(
    state: State<'_, DbState>,
    video_ids: Vec<i64>,
) -> Result<i64, String> {
    let conn = state.conn()?;
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
    let conn = state.conn()?;

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
    let conn = state.conn()?;
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
