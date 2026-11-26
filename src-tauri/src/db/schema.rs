use rusqlite::{Connection, Result};

use super::migrations;

/// スキーマの版。`PRAGMA user_version` に入れる。
/// 列やテーブルを変えるときは `TABLES` / `INDEXES` を直し、版を 1 つ上げて `migrations::migrate` に
/// 前の版からの書き換えを足す。
pub const SCHEMA_VERSION: i64 = 1;

/// 今の版のテーブル。新しく作る DB はこれと `INDEXES` だけで出来上がる。
///
/// - `videos.status`: `'inbox'` (未整理) / `'active'` (整理済み) / `'missing'` (ファイルが見つからない)
/// - `videos.media_type`: `'video'` / `'audio'` / `'image'` / `'link'`
/// - 計算し直せる解析結果のキャッシュは `videos` に列を足さず、`media_probe` のように
///   video_id を主キーにした別テーブルにする
const TABLES: &str = "
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tag_categories (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 階層あり。同じ親の下でだけ名前が重ならないようにする (下の部分 UNIQUE インデックス)
CREATE TABLE IF NOT EXISTS categories (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL,
  color      TEXT NOT NULL DEFAULT '#6366f1',
  parent_id  INTEGER REFERENCES categories(id),
  icon       TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS tags (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  name            TEXT NOT NULL UNIQUE,
  color           TEXT NOT NULL DEFAULT '#6366f1',
  created_at      TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  tag_category_id INTEGER REFERENCES tag_categories(id),
  icon            TEXT
);

CREATE TABLE IF NOT EXISTS videos (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  path                  TEXT NOT NULL UNIQUE,
  title                 TEXT,
  duration              REAL,
  thumbnail             TEXT,
  watched_at            TEXT,
  progress              REAL NOT NULL DEFAULT 0,      -- 再生位置 (秒)
  rating                INTEGER NOT NULL DEFAULT 0,
  created_at            TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  category_id           INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  has_audio             INTEGER,
  watch_count           INTEGER NOT NULL DEFAULT 0,
  media_type            TEXT NOT NULL DEFAULT 'video'
                          CHECK (media_type IN ('video', 'audio', 'image', 'link')),
  source_url            TEXT,
  status                TEXT NOT NULL DEFAULT 'inbox'
                          CHECK (status IN ('inbox', 'active', 'missing')),
  source_type           TEXT,                          -- 'import' | 'download' | 'dragdrop' | 'watcher' | 'link'
  last_viewed_at        TEXT,
  file_size             INTEGER,                       -- bytes (ソート用キャッシュ)
  group_id              INTEGER REFERENCES media_groups(id) ON DELETE SET NULL,
  group_position        INTEGER                        -- グループ内の並び順
);

-- 関連ファイルのまとまり (シリーズ・同じ内容の別パターン)。videos.group_id から参照する
CREATE TABLE IF NOT EXISTS media_groups (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  name           TEXT NOT NULL,
  kind           TEXT NOT NULL DEFAULT 'variants' CHECK (kind IN ('variants', 'series')),
  cover_video_id INTEGER REFERENCES videos(id) ON DELETE SET NULL,  -- NULL = 並び順で最初
  created_at     TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ↓ 計算し直せる解析結果のキャッシュ。行が無い = まだ調べていない

-- 知覚的ハッシュ (commands/phash.rs)。似た見た目の検出に使う。u64 の 10 進文字列
CREATE TABLE IF NOT EXISTS media_phash (
  video_id INTEGER PRIMARY KEY REFERENCES videos(id) ON DELETE CASCADE,
  phash    TEXT NOT NULL
);

-- 無音の音声トラック (commands/silent_audio.rs)
CREATE TABLE IF NOT EXISTS media_silent_audio (
  video_id INTEGER PRIMARY KEY REFERENCES videos(id) ON DELETE CASCADE,
  silence  TEXT NOT NULL CHECK (silence IN ('none', 'partial', 'all')),
  streams  TEXT,                                       -- 無音のトラックの番号 (ffprobe の index、カンマ区切り)
  bytes    INTEGER,                                    -- 無音のトラックを外すと空く容量の見込み
  sampled  INTEGER NOT NULL DEFAULT 0                  -- 1 = 数か所を読んだだけの簡易判定
);

-- 重複の比較用の抜き出しのハッシュ (commands/storage_duplicates.rs)。
-- digest_key は計算したときの「サイズ:更新日時(ns)」で、変わったら計算し直す
CREATE TABLE IF NOT EXISTS media_content_digest (
  video_id   INTEGER PRIMARY KEY REFERENCES videos(id) ON DELETE CASCADE,
  digest_key TEXT NOT NULL,
  digest     TEXT NOT NULL                             -- hex
);

-- ffprobe で調べた映像の情報 (commands/media_probe.rs)。整理画面の変換の効果の見積もりに使う。
-- probe_key は調べたときの「サイズ:更新日時(ns)」で、サイズが videos.file_size と食い違えば調べ直す
CREATE TABLE IF NOT EXISTS media_probe (
  video_id      INTEGER PRIMARY KEY REFERENCES videos(id) ON DELETE CASCADE,
  probe_key     TEXT NOT NULL,
  video_codec   TEXT,
  width         INTEGER,
  height        INTEGER,
  fps           REAL,
  video_bitrate INTEGER,                               -- 映像だけ (bps)
  probed_at     TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS video_tags (
  video_id INTEGER NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  tag_id   INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (video_id, tag_id)
);

CREATE TABLE IF NOT EXISTS playlists (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS playlist_items (
  playlist_id INTEGER NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
  video_id    INTEGER NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  position    INTEGER,
  PRIMARY KEY (playlist_id, video_id)
);

CREATE TABLE IF NOT EXISTS smart_playlists (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  filter_json TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS watch_dirs (
  path                TEXT PRIMARY KEY,
  created_at          TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  use_dir_as_category INTEGER NOT NULL DEFAULT 0
);
";

const INDEXES: &str = "
CREATE INDEX IF NOT EXISTS idx_videos_created_at     ON videos(created_at);
CREATE INDEX IF NOT EXISTS idx_videos_rating         ON videos(rating);
CREATE INDEX IF NOT EXISTS idx_videos_duration       ON videos(duration);
CREATE INDEX IF NOT EXISTS idx_videos_category_id    ON videos(category_id);
CREATE INDEX IF NOT EXISTS idx_videos_watched_at     ON videos(watched_at);
CREATE INDEX IF NOT EXISTS idx_videos_last_viewed_at ON videos(last_viewed_at);
CREATE INDEX IF NOT EXISTS idx_videos_status         ON videos(status);
CREATE INDEX IF NOT EXISTS idx_videos_media_type     ON videos(media_type);
CREATE INDEX IF NOT EXISTS idx_videos_file_size      ON videos(file_size);
CREATE INDEX IF NOT EXISTS idx_videos_group_id       ON videos(group_id);
CREATE INDEX IF NOT EXISTS idx_video_tags_tag_id     ON video_tags(tag_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_categories_unique_root
  ON categories(name) WHERE parent_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_categories_unique_child
  ON categories(name, parent_id) WHERE parent_id IS NOT NULL;
";

/// 接続ごとの設定。writer / reader の両方で呼ぶ。
pub fn configure(conn: &Connection) -> Result<()> {
    conn.execute_batch(
        "PRAGMA foreign_keys = ON;
         PRAGMA journal_mode = WAL;
         PRAGMA busy_timeout = 5000;",
    )
}

/// 接続の設定、古い版からの書き換え、スキーマの作成をして、版を `SCHEMA_VERSION` にする。
pub fn init_db(conn: &Connection) -> Result<()> {
    configure(conn)?;
    migrations::migrate(conn)?;
    create_tables(conn)?;
    conn.execute_batch(INDEXES)?;
    conn.pragma_update(None, "user_version", SCHEMA_VERSION)?;
    Ok(())
}

/// 今の版のテーブルを (無ければ) 作る。インデックスは作らない。
pub(crate) fn create_tables(conn: &Connection) -> Result<()> {
    conn.execute_batch(TABLES)
}

pub(crate) fn user_version(conn: &Connection) -> Result<i64> {
    conn.pragma_query_value(None, "user_version", |r| r.get(0))
}
