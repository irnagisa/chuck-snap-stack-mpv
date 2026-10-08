use rusqlite::{Connection, Result};

use crate::commands::utils::normalize_path_str;

pub fn run_data_migrations(conn: &Connection) -> Result<()> {
    // Migration 1: categories_perparent_unique
    // Recreate categories table without unique constraint on name so that
    // sibling nodes with the same name but different parent_id are allowed.
    let cat_migrated: bool = conn
        .query_row(
            "SELECT value FROM settings WHERE key = 'migration_categories_perparent_unique'",
            [],
            |r| r.get::<_, String>(0),
        )
        .map(|v| v == "1")
        .unwrap_or(false);

    if !cat_migrated {
        conn.execute_batch(
            "BEGIN;
             CREATE TABLE IF NOT EXISTS categories_new (
               id         INTEGER PRIMARY KEY AUTOINCREMENT,
               name       TEXT NOT NULL,
               color      TEXT NOT NULL DEFAULT '#6366f1',
               parent_id  INTEGER REFERENCES categories_new(id),
               icon       TEXT DEFAULT NULL,
               created_at TEXT DEFAULT CURRENT_TIMESTAMP
             );
             INSERT OR IGNORE INTO categories_new
               SELECT id, name, color, parent_id, icon, created_at FROM categories;
             DROP TABLE categories;
             ALTER TABLE categories_new RENAME TO categories;
             INSERT OR REPLACE INTO settings (key, value)
               VALUES ('migration_categories_perparent_unique', '1');
             COMMIT;",
        )
        .unwrap_or_else(|_| {
            let _ = conn.execute_batch("ROLLBACK");
        });

        // Re-create partial unique indexes after table recreation
        let _ = conn.execute_batch(
            "CREATE UNIQUE INDEX IF NOT EXISTS idx_categories_unique_root
               ON categories(name) WHERE parent_id IS NULL;
             CREATE UNIQUE INDEX IF NOT EXISTS idx_categories_unique_child
               ON categories(name, parent_id) WHERE parent_id IS NOT NULL;",
        );
    }

    // Migration 2: media_type_fix — set media_type for images/audio from file extension
    let mt_migrated: bool = conn
        .query_row(
            "SELECT value FROM settings WHERE key = 'migration_media_type_fix'",
            [],
            |r| r.get::<_, String>(0),
        )
        .map(|v| v == "1")
        .unwrap_or(false);

    if !mt_migrated {
        conn.execute_batch(
            "UPDATE videos SET media_type = 'image'
               WHERE (media_type = 'video' OR media_type IS NULL)
               AND (LOWER(path) LIKE '%.jpg' OR LOWER(path) LIKE '%.jpeg'
                 OR LOWER(path) LIKE '%.png' OR LOWER(path) LIKE '%.gif'
                 OR LOWER(path) LIKE '%.webp' OR LOWER(path) LIKE '%.bmp'
                 OR LOWER(path) LIKE '%.tiff' OR LOWER(path) LIKE '%.heic'
                 OR LOWER(path) LIKE '%.avif');
             UPDATE videos SET media_type = 'audio'
               WHERE (media_type = 'video' OR media_type IS NULL)
               AND (LOWER(path) LIKE '%.mp3' OR LOWER(path) LIKE '%.flac'
                 OR LOWER(path) LIKE '%.aac' OR LOWER(path) LIKE '%.wav'
                 OR LOWER(path) LIKE '%.ogg' OR LOWER(path) LIKE '%.opus'
                 OR LOWER(path) LIKE '%.m4a' OR LOWER(path) LIKE '%.wma');
             INSERT OR REPLACE INTO settings (key, value)
               VALUES ('migration_media_type_fix', '1');",
        )?;
    }

    // Migration 3: image_thumbnail_reset — clear image thumbnails that are just the full-size path
    let img_migrated: bool = conn
        .query_row(
            "SELECT value FROM settings WHERE key = 'migration_image_thumbnail_reset'",
            [],
            |r| r.get::<_, String>(0),
        )
        .map(|v| v == "1")
        .unwrap_or(false);

    if !img_migrated {
        conn.execute_batch(
            "UPDATE videos SET thumbnail = NULL
               WHERE media_type = 'image' AND thumbnail = path;
             INSERT OR REPLACE INTO settings (key, value)
               VALUES ('migration_image_thumbnail_reset', '1');",
        )?;
    }

    // Migration 4: inbox_status_backfill — status が NULL かつ category_id が NULL のファイルを inbox に設定
    let inbox_migrated: bool = conn
        .query_row(
            "SELECT value FROM settings WHERE key = 'migration_inbox_status_backfill'",
            [],
            |r| r.get::<_, String>(0),
        )
        .map(|v| v == "1")
        .unwrap_or(false);

    if !inbox_migrated {
        conn.execute_batch(
            "UPDATE videos SET status = 'inbox'
               WHERE status IS NULL AND category_id IS NULL;
             INSERT OR REPLACE INTO settings (key, value)
               VALUES ('migration_inbox_status_backfill', '1');",
        )?;
    }

    // Migration 5: inbox_status_backfill_v2 — category_id の有無を問わず status が NULL のファイルを inbox に設定
    let inbox_migrated_v2: bool = conn
        .query_row(
            "SELECT value FROM settings WHERE key = 'migration_inbox_status_backfill_v2'",
            [],
            |r| r.get::<_, String>(0),
        )
        .map(|v| v == "1")
        .unwrap_or(false);

    if !inbox_migrated_v2 {
        conn.execute_batch(
            "UPDATE videos SET status = 'inbox'
               WHERE status IS NULL;
             INSERT OR REPLACE INTO settings (key, value)
               VALUES ('migration_inbox_status_backfill_v2', '1');",
        )?;
    }

    // Migration 6: playlist_items_cascade — ON DELETE CASCADE を既存テーブルに適用する
    let pi_migrated: bool = conn
        .query_row(
            "SELECT value FROM settings WHERE key = 'migration_playlist_items_cascade'",
            [],
            |r| r.get::<_, String>(0),
        )
        .map(|v| v == "1")
        .unwrap_or(false);

    if !pi_migrated {
        conn.execute_batch(
            "BEGIN;
             CREATE TABLE IF NOT EXISTS playlist_items_new (
               playlist_id INTEGER NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
               video_id    INTEGER NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
               position    INTEGER,
               PRIMARY KEY (playlist_id, video_id)
             );
             INSERT OR IGNORE INTO playlist_items_new
               SELECT playlist_id, video_id, position FROM playlist_items
               WHERE playlist_id IS NOT NULL AND video_id IS NOT NULL;
             DROP TABLE playlist_items;
             ALTER TABLE playlist_items_new RENAME TO playlist_items;
             INSERT OR REPLACE INTO settings (key, value)
               VALUES ('migration_playlist_items_cascade', '1');
             COMMIT;",
        )
        .unwrap_or_else(|e| {
            log::error!("[migration6] playlist_items_cascade 失敗: {e}");
            let _ = conn.execute_batch("ROLLBACK");
        });
    }

    // Migration 7: nfc_path_normalize — 既存の videos.path / watch_dirs.path を
    // Unicode 正規化形式 NFC に統一する。
    // macOS (APFS/HFS+) はファイル名を NFD 分解形で返すため、本修正以前に登録された
    // レコードには NFD のまま保存されたパスが混在している可能性がある。DB のパス
    // 比較はバイト単位のため、正規化形式が揃っていないとスキャン・ウォッチャー更新で
    // 既存レコードと一致せず「一部ファイルがスキャンできない」問題が起きる。
    let nfc_migrated: bool = conn
        .query_row(
            "SELECT value FROM settings WHERE key = 'migration_nfc_path_normalize'",
            [],
            |r| r.get::<_, String>(0),
        )
        .map(|v| v == "1")
        .unwrap_or(false);

    if !nfc_migrated {
        normalize_table_paths(conn, "videos")?;
        normalize_table_paths(conn, "watch_dirs")?;
        conn.execute(
            "INSERT OR REPLACE INTO settings (key, value) VALUES ('migration_nfc_path_normalize', '1')",
            [],
        )?;
    }

    Ok(())
}

/// `table` の `path` 列を Unicode 正規化形式 NFC に書き換える。
/// `path` には UNIQUE 制約があるため、正規化後の値がすでに別行として存在する
/// 場合は UPDATE がエラーになる (同一ファイルが NFC/NFD 両表記で二重登録されて
/// いた稀なケース)。その行は正規化をスキップしてログに残し、他の行の処理を継続する。
fn normalize_table_paths(conn: &Connection, table: &str) -> Result<()> {
    let rows: Vec<(i64, String)> = {
        let mut stmt = conn.prepare(&format!("SELECT rowid, path FROM {table}"))?;
        let x = stmt
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?
            .collect::<Result<_>>()?;
        x
    };

    for (rowid, path) in rows {
        let normalized = normalize_path_str(&path);
        if normalized == path {
            continue;
        }
        let update_sql = format!("UPDATE {table} SET path = ?1 WHERE rowid = ?2");
        if let Err(e) = conn.execute(&update_sql, rusqlite::params![normalized, rowid]) {
            log::warn!(
                "[migration7] {table}.rowid={rowid} の NFC 正規化をスキップしました \
                 (正規化後のパスが既存レコードと衝突しています): {e}"
            );
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;
    use crate::db::schema::init_db;

    fn setup() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        init_db(&conn).unwrap();
        conn
    }

    #[test]
    fn run_data_migrations_is_idempotent() {
        let conn = setup();
        assert!(run_data_migrations(&conn).is_ok());
        assert!(run_data_migrations(&conn).is_ok());
    }

    #[test]
    fn migration2_sets_image_media_type_for_jpg_path() {
        let conn = setup();
        conn.execute(
            "INSERT INTO videos (path, media_type) VALUES ('/tmp/photo.jpg', 'video')",
            [],
        )
        .unwrap();
        run_data_migrations(&conn).unwrap();
        let media_type: String = conn
            .query_row(
                "SELECT media_type FROM videos WHERE path = '/tmp/photo.jpg'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(media_type, "image");
    }

    #[test]
    fn migration4_sets_inbox_status_for_null_status() {
        let conn = setup();
        conn.execute(
            "INSERT INTO videos (path, status) VALUES ('/tmp/video.mp4', NULL)",
            [],
        )
        .unwrap();
        run_data_migrations(&conn).unwrap();
        let status: String = conn
            .query_row(
                "SELECT status FROM videos WHERE path = '/tmp/video.mp4'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(status, "inbox");
    }

    #[test]
    fn migration_flags_stored_as_one_in_settings() {
        let conn = setup();
        run_data_migrations(&conn).unwrap();
        let val: String = conn
            .query_row(
                "SELECT value FROM settings WHERE key = 'migration_inbox_status_backfill'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(val, "1");
    }

    #[test]
    fn migration6_playlist_items_cascade_is_idempotent() {
        let conn = setup();
        assert!(run_data_migrations(&conn).is_ok());
        assert!(run_data_migrations(&conn).is_ok());
        // Migration flag should be set
        let val: String = conn
            .query_row(
                "SELECT value FROM settings WHERE key = 'migration_playlist_items_cascade'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(val, "1");
    }

    #[test]
    fn migration6_playlist_items_cascade_preserves_existing_data() {
        let conn = setup();
        // Insert data before migration
        conn.execute("INSERT INTO playlists (name) VALUES ('Old List')", []).unwrap();
        let pl_id: i64 = conn.last_insert_rowid();
        conn.execute(
            "INSERT INTO videos (path, status) VALUES ('/tmp/old.mp4', 'active')",
            [],
        )
        .unwrap();
        let vid_id: i64 = conn.last_insert_rowid();
        conn.execute(
            "INSERT INTO playlist_items (playlist_id, video_id, position) VALUES (?1, ?2, 1)",
            [pl_id, vid_id],
        )
        .unwrap();

        run_data_migrations(&conn).unwrap();

        // Data should be preserved after migration
        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM playlist_items", [], |r| r.get(0))
            .unwrap();
        assert_eq!(count, 1);
    }

    // --- migration 7: nfc_path_normalize ---

    // NFC 合成形の "が" (U+304C) と NFD 分解形の "か" + 濁点結合文字 (U+304B U+3099)
    const NFC_GA: &str = "\u{304C}";
    const NFD_GA: &str = "\u{304B}\u{3099}";

    #[test]
    fn migration7_normalizes_nfd_video_path_to_nfc() {
        let conn = setup();
        let nfd_path = format!("/tmp/{NFD_GA}.mp4");
        conn.execute("INSERT INTO videos (path, status) VALUES (?1, 'active')", [&nfd_path])
            .unwrap();

        run_data_migrations(&conn).unwrap();

        let nfc_path = format!("/tmp/{NFC_GA}.mp4");
        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM videos WHERE path = ?1",
                [&nfc_path],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(count, 1, "path should be rewritten to its NFC form");
    }

    #[test]
    fn migration7_normalizes_nfd_watch_dir_path_to_nfc() {
        let conn = setup();
        let nfd_path = format!("/tmp/{NFD_GA}lib");
        conn.execute(
            "INSERT INTO watch_dirs (path, use_dir_as_category) VALUES (?1, 0)",
            [&nfd_path],
        )
        .unwrap();

        run_data_migrations(&conn).unwrap();

        let nfc_path = format!("/tmp/{NFC_GA}lib");
        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM watch_dirs WHERE path = ?1",
                [&nfc_path],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(count, 1, "watch_dirs.path should be rewritten to its NFC form");
    }

    #[test]
    fn migration7_leaves_already_nfc_path_untouched() {
        let conn = setup();
        conn.execute(
            "INSERT INTO videos (path, status) VALUES ('/tmp/video.mp4', 'active')",
            [],
        )
        .unwrap();

        run_data_migrations(&conn).unwrap();

        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM videos WHERE path = '/tmp/video.mp4'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(count, 1);
    }

    #[test]
    fn migration7_sets_flag_and_is_idempotent() {
        let conn = setup();
        assert!(run_data_migrations(&conn).is_ok());
        assert!(run_data_migrations(&conn).is_ok());
        let val: String = conn
            .query_row(
                "SELECT value FROM settings WHERE key = 'migration_nfc_path_normalize'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(val, "1");
    }

    #[test]
    fn migration7_skips_row_that_would_collide_after_normalization() {
        let conn = setup();
        // 同一ファイルが NFC 表記・NFD 表記の二重レコードとして存在する稀なケース
        let nfc_path = format!("/tmp/{NFC_GA}.mp4");
        let nfd_path = format!("/tmp/{NFD_GA}.mp4");
        conn.execute("INSERT INTO videos (path, status) VALUES (?1, 'active')", [&nfc_path])
            .unwrap();
        conn.execute("INSERT INTO videos (path, status) VALUES (?1, 'active')", [&nfd_path])
            .unwrap();

        // 衝突する行があってもマイグレーション全体は失敗しない
        assert!(run_data_migrations(&conn).is_ok());

        // 両方の行が残り、データは失われない (重複解消は本マイグレーションの対象外)
        let count: i64 = conn.query_row("SELECT COUNT(*) FROM videos", [], |r| r.get(0)).unwrap();
        assert_eq!(count, 2);
    }
}
