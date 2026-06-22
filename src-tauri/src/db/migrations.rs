use rusqlite::{Connection, Result};

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

    Ok(())
}
