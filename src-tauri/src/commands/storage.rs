//! ストレージの使用状況と整理。
//!
//! - ライブラリの容量内訳 (メディア種別・拡張子別) と、アプリが作るファイル (サムネイル・DB・AI モデル) の容量
//! - 整理候補の一覧 (大きいファイル・未再生・Inbox 長期滞留・長期間見ていない)
//! - サムネイルの掃除 (どの行からも参照されていないファイルの削除、大きすぎるサムネイルの作り直し)
//! - ライブラリから行を消すときのサムネイル削除 (`db_videos` の削除コマンドから呼ぶ)

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};

use serde::Serialize;
use tauri::{AppHandle, Manager, State};
use walkdir::WalkDir;

use crate::db::DbState;

/// サムネイルを置くディレクトリ名。`<app_cache_dir>/thumbnails` (生成サムネイル) と
/// `<app_data_dir>/thumbnails` (リンクのサムネイル・旧形式) の 2 か所にある。
const THUMBNAIL_DIR_NAME: &str = "thumbnails";

/// これより大きいサムネイルは「大きすぎる」とみなす。
/// 通常のサムネイル (幅 320px の WebP) は数十 KB なので、これを超えるのは
/// アニメーション WebP を丸ごとコピーしたものくらい。
/// `library::generate_thumbnail` もこの値以下のアニメーション WebP だけをコピーする。
pub(crate) const MAX_THUMBNAIL_BYTES: u64 = 512 * 1024;

/// 更新から間もないファイルは孤立サムネイルとして消さない。
/// サムネイル生成はファイルを書いてから DB に記録するため、その間のファイルを守る。
const ORPHAN_GRACE: Duration = Duration::from_secs(10 * 60);

/// 整理候補の「古い」の基準 (日数)
const STALE_INBOX_DAYS: i64 = 30;
const UNWATCHED_DAYS: i64 = 30;
const LONG_UNVIEWED_DAYS: i64 = 180;

/// SQL の IN 句に一度に渡す件数
const CHUNK: usize = 400;

// ── サムネイルの場所と削除 ──────────────────────────────────────────────────

pub(crate) fn thumbnail_roots(app: &AppHandle) -> Vec<PathBuf> {
    let p = app.path();
    [p.app_cache_dir(), p.app_data_dir()]
        .into_iter()
        .filter_map(Result::ok)
        .map(|d| d.join(THUMBNAIL_DIR_NAME))
        .collect()
}

/// `path` がいずれかのサムネイルディレクトリの中にあるか。
/// シンボリックリンクや `..` で外に出られないよう、両方を正規化して比べる。
/// 存在しないパスは false。
fn is_inside_roots(path: &Path, roots: &[PathBuf]) -> bool {
    let Ok(canon) = path.canonicalize() else { return false };
    roots
        .iter()
        .filter_map(|r| r.canonicalize().ok())
        .any(|r| canon.starts_with(&r))
}

fn id_params(ids: &[i64]) -> (String, Vec<rusqlite::types::Value>) {
    let ph = ids.iter().map(|_| "?").collect::<Vec<_>>().join(", ");
    let params = ids.iter().map(|&id| rusqlite::types::Value::Integer(id)).collect();
    (ph, params)
}

/// 指定した行のサムネイルパスを集める。行を消す前に呼ぶ。
pub(crate) fn thumbnails_for_ids(
    conn: &rusqlite::Connection,
    ids: &[i64],
) -> Result<Vec<String>, String> {
    let mut out = Vec::new();
    for chunk in ids.chunks(CHUNK) {
        let (ph, params) = id_params(chunk);
        let mut stmt = conn
            .prepare(&format!(
                "SELECT thumbnail FROM videos
                 WHERE id IN ({ph}) AND thumbnail IS NOT NULL AND thumbnail != ''"
            ))
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(rusqlite::params_from_iter(params.iter()), |r| r.get::<_, String>(0))
            .map_err(|e| e.to_string())?;
        for row in rows {
            out.push(row.map_err(|e| e.to_string())?);
        }
    }
    Ok(out)
}

/// 渡したサムネイルのうち、どの行からも参照されておらず、サムネイルディレクトリの中にある
/// ファイルだけを消す。行を消した後 (コミット後) に呼ぶ。消した件数を返す。
/// 失敗しても行の削除は済んでいるので、エラーはログに残すだけにする (残ったものは孤立サムネイルの掃除で消える)。
pub(crate) fn remove_unreferenced_thumbnails(
    conn: &rusqlite::Connection,
    roots: &[PathBuf],
    thumbnails: &[String],
) -> usize {
    let unique: Vec<&String> = {
        let mut seen = HashSet::new();
        thumbnails.iter().filter(|t| !t.is_empty() && seen.insert(t.as_str())).collect()
    };
    if unique.is_empty() {
        return 0;
    }

    // まだ別の行が使っているものは残す
    let mut still_used: HashSet<String> = HashSet::new();
    for chunk in unique.chunks(CHUNK) {
        let ph = chunk.iter().map(|_| "?").collect::<Vec<_>>().join(", ");
        let sql = format!("SELECT DISTINCT thumbnail FROM videos WHERE thumbnail IN ({ph})");
        let result = conn.prepare(&sql).and_then(|mut stmt| {
            stmt.query_map(rusqlite::params_from_iter(chunk.iter()), |r| r.get::<_, String>(0))?
                .collect::<rusqlite::Result<Vec<_>>>()
        });
        match result {
            Ok(rows) => still_used.extend(rows),
            Err(e) => {
                // 参照の確認ができないときは消さない
                log::warn!("[storage] サムネイルの参照確認に失敗しました: {e}");
                return 0;
            }
        }
    }

    let mut removed = 0;
    for thumb in unique {
        if still_used.contains(thumb.as_str()) {
            continue;
        }
        let path = Path::new(thumb.as_str());
        if !is_inside_roots(path, roots) {
            continue;
        }
        match std::fs::remove_file(path) {
            Ok(()) => removed += 1,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(e) => log::warn!("[storage] サムネイルの削除に失敗しました ({thumb}): {e}"),
        }
    }
    removed
}

// ── サムネイルの使用状況 ────────────────────────────────────────────────────

struct ThumbFile {
    path: PathBuf,
    size: u64,
    modified: Option<SystemTime>,
}

fn list_thumbnail_files(roots: &[PathBuf]) -> Vec<ThumbFile> {
    let mut seen: HashSet<PathBuf> = HashSet::new();
    let mut files = Vec::new();
    for root in roots {
        for entry in WalkDir::new(root).into_iter().filter_map(|e| e.ok()) {
            if !entry.file_type().is_file() {
                continue;
            }
            // 2 つのルートが同じ場所を指していても二重に数えない
            let canon = entry.path().canonicalize().unwrap_or_else(|_| entry.path().to_path_buf());
            if !seen.insert(canon) {
                continue;
            }
            let Ok(meta) = entry.metadata() else { continue };
            files.push(ThumbFile {
                path: entry.path().to_path_buf(),
                size: meta.len(),
                modified: meta.modified().ok(),
            });
        }
    }
    files
}

/// DB が参照しているサムネイル。キーはファイル名、値は (行 id, 参照パス, media_type)。
/// サムネイルのファイル名はパスのハッシュなので、ファイル名で突き合わせる。
/// 同名ファイルが別の場所にあっても「参照されている」側に倒れるだけなので安全。
type ThumbRefs = HashMap<String, Vec<(i64, String, String)>>;

fn thumbnail_refs(conn: &rusqlite::Connection) -> Result<ThumbRefs, String> {
    let mut stmt = conn
        .prepare(
            "SELECT id, thumbnail, COALESCE(media_type, 'video') FROM videos
             WHERE thumbnail IS NOT NULL AND thumbnail != ''",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?, r.get::<_, String>(2)?)))
        .map_err(|e| e.to_string())?;
    let mut refs: ThumbRefs = HashMap::new();
    for row in rows {
        let (id, thumb, media_type) = row.map_err(|e| e.to_string())?;
        if let Some(name) = Path::new(&thumb).file_name().and_then(|n| n.to_str()) {
            refs.entry(name.to_string()).or_default().push((id, thumb, media_type));
        }
    }
    Ok(refs)
}

fn file_name(path: &Path) -> Option<&str> {
    path.file_name().and_then(|n| n.to_str())
}

fn is_orphan(f: &ThumbFile, refs: &ThumbRefs, now: SystemTime) -> bool {
    let referenced = file_name(&f.path).is_some_and(|n| refs.contains_key(n));
    // 更新時刻が取れない・未来になっているものは新しいとみなして残す
    let old_enough = f
        .modified
        .and_then(|m| now.duration_since(m).ok())
        .is_some_and(|age| age >= ORPHAN_GRACE);
    !referenced && old_enough
}

/// 大きすぎるサムネイルを参照している行。作り直せないリンクのサムネイルは除く。
fn oversized_refs<'a>(f: &ThumbFile, refs: &'a ThumbRefs) -> Vec<&'a (i64, String, String)> {
    if f.size <= MAX_THUMBNAIL_BYTES {
        return Vec::new();
    }
    let Some(list) = file_name(&f.path).and_then(|n| refs.get(n)) else { return Vec::new() };
    let canon = f.path.canonicalize().ok();
    list.iter()
        .filter(|(_, thumb, media_type)| {
            media_type != "link" && canon.is_some() && Path::new(thumb).canonicalize().ok() == canon
        })
        .collect()
}

#[derive(Serialize, Default, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ThumbnailUsage {
    pub file_count: u64,
    pub bytes: u64,
    pub orphan_count: u64,
    pub orphan_bytes: u64,
    pub oversized_count: u64,
    pub oversized_bytes: u64,
}

fn thumbnail_usage(files: &[ThumbFile], refs: &ThumbRefs, now: SystemTime) -> ThumbnailUsage {
    let mut u = ThumbnailUsage::default();
    for f in files {
        u.file_count += 1;
        u.bytes += f.size;
        if is_orphan(f, refs, now) {
            u.orphan_count += 1;
            u.orphan_bytes += f.size;
        } else if !oversized_refs(f, refs).is_empty() {
            u.oversized_count += 1;
            u.oversized_bytes += f.size;
        }
    }
    u
}

// ── 容量の内訳 ──────────────────────────────────────────────────────────────

#[derive(Serialize, Debug, PartialEq)]
pub struct SizeBucket {
    /// メディア種別 ("video" 等) または小文字の拡張子 (拡張子なしは "")
    pub key: String,
    pub count: u64,
    pub bytes: u64,
}

#[derive(Serialize, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LibraryUsage {
    pub count: u64,
    pub bytes: u64,
    /// サイズが取れなかったファイルの数 (読めない等)。合計には含まれない
    pub unknown_size_count: u64,
    /// ファイルが見つからない (`status = 'missing'`) 行の数。容量は使っていない
    pub missing_count: u64,
    pub by_media_type: Vec<SizeBucket>,
    /// 容量の大きい順
    pub by_extension: Vec<SizeBucket>,
}

fn extension_of(path: &str) -> String {
    Path::new(path)
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_lowercase())
        .unwrap_or_default()
}

fn sorted_buckets(map: HashMap<String, (u64, u64)>) -> Vec<SizeBucket> {
    let mut v: Vec<SizeBucket> = map
        .into_iter()
        .map(|(key, (count, bytes))| SizeBucket { key, count, bytes })
        .collect();
    v.sort_by(|a, b| b.bytes.cmp(&a.bytes).then(b.count.cmp(&a.count)).then(a.key.cmp(&b.key)));
    v
}

fn library_usage(conn: &rusqlite::Connection) -> Result<LibraryUsage, String> {
    let mut stmt = conn
        .prepare(
            "SELECT path, COALESCE(media_type, 'video'), file_size, COALESCE(status, '')
             FROM videos WHERE COALESCE(media_type, 'video') != 'link'",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, Option<i64>>(2)?,
                r.get::<_, String>(3)?,
            ))
        })
        .map_err(|e| e.to_string())?;

    let mut usage = LibraryUsage::default();
    let mut by_type: HashMap<String, (u64, u64)> = HashMap::new();
    let mut by_ext: HashMap<String, (u64, u64)> = HashMap::new();
    for row in rows {
        let (path, media_type, size, status) = row.map_err(|e| e.to_string())?;
        if status == "missing" {
            usage.missing_count += 1;
            continue;
        }
        let Some(size) = size.and_then(|s| u64::try_from(s).ok()) else {
            usage.unknown_size_count += 1;
            continue;
        };
        usage.count += 1;
        usage.bytes += size;
        let t = by_type.entry(media_type).or_default();
        t.0 += 1;
        t.1 += size;
        let e = by_ext.entry(extension_of(&path)).or_default();
        e.0 += 1;
        e.1 += size;
    }
    usage.by_media_type = sorted_buckets(by_type);
    usage.by_extension = sorted_buckets(by_ext);
    Ok(usage)
}

fn dir_size(path: &Path) -> u64 {
    WalkDir::new(path)
        .into_iter()
        .filter_map(|e| e.ok())
        .filter(|e| e.file_type().is_file())
        .filter_map(|e| e.metadata().ok())
        .map(|m| m.len())
        .sum()
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageOverview {
    pub library: LibraryUsage,
    pub thumbnails: ThumbnailUsage,
    /// videos.db とその WAL・共有メモリファイルの合計
    pub database_bytes: u64,
    pub ai_model_bytes: u64,
}

#[tauri::command]
pub async fn get_storage_overview(app: AppHandle) -> Result<StorageOverview, String> {
    tokio::task::spawn_blocking(move || -> Result<StorageOverview, String> {
        let state = app.state::<DbState>();
        // file_size が未取得の行を埋めてから集計する (取得済みの行は stat しない)
        if let Err(e) = super::db_videos::fill_missing_file_sizes(&state) {
            log::warn!("[storage] file_size の取得に失敗しました: {e}");
        }

        let (library, refs) = {
            let conn = state.conn_read()?;
            (library_usage(&conn)?, thumbnail_refs(&conn)?)
        };
        let files = list_thumbnail_files(&thumbnail_roots(&app));
        let thumbnails = thumbnail_usage(&files, &refs, SystemTime::now());

        let data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
        let database_bytes = ["videos.db", "videos.db-wal", "videos.db-shm"]
            .iter()
            .filter_map(|n| std::fs::metadata(data_dir.join(n)).ok())
            .map(|m| m.len())
            .sum();
        let ai_model_bytes = dir_size(&data_dir.join("ai"));

        Ok(StorageOverview { library, thumbnails, database_bytes, ai_model_bytes })
    })
    .await
    .map_err(|e| e.to_string())?
}

// ── サムネイルの掃除 ────────────────────────────────────────────────────────

#[derive(Serialize, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ThumbnailCleanupResult {
    pub removed_orphans: u64,
    /// 大きすぎるため消して作り直し待ちにした行の数
    pub reset_oversized: u64,
    pub freed_bytes: u64,
}

/// `files` はロックを取る前に列挙しておく (数万件の走査中に DB 書き込みを止めないため)。
/// 列挙後に書かれたファイルは含まれず、列挙前でも作りたてのものは猶予時間で守られる。
fn cleanup_thumbnail_files(
    conn: &rusqlite::Connection,
    files: &[ThumbFile],
    now: SystemTime,
) -> Result<ThumbnailCleanupResult, String> {
    let refs = thumbnail_refs(conn)?;
    let mut result = ThumbnailCleanupResult::default();

    for f in files {
        if is_orphan(f, &refs, now) {
            match std::fs::remove_file(&f.path) {
                Ok(()) => {
                    result.removed_orphans += 1;
                    result.freed_bytes += f.size;
                }
                Err(e) => log::warn!("[storage] 孤立サムネイルの削除に失敗しました ({}): {e}", f.path.display()),
            }
            continue;
        }

        let rows = oversized_refs(f, &refs);
        if rows.is_empty() {
            continue;
        }
        // 先に DB を作り直し待ち (thumbnail = NULL) にしてからファイルを消す。
        // 逆順だと、ファイルを消した後に DB 更新が失敗したとき壊れた参照が残る
        let ids: Vec<i64> = rows.iter().map(|(id, _, _)| *id).collect();
        let (ph, params) = id_params(&ids);
        let n = conn
            .execute(&format!("UPDATE videos SET thumbnail = NULL WHERE id IN ({ph})"), rusqlite::params_from_iter(params.iter()))
            .map_err(|e| e.to_string())?;
        result.reset_oversized += n as u64;
        match std::fs::remove_file(&f.path) {
            Ok(()) => result.freed_bytes += f.size,
            Err(e) => log::warn!("[storage] 大きすぎるサムネイルの削除に失敗しました ({}): {e}", f.path.display()),
        }
    }
    Ok(result)
}

/// 孤立サムネイルを消し、大きすぎるサムネイルを作り直し待ちにする。
/// `resetOversized > 0` のときはフロントエンドがサムネイル生成を走らせる。
#[tauri::command]
pub async fn cleanup_thumbnails(app: AppHandle) -> Result<ThumbnailCleanupResult, String> {
    tokio::task::spawn_blocking(move || {
        let files = list_thumbnail_files(&thumbnail_roots(&app));
        let state = app.state::<DbState>();
        let conn = state.conn()?;
        cleanup_thumbnail_files(&conn, &files, SystemTime::now())
    })
    .await
    .map_err(|e| e.to_string())?
}

// ── 整理候補 ────────────────────────────────────────────────────────────────

/// 最後に見た日時 (再生と詳細表示の新しいほう)。どちらも無ければ NULL
const LAST_SEEN_EXPR: &str = "NULLIF(MAX(COALESCE(datetime(last_viewed_at), ''), COALESCE(datetime(watched_at), '')), '')";

/// 整理候補の種類ごとの条件と「古い」の基準日数
fn candidate_filter(kind: &str) -> Result<(String, Option<i64>), String> {
    Ok(match kind {
        "large" => (String::new(), None),
        "unwatched" => (
            format!(
                "AND COALESCE(rating, 0) = 0 AND COALESCE(watch_count, 0) = 0
                 AND watched_at IS NULL AND last_viewed_at IS NULL
                 AND datetime(created_at) < datetime('now', '-{UNWATCHED_DAYS} days')"
            ),
            Some(UNWATCHED_DAYS),
        ),
        "staleInbox" => (
            format!(
                "AND status = 'inbox'
                 AND datetime(created_at) < datetime('now', '-{STALE_INBOX_DAYS} days')"
            ),
            Some(STALE_INBOX_DAYS),
        ),
        "longUnviewed" => (
            format!(
                "AND {LAST_SEEN_EXPR} IS NOT NULL
                 AND {LAST_SEEN_EXPR} < datetime('now', '-{LONG_UNVIEWED_DAYS} days')"
            ),
            Some(LONG_UNVIEWED_DAYS),
        ),
        other => return Err(format!("不明な整理候補の種類です: {other}")),
    })
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct CleanupItem {
    pub id: i64,
    pub path: String,
    pub title: Option<String>,
    pub thumbnail: Option<String>,
    pub file_size: i64,
    pub media_type: String,
    pub rating: i64,
    pub watch_count: i64,
    pub created_at: String,
    pub last_seen_at: Option<String>,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct CleanupCandidates {
    /// 条件に合う全件 (items は上位 limit 件だけ)
    pub total_count: i64,
    pub total_bytes: i64,
    pub threshold_days: Option<i64>,
    pub items: Vec<CleanupItem>,
}

fn query_candidates(
    conn: &rusqlite::Connection,
    kind: &str,
    limit: i64,
) -> Result<CleanupCandidates, String> {
    let (filter, threshold_days) = candidate_filter(kind)?;
    // ファイルが手元にあり容量を使っているものだけ (リンク・欠損は対象外)
    let base = format!(
        "FROM videos
         WHERE COALESCE(media_type, 'video') != 'link'
           AND COALESCE(status, '') != 'missing'
           AND file_size > 0
           {filter}"
    );

    let (total_count, total_bytes): (i64, i64) = conn
        .query_row(&format!("SELECT COUNT(*), COALESCE(SUM(file_size), 0) {base}"), [], |r| {
            Ok((r.get(0)?, r.get(1)?))
        })
        .map_err(|e| e.to_string())?;

    let mut stmt = conn
        .prepare(&format!(
            "SELECT id, path, title, thumbnail, file_size, COALESCE(media_type, 'video'),
                    COALESCE(rating, 0), COALESCE(watch_count, 0), COALESCE(created_at, ''),
                    {LAST_SEEN_EXPR}
             {base}
             ORDER BY file_size DESC, id
             LIMIT ?1"
        ))
        .map_err(|e| e.to_string())?;
    let items = stmt
        .query_map([limit.clamp(1, 1000)], |r| {
            Ok(CleanupItem {
                id: r.get(0)?,
                path: r.get(1)?,
                title: r.get(2)?,
                thumbnail: r.get::<_, Option<String>>(3)?.filter(|t| !t.is_empty()),
                file_size: r.get(4)?,
                media_type: r.get(5)?,
                rating: r.get(6)?,
                watch_count: r.get(7)?,
                created_at: r.get(8)?,
                last_seen_at: r.get(9)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(|e| e.to_string())?;

    Ok(CleanupCandidates { total_count, total_bytes, threshold_days, items })
}

/// 整理候補を容量の大きい順に返す。
/// kind: "large" | "unwatched" | "staleInbox" | "longUnviewed"
#[tauri::command]
pub async fn get_cleanup_candidates(
    state: State<'_, DbState>,
    kind: String,
    limit: i64,
) -> Result<CleanupCandidates, String> {
    if let Err(e) = super::db_videos::fill_missing_file_sizes(&state) {
        log::warn!("[storage] file_size の取得に失敗しました: {e}");
    }
    let conn = state.conn_read()?;
    query_candidates(&conn, &kind, limit)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::schema::init_db;
    use rusqlite::Connection;

    fn setup() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        init_db(&conn).unwrap();
        conn
    }

    /// テストごとに空のサムネイルディレクトリを作る
    fn temp_root(name: &str) -> PathBuf {
        let dir = std::env::temp_dir()
            .join(format!("css-storage-test-{}-{name}", std::process::id()))
            .join(THUMBNAIL_DIR_NAME);
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn write_file(path: &Path, size: usize) {
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, vec![0u8; size]).unwrap();
    }

    fn insert(conn: &Connection, path: &str, thumb: Option<&str>, media_type: &str) -> i64 {
        conn.execute(
            "INSERT INTO videos (path, thumbnail, media_type, status) VALUES (?1, ?2, ?3, 'active')",
            rusqlite::params![path, thumb, media_type],
        )
        .unwrap();
        conn.last_insert_rowid()
    }

    fn s(p: &Path) -> String {
        p.to_string_lossy().into_owned()
    }

    /// 猶予時間より後の「今」
    fn later() -> SystemTime {
        SystemTime::now() + ORPHAN_GRACE + Duration::from_secs(1)
    }

    // ── remove_unreferenced_thumbnails ───────────────────────────────────────

    #[test]
    fn removes_thumbnail_no_longer_referenced() {
        let root = temp_root("unref");
        let conn = setup();
        let thumb = root.join("ab/abc.webp");
        write_file(&thumb, 10);
        let id = insert(&conn, "/m/a.mp4", Some(&s(&thumb)), "video");

        let thumbs = thumbnails_for_ids(&conn, &[id]).unwrap();
        conn.execute("DELETE FROM videos WHERE id = ?1", [id]).unwrap();
        let removed = remove_unreferenced_thumbnails(&conn, &[root], &thumbs);

        assert_eq!(removed, 1);
        assert!(!thumb.exists());
    }

    #[test]
    fn keeps_thumbnail_still_referenced_by_another_row() {
        let root = temp_root("shared");
        let conn = setup();
        let thumb = root.join("ab/shared.webp");
        write_file(&thumb, 10);
        let a = insert(&conn, "/m/a.mp4", Some(&s(&thumb)), "video");
        insert(&conn, "/m/b.mp4", Some(&s(&thumb)), "video");

        let thumbs = thumbnails_for_ids(&conn, &[a]).unwrap();
        conn.execute("DELETE FROM videos WHERE id = ?1", [a]).unwrap();
        assert_eq!(remove_unreferenced_thumbnails(&conn, &[root], &thumbs), 0);
        assert!(thumb.exists());
    }

    #[test]
    fn never_removes_files_outside_thumbnail_dirs() {
        let root = temp_root("outside");
        let outside = root.parent().unwrap().join("media/photo.jpg");
        write_file(&outside, 10);
        let conn = setup();
        // サムネイルとして元画像そのものを指している行 (インポート等で起こり得る)
        let id = insert(&conn, &s(&outside), Some(&s(&outside)), "image");

        let thumbs = thumbnails_for_ids(&conn, &[id]).unwrap();
        conn.execute("DELETE FROM videos WHERE id = ?1", [id]).unwrap();
        assert_eq!(remove_unreferenced_thumbnails(&conn, &[root.clone()], &thumbs), 0);
        assert!(outside.exists());

        // `..` でディレクトリの外へ出るパスも消さない
        let escaped = root.join("../media/photo.jpg");
        assert_eq!(remove_unreferenced_thumbnails(&conn, &[root], &[s(&escaped)]), 0);
        assert!(outside.exists());
    }

    // ── cleanup_thumbnail_files ──────────────────────────────────────────────

    #[test]
    fn cleanup_removes_old_orphans_and_keeps_referenced_and_recent() {
        let root = temp_root("orphans");
        let conn = setup();
        let used = root.join("aa/used.webp");
        let orphan = root.join("bb/orphan.webp");
        write_file(&used, 100);
        write_file(&orphan, 200);
        insert(&conn, "/m/a.mp4", Some(&s(&used)), "video");

        // 作ったばかりのファイルは猶予時間内なので残る
        let r = cleanup_thumbnail_files(&conn, &list_thumbnail_files(&[root.clone()]), SystemTime::now()).unwrap();
        assert_eq!(r.removed_orphans, 0);
        assert!(orphan.exists());

        let r = cleanup_thumbnail_files(&conn, &list_thumbnail_files(&[root]), later()).unwrap();
        assert_eq!(r, ThumbnailCleanupResult { removed_orphans: 1, reset_oversized: 0, freed_bytes: 200 });
        assert!(!orphan.exists());
        assert!(used.exists());
    }

    #[test]
    fn cleanup_resets_oversized_thumbnails_but_not_link_thumbnails() {
        let root = temp_root("oversized");
        let conn = setup();
        let big = root.join("cc/big.webp");
        let link_big = root.join("link_0123.webp");
        let small = root.join("dd/small.webp");
        let size = MAX_THUMBNAIL_BYTES as usize + 1;
        write_file(&big, size);
        write_file(&link_big, size);
        write_file(&small, 100);
        let big_id = insert(&conn, "/m/anim.webp", Some(&s(&big)), "image");
        let link_id = insert(&conn, "https://example.com/", Some(&s(&link_big)), "link");
        insert(&conn, "/m/b.mp4", Some(&s(&small)), "video");

        let r = cleanup_thumbnail_files(&conn, &list_thumbnail_files(&[root]), later()).unwrap();
        assert_eq!(r.reset_oversized, 1);
        assert_eq!(r.freed_bytes, size as u64);
        assert!(!big.exists());
        assert!(link_big.exists());
        assert!(small.exists());

        let thumb_of = |id: i64| -> Option<String> {
            conn.query_row("SELECT thumbnail FROM videos WHERE id = ?1", [id], |r| r.get(0)).unwrap()
        };
        assert_eq!(thumb_of(big_id), None);
        assert_eq!(thumb_of(link_id), Some(s(&link_big)));
    }

    #[test]
    fn usage_counts_orphans_and_oversized_separately() {
        let root = temp_root("usage");
        let conn = setup();
        let used = root.join("aa/used.webp");
        let orphan = root.join("bb/orphan.webp");
        let big = root.join("cc/big.webp");
        write_file(&used, 100);
        write_file(&orphan, 200);
        write_file(&big, MAX_THUMBNAIL_BYTES as usize + 1);
        insert(&conn, "/m/a.mp4", Some(&s(&used)), "video");
        insert(&conn, "/m/b.webp", Some(&s(&big)), "image");

        let refs = thumbnail_refs(&conn).unwrap();
        let u = thumbnail_usage(&list_thumbnail_files(&[root]), &refs, later());
        assert_eq!(u.file_count, 3);
        assert_eq!(u.orphan_count, 1);
        assert_eq!(u.orphan_bytes, 200);
        assert_eq!(u.oversized_count, 1);
        assert_eq!(u.bytes, 300 + MAX_THUMBNAIL_BYTES + 1);
    }

    // ── library_usage ────────────────────────────────────────────────────────

    #[test]
    fn library_usage_groups_by_type_and_extension() {
        let conn = setup();
        let add = |path: &str, mt: &str, size: Option<i64>, status: &str| {
            conn.execute(
                "INSERT INTO videos (path, media_type, file_size, status) VALUES (?1, ?2, ?3, ?4)",
                rusqlite::params![path, mt, size, status],
            )
            .unwrap();
        };
        add("/m/a.MP4", "video", Some(1000), "active");
        add("/m/b.mkv", "video", Some(3000), "active");
        add("/m/c.mp4", "video", Some(500), "inbox");
        add("/m/d.jpg", "image", Some(10), "active");
        add("/m/e.mp4", "video", None, "active");
        add("/m/f.mp4", "video", Some(9999), "missing");
        add("https://example.com/", "link", None, "active");

        let u = library_usage(&conn).unwrap();
        assert_eq!(u.count, 4);
        assert_eq!(u.bytes, 4510);
        assert_eq!(u.unknown_size_count, 1);
        assert_eq!(u.missing_count, 1);
        assert_eq!(
            u.by_media_type,
            vec![
                SizeBucket { key: "video".into(), count: 3, bytes: 4500 },
                SizeBucket { key: "image".into(), count: 1, bytes: 10 },
            ]
        );
        assert_eq!(
            u.by_extension,
            vec![
                SizeBucket { key: "mkv".into(), count: 1, bytes: 3000 },
                SizeBucket { key: "mp4".into(), count: 2, bytes: 1500 },
                SizeBucket { key: "jpg".into(), count: 1, bytes: 10 },
            ]
        );
    }

    // ── query_candidates ─────────────────────────────────────────────────────

    fn add_candidate(conn: &Connection, path: &str, size: i64, extra: &str) -> i64 {
        conn.execute(
            "INSERT INTO videos (path, media_type, file_size, status, created_at) VALUES (?1, 'video', ?2, 'active', datetime('now', '-400 days'))",
            rusqlite::params![path, size],
        )
        .unwrap();
        let id = conn.last_insert_rowid();
        if !extra.is_empty() {
            conn.execute(&format!("UPDATE videos SET {extra} WHERE id = ?1"), [id]).unwrap();
        }
        id
    }

    fn ids(c: &CleanupCandidates) -> Vec<i64> {
        c.items.iter().map(|i| i.id).collect()
    }

    #[test]
    fn large_lists_by_size_and_excludes_missing_links_and_unknown_sizes() {
        let conn = setup();
        let small = add_candidate(&conn, "/m/s.mp4", 10, "");
        let big = add_candidate(&conn, "/m/b.mp4", 1000, "");
        add_candidate(&conn, "/m/missing.mp4", 5000, "status = 'missing'");
        add_candidate(&conn, "/m/nosize.mp4", 0, "file_size = NULL");
        add_candidate(&conn, "https://x/", 7000, "media_type = 'link'");

        let c = query_candidates(&conn, "large", 100).unwrap();
        assert_eq!(ids(&c), vec![big, small]);
        assert_eq!(c.total_count, 2);
        assert_eq!(c.total_bytes, 1010);

        let c = query_candidates(&conn, "large", 1).unwrap();
        assert_eq!(ids(&c), vec![big]);
        assert_eq!(c.total_count, 2, "件数と合計は limit に関係なく全件");
    }

    #[test]
    fn unwatched_requires_no_rating_no_views_and_old_enough() {
        let conn = setup();
        let target = add_candidate(&conn, "/m/a.mp4", 10, "");
        add_candidate(&conn, "/m/rated.mp4", 10, "rating = 3");
        add_candidate(&conn, "/m/played.mp4", 10, "watch_count = 1");
        add_candidate(&conn, "/m/viewed.mp4", 10, "last_viewed_at = CURRENT_TIMESTAMP");
        add_candidate(&conn, "/m/new.mp4", 10, "created_at = CURRENT_TIMESTAMP");

        let c = query_candidates(&conn, "unwatched", 100).unwrap();
        assert_eq!(ids(&c), vec![target]);
        assert_eq!(c.threshold_days, Some(UNWATCHED_DAYS));
    }

    #[test]
    fn stale_inbox_only_old_inbox_items() {
        let conn = setup();
        let target = add_candidate(&conn, "/m/a.mp4", 10, "status = 'inbox'");
        add_candidate(&conn, "/m/new.mp4", 10, "status = 'inbox', created_at = CURRENT_TIMESTAMP");
        add_candidate(&conn, "/m/active.mp4", 10, "");

        assert_eq!(ids(&query_candidates(&conn, "staleInbox", 100).unwrap()), vec![target]);
    }

    #[test]
    fn long_unviewed_uses_newest_of_watched_and_viewed() {
        let conn = setup();
        let target = add_candidate(&conn, "/m/a.mp4", 10, "watched_at = datetime('now', '-300 days')");
        // 再生は古いが最近詳細を見た → 対象外
        add_candidate(
            &conn,
            "/m/b.mp4",
            10,
            "watched_at = datetime('now', '-300 days'), last_viewed_at = datetime('now', '-1 days')",
        );
        // 一度も見ていないものは「未再生」側で扱う
        add_candidate(&conn, "/m/never.mp4", 10, "");
        // ISO 形式 (T 区切り・Z 付き) の日時も比べられる
        let iso = add_candidate(&conn, "/m/iso.mp4", 5, "last_viewed_at = '2020-01-01T00:00:00.000Z'");

        let c = query_candidates(&conn, "longUnviewed", 100).unwrap();
        assert_eq!(ids(&c), vec![target, iso]);
        assert!(c.items[0].last_seen_at.is_some());
    }

    #[test]
    fn unknown_kind_is_an_error() {
        let conn = setup();
        assert!(query_candidates(&conn, "drop table", 10).is_err());
    }
}
