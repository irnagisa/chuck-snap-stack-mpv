//! 古い版の DB を今のスキーマ (`schema::TABLES`) に書き換える。
//!
//! 版は `PRAGMA user_version` で持つ。0 は「版を付ける前の DB」(空の新規 DB も 0)。
//! スキーマを変えるときは `SCHEMA_VERSION` を上げ、ここに前の版からの書き換えを足す。

use rusqlite::{Connection, Result};

use super::schema::user_version;

/// 必要な書き換えをする。新しい DB では何もしない (テーブルは `init_db` が作る)。
pub fn migrate(conn: &Connection) -> Result<()> {
    let version = user_version(conn)?;
    if !table_exists(conn, "videos")? {
        return Ok(());
    }
    if version == 0 {
        upgrade_unversioned(conn)?;
    }
    // v1 → v2: media_transcode_discarded を足しただけ (テーブルは `init_db` の create_tables が作る)
    if version < 3 {
        inbox_to_new(conn)?;
    }
    Ok(())
}

/// v2 → v3: `status = 'inbox'` の意味を「未整理 (カテゴリ・評価・タグが揃っていない)」から
/// 「新着 (まだ詳細を開いても再生してもいない)」に変えた。一度でも見たものは新着から外す。
fn inbox_to_new(conn: &Connection) -> Result<()> {
    conn.execute(
        "UPDATE videos SET status = 'active'
         WHERE status = 'inbox'
           AND (last_viewed_at IS NOT NULL OR watched_at IS NOT NULL OR watch_count > 0)",
        [],
    )?;
    Ok(())
}

fn table_exists(conn: &Connection, name: &str) -> Result<bool> {
    conn.query_row(
        "SELECT EXISTS (SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?1)",
        [name],
        |r| r.get(0),
    )
}

/// 版を付ける前の DB (ALTER TABLE で列を足していった形) を v1 のスキーマに作り直す。
///
/// 変わるところ:
/// - `videos.status` の NULL (整理済み) を `'active'` に、`media_type` などの NULL を既定値にする
/// - NOT NULL・CHECK・`category_id` の ON DELETE SET NULL を付ける
/// - 解析結果のキャッシュ (pHash・無音の判定・抜き出しのハッシュ) を `videos` から別テーブルに移す。
///   使われていなかった AI 提案の列 (`ai_*`) は捨てる
/// - 参照先の無い行 (消えた動画のタグ付けなど) を落とす
/// - settings に残っていた古いマイグレーションの印 (`migration_*`) を消す
///
/// SQLite では制約を後から足せないので、テーブルを `legacy_*` に退けて作り直し、中身を移す。
fn upgrade_unversioned(conn: &Connection) -> Result<()> {
    const TABLES: [&str; 12] = [
        "settings",
        "tag_categories",
        "categories",
        "tags",
        "videos",
        "media_groups",
        "media_probe",
        "video_tags",
        "playlists",
        "playlist_items",
        "smart_playlists",
        "watch_dirs",
    ];

    // 作り直しの途中は参照先が一時的に無くなるので外部キーを切る (トランザクションの外でしか切り替えられない)
    // legacy_alter_table: 名前を変えたテーブルを指す外部キーを書き換えさせない
    // (書き換えると、先に作ったキャッシュのテーブルが legacy_videos を指したままになる)
    conn.execute_batch("PRAGMA foreign_keys = OFF; PRAGMA legacy_alter_table = ON;")?;
    let result = (|| {
        let tx = conn.unchecked_transaction()?;
        // 後から足されたテーブル (media_groups など) が無い DB でも下の移し替えを同じ形で書けるように、
        // 無いテーブルを先に作っておく
        super::schema::create_tables(&tx)?;
        // 古い DB には後から足された列が無いことがある (足す前の版で止まっていた DB)。
        // 移し替えの SQL が同じ形で書けるように、無い列を NULL のまま足しておく
        for (table, column, ty) in LEGACY_COLUMNS {
            if !column_exists(&tx, table, column)? {
                tx.execute_batch(&format!("ALTER TABLE {table} ADD COLUMN {column} {ty}"))?;
            }
        }
        for t in TABLES {
            tx.execute_batch(&format!("ALTER TABLE {t} RENAME TO legacy_{t}"))?;
        }
        // インデックスは名前ごと legacy_* に付いていったので、消してから作り直す
        let indexes: Vec<String> = {
            let mut stmt = tx.prepare(
                "SELECT name FROM sqlite_master
                 WHERE type = 'index' AND tbl_name LIKE 'legacy\\_%' ESCAPE '\\' AND sql IS NOT NULL",
            )?;
            let rows = stmt.query_map([], |r| r.get(0))?;
            rows.collect::<Result<_>>()?
        };
        for idx in indexes {
            tx.execute_batch(&format!("DROP INDEX \"{idx}\""))?;
        }

        super::schema::create_tables(&tx)?;
        tx.execute_batch(COPY_LEGACY)?;
        for t in TABLES {
            tx.execute_batch(&format!("DROP TABLE legacy_{t}"))?;
        }
        tx.commit()
    })();
    conn.execute_batch("PRAGMA legacy_alter_table = OFF; PRAGMA foreign_keys = ON;")?;
    result
}

/// 版を付ける前に ALTER TABLE で足していった列 (`COPY_LEGACY` が読むもの)
const LEGACY_COLUMNS: [(&str, &str, &str); 23] = [
    ("videos", "category_id", "INTEGER"),
    ("videos", "has_audio", "INTEGER"),
    ("videos", "watch_count", "INTEGER"),
    ("videos", "media_type", "TEXT"),
    ("videos", "source_url", "TEXT"),
    ("videos", "status", "TEXT"),
    ("videos", "source_type", "TEXT"),
    ("videos", "phash", "TEXT"),
    ("videos", "last_viewed_at", "TEXT"),
    ("videos", "file_size", "INTEGER"),
    ("videos", "audio_silence", "TEXT"),
    ("videos", "silent_audio_streams", "TEXT"),
    ("videos", "silent_audio_bytes", "INTEGER"),
    ("videos", "audio_silence_sampled", "INTEGER"),
    ("videos", "content_digest", "TEXT"),
    ("videos", "content_digest_key", "TEXT"),
    ("videos", "group_id", "INTEGER"),
    ("videos", "group_position", "INTEGER"),
    ("tags", "tag_category_id", "INTEGER"),
    ("tags", "icon", "TEXT"),
    ("categories", "parent_id", "INTEGER"),
    ("categories", "icon", "TEXT"),
    ("watch_dirs", "use_dir_as_category", "INTEGER"),
];

fn column_exists(conn: &Connection, table: &str, column: &str) -> Result<bool> {
    conn.query_row(
        "SELECT EXISTS (SELECT 1 FROM pragma_table_info(?1) WHERE name = ?2)",
        [table, column],
        |r| r.get(0),
    )
}

/// `legacy_*` から新しいテーブルへ移す。参照先の無い行は落とすか NULL にする。
const COPY_LEGACY: &str = r"
INSERT INTO settings (key, value)
  SELECT key, value FROM legacy_settings WHERE key NOT LIKE 'migration\_%' ESCAPE '\';

INSERT INTO tag_categories (id, name, created_at)
  SELECT id, name, COALESCE(created_at, CURRENT_TIMESTAMP) FROM legacy_tag_categories;

INSERT INTO categories (id, name, color, parent_id, icon, created_at)
  SELECT id, name, COALESCE(color, '#6366f1'),
         (SELECT p.id FROM legacy_categories p WHERE p.id = c.parent_id),
         icon, COALESCE(created_at, CURRENT_TIMESTAMP)
  FROM legacy_categories c;

INSERT INTO tags (id, name, color, created_at, tag_category_id, icon)
  SELECT id, name, COALESCE(color, '#6366f1'), COALESCE(created_at, CURRENT_TIMESTAMP),
         (SELECT tc.id FROM tag_categories tc WHERE tc.id = t.tag_category_id), icon
  FROM legacy_tags t;

INSERT INTO media_groups (id, name, kind, cover_video_id, created_at)
  SELECT id, name, CASE kind WHEN 'series' THEN 'series' ELSE 'variants' END,
         (SELECT v.id FROM legacy_videos v WHERE v.id = g.cover_video_id),
         COALESCE(created_at, CURRENT_TIMESTAMP)
  FROM legacy_media_groups g;

INSERT INTO videos (
    id, path, title, duration, thumbnail, watched_at, progress, rating, created_at,
    category_id, has_audio, watch_count, media_type, source_url, status, source_type,
    last_viewed_at, file_size, group_id, group_position)
  SELECT
    id, path, title, duration, thumbnail, watched_at,
    COALESCE(progress, 0), COALESCE(rating, 0), COALESCE(created_at, CURRENT_TIMESTAMP),
    (SELECT c.id FROM categories c WHERE c.id = v.category_id),
    has_audio, COALESCE(watch_count, 0),
    CASE WHEN media_type IN ('video', 'audio', 'image', 'link') THEN media_type ELSE 'video' END,
    source_url,
    CASE WHEN status IN ('inbox', 'missing') THEN status ELSE 'active' END,
    source_type, last_viewed_at, file_size,
    (SELECT g.id FROM media_groups g WHERE g.id = v.group_id), group_position
  FROM legacy_videos v;

INSERT INTO media_phash (video_id, phash)
  SELECT id, phash FROM legacy_videos WHERE phash IS NOT NULL AND phash != '';

INSERT INTO media_silent_audio (video_id, silence, streams, bytes, sampled)
  SELECT id, audio_silence, silent_audio_streams, silent_audio_bytes, COALESCE(audio_silence_sampled, 0)
  FROM legacy_videos WHERE audio_silence IN ('none', 'partial', 'all');

INSERT INTO media_content_digest (video_id, digest_key, digest)
  SELECT id, content_digest_key, content_digest FROM legacy_videos
  WHERE content_digest IS NOT NULL AND content_digest_key IS NOT NULL;

INSERT INTO media_probe (video_id, probe_key, video_codec, width, height, fps, video_bitrate, probed_at)
  SELECT video_id, probe_key, video_codec, width, height, fps, video_bitrate,
         COALESCE(probed_at, CURRENT_TIMESTAMP)
  FROM legacy_media_probe WHERE video_id IN (SELECT id FROM videos);

INSERT INTO video_tags (video_id, tag_id)
  SELECT video_id, tag_id FROM legacy_video_tags
  WHERE video_id IN (SELECT id FROM videos) AND tag_id IN (SELECT id FROM tags);

INSERT INTO playlists (id, name, created_at)
  SELECT id, name, COALESCE(created_at, CURRENT_TIMESTAMP) FROM legacy_playlists;

INSERT INTO playlist_items (playlist_id, video_id, position)
  SELECT playlist_id, video_id, position FROM legacy_playlist_items
  WHERE playlist_id IN (SELECT id FROM playlists) AND video_id IN (SELECT id FROM videos);

INSERT INTO smart_playlists (id, name, filter_json, created_at)
  SELECT id, name, filter_json, COALESCE(created_at, CURRENT_TIMESTAMP) FROM legacy_smart_playlists;

INSERT INTO watch_dirs (path, created_at, use_dir_as_category)
  SELECT path, COALESCE(created_at, CURRENT_TIMESTAMP), COALESCE(use_dir_as_category, 0)
  FROM legacy_watch_dirs;
";

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::schema::{init_db, SCHEMA_VERSION};

    /// 版を付ける前のスキーマ (列を ALTER TABLE で足していった最後の形)
    const UNVERSIONED_SCHEMA: &str = "
        CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
        CREATE TABLE tag_categories (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE,
          created_at TEXT DEFAULT CURRENT_TIMESTAMP);
        CREATE TABLE categories (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL,
          color TEXT NOT NULL DEFAULT '#6366f1', parent_id INTEGER REFERENCES categories(id),
          icon TEXT DEFAULT NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
        CREATE TABLE tags (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE,
          color TEXT NOT NULL DEFAULT '#6366f1', created_at TEXT DEFAULT CURRENT_TIMESTAMP,
          tag_category_id INTEGER REFERENCES tag_categories(id), icon TEXT DEFAULT NULL);
        CREATE TABLE videos (id INTEGER PRIMARY KEY AUTOINCREMENT, path TEXT NOT NULL UNIQUE,
          title TEXT, duration REAL, thumbnail TEXT, watched_at TEXT, progress REAL DEFAULT 0,
          rating INTEGER DEFAULT 0, created_at TEXT DEFAULT CURRENT_TIMESTAMP,
          category_id INTEGER REFERENCES categories(id), has_audio INTEGER,
          watch_count INTEGER DEFAULT 0, media_type TEXT DEFAULT 'video', source_url TEXT,
          status TEXT, source_type TEXT, ai_tag_suggestions TEXT, ai_new_suggestions TEXT,
          ai_analyzed_at TEXT, phash TEXT, last_viewed_at TEXT, file_size INTEGER,
          audio_silence TEXT, silent_audio_streams TEXT, silent_audio_bytes INTEGER,
          audio_silence_sampled INTEGER, content_digest TEXT, content_digest_key TEXT,
          group_id INTEGER REFERENCES media_groups(id) ON DELETE SET NULL, group_position INTEGER);
        CREATE TABLE media_groups (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL,
          kind TEXT NOT NULL DEFAULT 'variants',
          cover_video_id INTEGER REFERENCES videos(id) ON DELETE SET NULL,
          created_at TEXT DEFAULT CURRENT_TIMESTAMP);
        CREATE TABLE media_probe (video_id INTEGER PRIMARY KEY REFERENCES videos(id) ON DELETE CASCADE,
          probe_key TEXT NOT NULL, video_codec TEXT, width INTEGER, height INTEGER, fps REAL,
          video_bitrate INTEGER, probed_at TEXT DEFAULT CURRENT_TIMESTAMP);
        CREATE TABLE playlists (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL,
          created_at TEXT DEFAULT CURRENT_TIMESTAMP);
        CREATE TABLE video_tags (video_id INTEGER NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
          tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE, PRIMARY KEY (video_id, tag_id));
        CREATE TABLE playlist_items (playlist_id INTEGER NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
          video_id INTEGER NOT NULL REFERENCES videos(id) ON DELETE CASCADE, position INTEGER,
          PRIMARY KEY (playlist_id, video_id));
        CREATE TABLE watch_dirs (path TEXT PRIMARY KEY, created_at TEXT DEFAULT CURRENT_TIMESTAMP,
          use_dir_as_category INTEGER DEFAULT 0);
        CREATE TABLE smart_playlists (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL,
          filter_json TEXT NOT NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
        CREATE INDEX idx_videos_status ON videos(status);
        CREATE INDEX idx_video_tags_video_id ON video_tags(video_id);
    ";

    fn unversioned_db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(UNVERSIONED_SCHEMA).unwrap();
        // 参照先の無い行を入れるので外部キーを切る (古い DB には実際にそういう行がありうる)
        conn.execute_batch(
            "PRAGMA foreign_keys = OFF;
             INSERT INTO settings VALUES ('migration_media_type_fix', '1'), ('theme', 'dark');
             INSERT INTO categories (id, name) VALUES (1, 'Anime');
             INSERT INTO tags (id, name) VALUES (1, 'cat');
             INSERT INTO videos (id, path, status, category_id, media_type, rating,
                                 phash, audio_silence, silent_audio_streams, audio_silence_sampled,
                                 content_digest, content_digest_key, ai_tag_suggestions)
               VALUES (1, '/m/a.mp4', NULL, 1, 'video', NULL,
                       '123', 'partial', '2', NULL, 'ab', '1:1', '[]');
             INSERT INTO videos (id, path, status, category_id, media_type, rating)
               VALUES
                      (2, '/m/b.mp4', 'inbox', NULL, NULL, 3),
                      (3, '/m/c.mp4', 'missing', 99, 'video', 0);
             INSERT INTO video_tags VALUES (1, 1), (42, 1);
             INSERT INTO media_probe (video_id, probe_key, video_codec) VALUES (1, '1:1', 'h264');
             INSERT INTO playlists (id, name) VALUES (1, 'p');
             INSERT INTO playlist_items VALUES (1, 1, 0), (1, 42, 1);
             INSERT INTO watch_dirs (path, use_dir_as_category) VALUES ('/m', NULL);",
        )
        .unwrap();
        conn
    }

    fn count(conn: &Connection, sql: &str) -> i64 {
        conn.query_row(sql, [], |r| r.get(0)).unwrap()
    }

    #[test]
    fn new_db_gets_current_version() {
        let conn = Connection::open_in_memory().unwrap();
        init_db(&conn).unwrap();
        assert_eq!(user_version(&conn).unwrap(), SCHEMA_VERSION);
        // 2 回目も何もしない
        init_db(&conn).unwrap();
        assert_eq!(user_version(&conn).unwrap(), SCHEMA_VERSION);
    }

    #[test]
    fn v2_inbox_items_already_seen_are_no_longer_new() {
        let conn = Connection::open_in_memory().unwrap();
        init_db(&conn).unwrap();
        conn.execute_batch(
            "INSERT INTO videos (id, path, status) VALUES (1, '/never', 'inbox');
             INSERT INTO videos (id, path, status, last_viewed_at) VALUES (2, '/viewed', 'inbox', '2026-01-01');
             INSERT INTO videos (id, path, status, watch_count) VALUES (3, '/played', 'inbox', 1);
             INSERT INTO videos (id, path, status, watched_at) VALUES (4, '/watched', 'inbox', '2026-01-01');
             INSERT INTO videos (id, path, status, last_viewed_at) VALUES (5, '/gone', 'missing', '2026-01-01');
             PRAGMA user_version = 2;",
        )
        .unwrap();
        init_db(&conn).unwrap();
        let status = |id: i64| -> String {
            conn.query_row("SELECT status FROM videos WHERE id = ?1", [id], |r| r.get(0)).unwrap()
        };
        assert_eq!(status(1), "inbox");
        assert_eq!(status(2), "active");
        assert_eq!(status(3), "active");
        assert_eq!(status(4), "active");
        assert_eq!(status(5), "missing");
    }

    #[test]
    fn unversioned_db_is_rebuilt_with_values_normalized() {
        let conn = unversioned_db();
        init_db(&conn).unwrap();
        assert_eq!(user_version(&conn).unwrap(), SCHEMA_VERSION);

        let row = |id: i64| -> (String, String, i64, Option<i64>) {
            conn.query_row(
                "SELECT status, media_type, rating, category_id FROM videos WHERE id = ?1",
                [id],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
            )
            .unwrap()
        };
        assert_eq!(row(1), ("active".into(), "video".into(), 0, Some(1)));
        assert_eq!(row(2), ("inbox".into(), "video".into(), 3, None));
        // 無いカテゴリへの参照は外す
        assert_eq!(row(3), ("missing".into(), "video".into(), 0, None));

        // 消えた動画への参照は落とし、残りは引き継ぐ
        assert_eq!(count(&conn, "SELECT COUNT(*) FROM video_tags"), 1);
        assert_eq!(count(&conn, "SELECT COUNT(*) FROM playlist_items"), 1);
        assert_eq!(count(&conn, "SELECT COUNT(*) FROM media_probe"), 1);
        assert_eq!(count(&conn, "SELECT COUNT(*) FROM media_phash WHERE video_id = 1 AND phash = '123'"), 1);
        assert_eq!(
            count(&conn, "SELECT COUNT(*) FROM media_silent_audio WHERE video_id = 1 AND silence = 'partial' AND sampled = 0"),
            1
        );
        assert_eq!(count(&conn, "SELECT COUNT(*) FROM media_content_digest WHERE video_id = 1"), 1);
        assert_eq!(count(&conn, "SELECT COUNT(*) FROM pragma_table_info('videos') WHERE name LIKE 'ai\\_%' ESCAPE '\\' OR name IN ('phash', 'audio_silence', 'content_digest')"), 0);
        assert_eq!(count(&conn, "SELECT use_dir_as_category FROM watch_dirs"), 0);

        // 古いマイグレーションの印だけ消す
        assert_eq!(count(&conn, "SELECT COUNT(*) FROM settings WHERE key LIKE 'migration%'"), 0);
        assert_eq!(count(&conn, "SELECT COUNT(*) FROM settings WHERE key = 'theme'"), 1);

        // 退けたテーブルは残らず、インデックスは今のスキーマのものになる
        assert_eq!(count(&conn, "SELECT COUNT(*) FROM sqlite_master WHERE name LIKE 'legacy%'"), 0);
        assert_eq!(count(&conn, "SELECT COUNT(*) FROM sqlite_master WHERE name = 'idx_videos_status'"), 1);
        assert_eq!(count(&conn, "SELECT COUNT(*) FROM sqlite_master WHERE name = 'idx_video_tags_video_id'"), 0);
        assert_eq!(count(&conn, "PRAGMA foreign_keys"), 1);
        assert_eq!(count(&conn, "SELECT COUNT(*) FROM pragma_foreign_key_check"), 0);
    }

    #[test]
    fn unversioned_db_missing_later_columns_is_rebuilt() {
        let conn = unversioned_db();
        // 無音の簡易判定・抜き出しのハッシュの列を足す前の版で止まっていた DB
        // (DROP COLUMN は外部キーを持たない列なら使える)
        conn.execute_batch(
            "ALTER TABLE videos DROP COLUMN audio_silence_sampled;
             ALTER TABLE videos DROP COLUMN content_digest;
             ALTER TABLE videos DROP COLUMN content_digest_key;
             DROP TABLE media_probe;",
        )
        .unwrap();
        init_db(&conn).unwrap();
        assert_eq!(user_version(&conn).unwrap(), SCHEMA_VERSION);
        assert_eq!(count(&conn, "SELECT COUNT(*) FROM videos"), 3);
        assert_eq!(count(&conn, "SELECT COUNT(*) FROM media_silent_audio WHERE video_id = 1 AND sampled = 0"), 1);
        assert_eq!(count(&conn, "SELECT COUNT(*) FROM media_content_digest"), 0);
        assert_eq!(count(&conn, "SELECT COUNT(*) FROM sqlite_master WHERE name LIKE 'legacy%'"), 0);
    }

    #[test]
    fn rebuilt_db_enforces_new_constraints() {
        let conn = unversioned_db();
        init_db(&conn).unwrap();
        assert!(conn.execute("INSERT INTO videos (path, status) VALUES ('/x', NULL)", []).is_err());
        assert!(conn.execute("INSERT INTO videos (path, media_type) VALUES ('/x', 'doc')", []).is_err());
        // 動画を消すとタグ付け・プレイリスト・映像の情報も消える
        conn.execute("DELETE FROM videos WHERE id = 1", []).unwrap();
        assert_eq!(count(&conn, "SELECT COUNT(*) FROM video_tags"), 0);
        assert_eq!(count(&conn, "SELECT COUNT(*) FROM playlist_items"), 0);
        assert_eq!(count(&conn, "SELECT COUNT(*) FROM media_probe"), 0);
        assert_eq!(count(&conn, "SELECT COUNT(*) FROM media_phash"), 0);
        assert_eq!(count(&conn, "SELECT COUNT(*) FROM media_silent_audio"), 0);
        assert_eq!(count(&conn, "SELECT COUNT(*) FROM media_content_digest"), 0);
    }

    #[test]
    fn deleting_category_detaches_videos() {
        let conn = Connection::open_in_memory().unwrap();
        init_db(&conn).unwrap();
        conn.execute_batch(
            "INSERT INTO categories (id, name) VALUES (1, 'c');
             INSERT INTO videos (path, category_id) VALUES ('/a', 1);
             DELETE FROM categories WHERE id = 1;",
        )
        .unwrap();
        assert_eq!(count(&conn, "SELECT COUNT(*) FROM videos WHERE category_id IS NULL"), 1);
    }
}
