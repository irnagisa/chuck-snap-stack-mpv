use rusqlite::{Connection, Result};

pub fn init_db(conn: &Connection) -> Result<()> {
    conn.execute_batch("PRAGMA journal_mode=WAL")?;
    conn.execute_batch("PRAGMA busy_timeout=5000")?;

    conn.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS settings (
          key   TEXT PRIMARY KEY,
          value TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS tag_categories (
          id         INTEGER PRIMARY KEY AUTOINCREMENT,
          name       TEXT NOT NULL UNIQUE,
          created_at TEXT DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS categories (
          id         INTEGER PRIMARY KEY AUTOINCREMENT,
          name       TEXT NOT NULL,
          color      TEXT NOT NULL DEFAULT '#6366f1',
          parent_id  INTEGER REFERENCES categories(id),
          icon       TEXT DEFAULT NULL,
          created_at TEXT DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS tags (
          id              INTEGER PRIMARY KEY AUTOINCREMENT,
          name            TEXT NOT NULL UNIQUE,
          color           TEXT NOT NULL DEFAULT '#6366f1',
          created_at      TEXT DEFAULT CURRENT_TIMESTAMP,
          tag_category_id INTEGER REFERENCES tag_categories(id),
          icon            TEXT DEFAULT NULL
        );

        CREATE TABLE IF NOT EXISTS videos (
          id          INTEGER PRIMARY KEY AUTOINCREMENT,
          path        TEXT NOT NULL UNIQUE,
          title       TEXT,
          duration    REAL,
          thumbnail   TEXT,
          watched_at  TEXT,
          progress    REAL DEFAULT 0,
          rating      INTEGER DEFAULT 0,
          created_at  TEXT DEFAULT CURRENT_TIMESTAMP,
          category_id INTEGER REFERENCES categories(id),
          has_audio   INTEGER,
          watch_count INTEGER DEFAULT 0,
          media_type  TEXT DEFAULT 'video',
          source_url  TEXT,
          status      TEXT,
          source_type TEXT
        );

        CREATE TABLE IF NOT EXISTS playlists (
          id         INTEGER PRIMARY KEY AUTOINCREMENT,
          name       TEXT NOT NULL,
          created_at TEXT DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS video_tags (
          video_id INTEGER NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
          tag_id   INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
          PRIMARY KEY (video_id, tag_id)
        );

        CREATE TABLE IF NOT EXISTS playlist_items (
          playlist_id INTEGER REFERENCES playlists(id),
          video_id    INTEGER REFERENCES videos(id),
          position    INTEGER,
          PRIMARY KEY (playlist_id, video_id)
        );

        CREATE TABLE IF NOT EXISTS watch_dirs (
          path                TEXT PRIMARY KEY,
          created_at          TEXT DEFAULT CURRENT_TIMESTAMP,
          use_dir_as_category INTEGER DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS smart_playlists (
          id          INTEGER PRIMARY KEY AUTOINCREMENT,
          name        TEXT NOT NULL,
          filter_json TEXT NOT NULL,
          created_at  TEXT DEFAULT CURRENT_TIMESTAMP
        );

        CREATE INDEX IF NOT EXISTS idx_videos_created_at ON videos(created_at);
        CREATE INDEX IF NOT EXISTS idx_videos_rating ON videos(rating);
        CREATE INDEX IF NOT EXISTS idx_videos_duration ON videos(duration);
        CREATE INDEX IF NOT EXISTS idx_videos_category_id ON videos(category_id);
        CREATE INDEX IF NOT EXISTS idx_videos_watched_at ON videos(watched_at);
        CREATE INDEX IF NOT EXISTS idx_video_tags_tag_id ON video_tags(tag_id);
        CREATE INDEX IF NOT EXISTS idx_video_tags_video_id ON video_tags(video_id);
        CREATE UNIQUE INDEX IF NOT EXISTS idx_categories_unique_root
          ON categories(name) WHERE parent_id IS NULL;
        CREATE UNIQUE INDEX IF NOT EXISTS idx_categories_unique_child
          ON categories(name, parent_id) WHERE parent_id IS NOT NULL;
        ",
    )?;

    // Add columns that may be missing in databases created before these were introduced
    let alter_stmts = [
        "ALTER TABLE videos ADD COLUMN category_id INTEGER REFERENCES categories(id)",
        "ALTER TABLE videos ADD COLUMN has_audio INTEGER",
        "ALTER TABLE videos ADD COLUMN watch_count INTEGER DEFAULT 0",
        "ALTER TABLE videos ADD COLUMN media_type TEXT DEFAULT 'video'",
        "ALTER TABLE videos ADD COLUMN source_url TEXT",
        "ALTER TABLE videos ADD COLUMN status TEXT",
        "ALTER TABLE videos ADD COLUMN source_type TEXT",
        "ALTER TABLE tags ADD COLUMN tag_category_id INTEGER REFERENCES tag_categories(id)",
        "ALTER TABLE tags ADD COLUMN icon TEXT DEFAULT NULL",
        "ALTER TABLE categories ADD COLUMN parent_id INTEGER REFERENCES categories(id)",
        "ALTER TABLE categories ADD COLUMN icon TEXT DEFAULT NULL",
        "ALTER TABLE watch_dirs ADD COLUMN use_dir_as_category INTEGER DEFAULT 0",
    ];
    for stmt in &alter_stmts {
        let _ = conn.execute_batch(stmt); // ignore "duplicate column" errors
    }

    Ok(())
}
