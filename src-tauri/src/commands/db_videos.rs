use rusqlite::OptionalExtension;
use serde::{Deserialize, Serialize};
use tauri::State;

use crate::db::DbState;
use super::db_groups::{self, VideoGroupRow};
use super::db_tags::VideoTagRow;
use super::storage;
use super::utils::normalize_path_str;

// ── Types ─────────────────────────────────────────────────────────────────────

#[derive(Serialize, Deserialize, Clone)]
pub struct Video {
    pub id: i64,
    pub path: String,
    pub title: Option<String>,
    pub duration: Option<f64>,
    pub thumbnail: Option<String>,
    pub watched_at: Option<String>,
    pub progress: f64,
    pub rating: i64,
    pub category_id: Option<i64>,
    pub has_audio: Option<i64>,
    pub watch_count: i64,
    pub created_at: String,
    /// 'video' | 'audio' | 'image' | 'link'
    pub media_type: String,
    pub source_url: Option<String>,
    /// 'inbox' (新着: まだ開いていない) | 'active' | 'missing'
    pub status: String,
    pub source_type: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FetchVideosResult {
    pub videos: Vec<Video>,
    pub total_count: i64,
    pub video_tags: Vec<VideoTagRow>,
    /// ページ内の動画が入っているグループ (グループに入っていない動画は含まない)
    pub video_groups: Vec<VideoGroupRow>,
}

/// `filter_has_audio` で無音の音声トラックがあるものを選ぶ値
const FILTER_SILENT_AUDIO: i64 = 2;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VideoFilter {
    pub filter_search: String,
    pub filter_category_id: Option<i64>,
    pub filter_tag_ids: Vec<i64>,
    pub filter_tag_mode: String,
    pub filter_min_rating: i64,
    #[serde(default = "default_rating_mode")]
    pub filter_rating_mode: String,
    /// 1: 音声あり / 0: 音声なし / 2: 無音の音声トラックあり (`FILTER_SILENT_AUDIO`)
    pub filter_has_audio: Option<i64>,
    pub filter_min_duration: f64,
    pub filter_max_duration: Option<f64>,
    pub filter_watched_status: String,
    pub filter_watch_dir: Option<String>,
    pub filter_media_type: String,
    /// "all" | "only" | "exclude" — AV1 変換済み (`*.av1.mkv`) の絞り込み
    #[serde(default = "default_av1_filter")]
    pub filter_av1: String,
    /// グループ (シリーズ・別パターン) を代表の 1 件にまとめて返す
    #[serde(default)]
    pub filter_collapse_groups: bool,
    /// 新着 (`status = 'inbox'`) だけにする
    #[serde(default)]
    pub filter_new_only: bool,
    pub filter_sort_by: String,
    pub filter_sort_order: String,
    pub current_page: i64,
    pub page_size: i64,
}

fn default_rating_mode() -> String {
    "gte".to_string()
}

fn default_av1_filter() -> String {
    "all".to_string()
}

/// transcode_to_av1 の出力名 (`{stem}.av1.mkv` / 重複回避時 `{stem}.av1_{n}.mkv`) に一致する条件
const AV1_PATH_CONDITION: &str =
    "(LOWER(v.path) GLOB '*.av1.mkv' OR LOWER(v.path) GLOB '*.av1_[0-9]*.mkv')";

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WatchDir {
    pub path: String,
    pub use_dir_as_category: i64,
}

#[derive(Serialize)]
pub struct PendingThumbnail {
    pub id: i64,
    pub path: String,
    pub thumbnail: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ThumbnailUpdate {
    pub id: i64,
    pub thumbnail: Option<String>,
    pub duration: Option<f64>,
    pub has_audio: i64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioUpdate {
    pub id: i64,
    pub has_audio: i64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanImportResult {
    pub new_count: i64,
    pub scanned_count: i64,
    pub errors: Vec<String>,
    pub truncated: bool,
    pub skipped_count: u32,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RescanResult {
    pub new_count: i64,
    pub scanned_count: i64,
    pub errors: Vec<String>,
    pub truncated: bool,
    pub skipped_count: u32,
}

#[derive(Deserialize)]
pub struct WatcherCreate {
    pub path: String,
    pub title: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WatcherRename {
    pub old_path: String,
    pub new_path: String,
    pub title: String,
}

#[derive(Serialize)]
pub struct VideoIdPath {
    pub id: i64,
    pub path: String,
}

// ── helpers ───────────────────────────────────────────────────────────────────

/// `Video` を読む SELECT の列 (`videos` の別名は `v`。`video_from_row` と順番を合わせる)
pub(crate) const VIDEO_COLUMNS: &str = "v.id, v.path, v.title, v.duration, v.thumbnail, v.watched_at,
     v.progress, v.rating, v.category_id, v.has_audio, v.watch_count,
     v.created_at, v.media_type, v.source_url, v.status, v.source_type";

/// `VIDEO_COLUMNS` の列の数 (後ろに列を足して読むときの番号)
pub(crate) const VIDEO_COLUMN_COUNT: usize = 16;

pub fn video_from_row(r: &rusqlite::Row<'_>) -> rusqlite::Result<Video> {
    Ok(Video {
        id: r.get(0)?,
        path: r.get(1)?,
        title: r.get(2)?,
        duration: r.get(3)?,
        thumbnail: r.get(4)?,
        watched_at: r.get(5)?,
        progress: r.get(6)?,
        rating: r.get(7)?,
        category_id: r.get(8)?,
        has_audio: r.get(9)?,
        watch_count: r.get(10)?,
        created_at: r.get(11)?,
        media_type: r.get(12)?,
        source_url: r.get(13)?,
        status: r.get(14)?,
        source_type: r.get(15)?,
    })
}

/// `SELECT {VIDEO_COLUMNS} {rest}` の結果を返す。`rest` は FROM 以降 (`videos` の別名は `v`)
pub(crate) fn query_videos<P: rusqlite::Params>(
    conn: &rusqlite::Connection,
    rest: &str,
    params: P,
) -> rusqlite::Result<Vec<Video>> {
    let mut stmt = conn.prepare(&format!("SELECT {VIDEO_COLUMNS} {rest}"))?;
    let rows = stmt.query_map(params, video_from_row)?;
    rows.collect()
}

fn get_category_descendants(
    conn: &rusqlite::Connection,
    category_id: i64,
) -> rusqlite::Result<Vec<i64>> {
    let mut stmt = conn.prepare(
        "WITH RECURSIVE cat_tree AS (
           SELECT id FROM categories WHERE id = ?1
           UNION ALL
           SELECT c.id FROM categories c JOIN cat_tree ct ON c.parent_id = ct.id
         ) SELECT id FROM cat_tree",
    )?;
    let rows = stmt.query_map([category_id], |r| r.get::<_, i64>(0))?;
    rows.collect()
}

pub(crate) fn escape_like_dir(dir: &str) -> String {
    dir.replace('\\', "/")
        .trim_end_matches('/')
        .replace('!', "!!")
        .replace('%', "!%")
        .replace('_', "!_")
}

fn build_where_clause(
    conn: &rusqlite::Connection,
    filter: &VideoFilter,
) -> (String, Vec<rusqlite::types::Value>) {
    use rusqlite::types::Value;
    let mut conditions = Vec::<String>::new();
    let mut params = Vec::<Value>::new();

    if !filter.filter_search.trim().is_empty() {
        conditions.push("(v.title LIKE ? OR v.path LIKE ?)".to_string());
        let s = format!("%{}%", filter.filter_search.trim());
        params.push(Value::Text(s.clone()));
        params.push(Value::Text(s));
    }

    if let Some(cat_id) = filter.filter_category_id {
        if cat_id == -1 {
            conditions.push("v.category_id IS NULL".to_string());
        } else {
            let ids = get_category_descendants(conn, cat_id).unwrap_or_else(|e| {
                log::warn!("[build_where_clause] カテゴリ子孫取得失敗 (cat_id={cat_id}): {e}");
                vec![cat_id]
            });
            let ph = ids.iter().map(|_| "?").collect::<Vec<_>>().join(", ");
            conditions.push(format!("v.category_id IN ({ph})"));
            for id in ids {
                params.push(Value::Integer(id));
            }
        }
    }

    if !filter.filter_tag_ids.is_empty() {
        let ph = filter.filter_tag_ids.iter().map(|_| "?").collect::<Vec<_>>().join(", ");
        if filter.filter_tag_mode == "or" {
            conditions.push(format!(
                "v.id IN (SELECT vt.video_id FROM video_tags vt WHERE vt.tag_id IN ({ph}))"
            ));
            for &tid in &filter.filter_tag_ids {
                params.push(Value::Integer(tid));
            }
        } else {
            conditions.push(format!(
                "v.id IN (SELECT vt.video_id FROM video_tags vt WHERE vt.tag_id IN ({ph}) GROUP BY vt.video_id HAVING COUNT(*) = ?)"
            ));
            for &tid in &filter.filter_tag_ids {
                params.push(Value::Integer(tid));
            }
            params.push(Value::Integer(filter.filter_tag_ids.len() as i64));
        }
    }

    if filter.filter_min_rating == -1 {
        conditions.push("v.rating = 0".to_string());
    } else if filter.filter_min_rating > 0 {
        let op = match filter.filter_rating_mode.as_str() {
            "lte" => "<=",
            "eq" => "=",
            _ => ">=",
        };
        conditions.push(format!("v.rating {op} ?"));
        params.push(Value::Integer(filter.filter_min_rating));
    }

    match filter.filter_has_audio {
        // 音声トラックはあるが無音 (一部のトラックだけ無音も含む。調べたものだけ)
        Some(FILTER_SILENT_AUDIO) => conditions.push(
            "EXISTS (SELECT 1 FROM media_silent_audio sa WHERE sa.video_id = v.id AND sa.silence IN ('all', 'partial'))"
                .to_string(),
        ),
        Some(has_audio) => {
            conditions.push("v.has_audio = ?".to_string());
            params.push(Value::Integer(has_audio));
        }
        None => {}
    }

    if filter.filter_min_duration > 0.0 {
        conditions.push("v.duration >= ?".to_string());
        params.push(Value::Real(filter.filter_min_duration));
    }

    if let Some(max_dur) = filter.filter_max_duration {
        if max_dur > 0.0 {
            conditions.push("v.duration <= ?".to_string());
            params.push(Value::Real(max_dur));
        }
    }

    if filter.filter_new_only {
        conditions.push("v.status = 'inbox'".to_string());
    }

    match filter.filter_watched_status.as_str() {
        "unwatched" => conditions.push("v.watched_at IS NULL".to_string()),
        "watched" => conditions.push("v.watched_at IS NOT NULL".to_string()),
        _ => {}
    }

    if let Some(ref dir) = filter.filter_watch_dir {
        conditions.push("REPLACE(v.path, '\\', '/') LIKE ? ESCAPE '!'".to_string());
        params.push(Value::Text(format!("{}/%" , escape_like_dir(dir))));
    }

    if filter.filter_media_type != "all" {
        conditions.push("v.media_type = ?".to_string());
        params.push(Value::Text(filter.filter_media_type.clone()));
    }

    match filter.filter_av1.as_str() {
        "only" => conditions.push(AV1_PATH_CONDITION.to_string()),
        "exclude" => conditions.push(format!("NOT {AV1_PATH_CONDITION}")),
        _ => {}
    }

    let where_clause = if conditions.is_empty() {
        String::new()
    } else {
        format!("WHERE {}", conditions.join(" AND "))
    };

    (where_clause, params)
}

/// 絞り込み済みの動画を返す FROM 句の中身 (別名 `v`)。
/// `collapse` のときはグループごとに代表の 1 件だけを残す。代表は表紙が条件に合えば表紙、
/// 合わなければグループ内の並び順で最初のもの。グループに入っていない動画はそのまま残る。
fn video_source(where_clause: &str, collapse: bool) -> String {
    if !collapse {
        return format!("videos v {where_clause}");
    }
    format!(
        "(SELECT * FROM (
            SELECT v.*, ROW_NUMBER() OVER (
              PARTITION BY COALESCE(v.group_id, -v.id)
              ORDER BY CASE WHEN v.id = g.cover_video_id THEN 0 ELSE 1 END,
                       COALESCE(v.group_position, 0), v.id
            ) AS group_rn
            FROM videos v LEFT JOIN media_groups g ON g.id = v.group_id
            {where_clause}
          ) WHERE group_rn = 1) v"
    )
}

pub(crate) fn media_type_for_path(path: &str) -> &'static str {
    let ext = path.rsplit('.').next().unwrap_or("").to_lowercase();
    let ext = ext.as_str();
    if ["mp3", "flac", "aac", "wav", "ogg", "opus", "m4a", "wma"].contains(&ext) {
        "audio"
    } else if ["jpg", "jpeg", "png", "gif", "webp", "bmp", "tiff", "heic", "avif"].contains(&ext) {
        "image"
    } else {
        "video"
    }
}


// ── fetch videos ──────────────────────────────────────────────────────────────

/// ソートキー文字列を ORDER BY 句の式に変換する (ホワイトリスト方式)。
fn sort_column(sort_by: &str) -> &'static str {
    match sort_by {
        "duration" => "COALESCE(v.duration, -1)",
        "rating" => "v.rating",
        "file_size" => "COALESCE(v.file_size, -1)",
        _ => "v.created_at",
    }
}

/// file_size が未取得 (NULL) のレコードについてファイルサイズを取得して保存する。
/// ファイルサイズ順ソート時のみ呼ばれる。stat は DB ロック外で行う。
/// 取得に失敗したファイル (存在しない等) は NULL のまま残し、次回再試行する。
pub(crate) fn fill_missing_file_sizes(state: &DbState) -> Result<(), String> {
    let targets: Vec<(i64, String)> = {
        let conn = state.conn_read()?;
        let mut stmt = conn
            .prepare(
                "SELECT id, path FROM videos
                 WHERE file_size IS NULL
                   AND media_type != 'link'
                   AND status != 'missing'",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))
            .map_err(|e| e.to_string())?;
        rows.collect::<rusqlite::Result<Vec<_>>>().map_err(|e| e.to_string())?
    };
    if targets.is_empty() {
        return Ok(());
    }

    let sizes: Vec<(i64, i64)> = targets
        .into_iter()
        .filter_map(|(id, path)| {
            std::fs::metadata(&path)
                .ok()
                .filter(|m| m.is_file())
                .map(|m| (id, m.len() as i64))
        })
        .collect();
    if sizes.is_empty() {
        return Ok(());
    }

    let conn = state.conn()?;
    let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
    {
        let mut stmt = tx
            .prepare("UPDATE videos SET file_size = ?1 WHERE id = ?2 AND file_size IS NULL")
            .map_err(|e| e.to_string())?;
        for (id, size) in &sizes {
            stmt.execute(rusqlite::params![size, id]).map_err(|e| e.to_string())?;
        }
    }
    tx.commit().map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn db_fetch_videos(
    state: State<'_, DbState>,
    filter: VideoFilter,
) -> Result<FetchVideosResult, String> {
    if filter.filter_sort_by == "file_size" {
        if let Err(e) = fill_missing_file_sizes(&state) {
            log::warn!("[fill_missing_file_sizes] {e}");
        }
    }
    let conn = state.conn_read()?;
    let (where_clause, params) = build_where_clause(&conn, &filter);
    let source = video_source(&where_clause, filter.filter_collapse_groups);

    let total_count: i64 = {
        let sql = format!("SELECT COUNT(*) FROM {source}");
        let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
        stmt.query_row(rusqlite::params_from_iter(params.iter()), |r| r.get(0))
            .map_err(|e| e.to_string())?
    };

    let max_page = std::cmp::max(1, (total_count + filter.page_size - 1) / filter.page_size);
    let page = filter.current_page.min(max_page);
    let offset = (page - 1) * filter.page_size;

    let sort_col = sort_column(&filter.filter_sort_by);
    let dir = if filter.filter_sort_order == "asc" { "ASC" } else { "DESC" };

    let mut all_params: Vec<rusqlite::types::Value> = params;
    all_params.push(rusqlite::types::Value::Integer(filter.page_size));
    all_params.push(rusqlite::types::Value::Integer(offset));

    let videos = query_videos(
        &conn,
        &format!("FROM {source} ORDER BY {sort_col} {dir} LIMIT ? OFFSET ?"),
        rusqlite::params_from_iter(all_params.iter()),
    )
    .map_err(|e| e.to_string())?;

    let video_tags = if videos.is_empty() {
        vec![]
    } else {
        let ph = videos.iter().map(|_| "?").collect::<Vec<_>>().join(", ");
        let tag_sql = format!(
            "SELECT vt.video_id, t.id, t.name, t.color, t.icon, t.tag_category_id, t.created_at
             FROM video_tags vt JOIN tags t ON vt.tag_id = t.id
             WHERE vt.video_id IN ({ph})"
        );
        let mut tag_stmt = conn.prepare(&tag_sql).map_err(|e| e.to_string())?;
        let tag_params: Vec<rusqlite::types::Value> = videos
            .iter()
            .map(|v| rusqlite::types::Value::Integer(v.id))
            .collect();
        let tag_rows = tag_stmt
            .query_map(rusqlite::params_from_iter(tag_params.iter()), |r| {
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
        tag_rows.collect::<rusqlite::Result<Vec<_>>>().map_err(|e| e.to_string())?
    };

    let ids: Vec<i64> = videos.iter().map(|v| v.id).collect();
    let video_groups = db_groups::group_rows_for_videos(&conn, &ids).map_err(|e| e.to_string())?;

    Ok(FetchVideosResult { videos, total_count, video_tags, video_groups })
}

#[tauri::command]
pub async fn db_fetch_all_for_shuffle(
    state: State<'_, DbState>,
    filter: VideoFilter,
) -> Result<Vec<Video>, String> {
    if filter.filter_sort_by == "file_size" {
        if let Err(e) = fill_missing_file_sizes(&state) {
            log::warn!("[fill_missing_file_sizes] {e}");
        }
    }
    let conn = state.conn_read()?;
    let (where_clause, params) = build_where_clause(&conn, &filter);
    let source = video_source(&where_clause, filter.filter_collapse_groups);

    let sort_col = sort_column(&filter.filter_sort_by);
    let dir = if filter.filter_sort_order == "asc" { "ASC" } else { "DESC" };

    query_videos(
        &conn,
        &format!("FROM {source} ORDER BY {sort_col} {dir}"),
        rusqlite::params_from_iter(params.iter()),
    )
    .map_err(|e| e.to_string())
}

// ── simple video mutations ────────────────────────────────────────────────────

/// 新着 (`status = 'inbox'`) を外す SET 句。詳細を開いた・再生したときに使う (`missing` はそのまま)
const CLEAR_NEW: &str = "status = CASE WHEN status = 'inbox' THEN 'active' ELSE status END";

#[tauri::command]
pub async fn db_increment_watch_count(
    state: State<'_, DbState>,
    video_id: i64,
) -> Result<(), String> {
    let conn = state.conn()?;
    conn.execute(
        &format!("UPDATE videos SET watch_count = watch_count + 1, {CLEAR_NEW} WHERE id = ?1"),
        [video_id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn db_update_progress(
    state: State<'_, DbState>,
    video_id: i64,
    progress: f64,
) -> Result<(), String> {
    let conn = state.conn()?;
    conn.execute(
        "UPDATE videos SET progress = ?1, watched_at = CURRENT_TIMESTAMP WHERE id = ?2",
        rusqlite::params![progress, video_id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

// フロントエンドから名前付き引数で呼ぶ Tauri コマンドのため、引数の多さは許容する
#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub async fn db_update_video(
    state: State<'_, DbState>,
    video_id: i64,
    title: Option<String>,
    rating: Option<i64>,
    path: Option<String>,
    media_type: Option<String>,
    source_url: Option<String>,
    created_at: Option<String>,
) -> Result<(), String> {
    let conn = state.conn()?;
    // Build SET clause dynamically
    let mut set_parts = Vec::new();
    let mut params: Vec<rusqlite::types::Value> = Vec::new();

    if let Some(v) = title {
        set_parts.push("title = ?");
        params.push(rusqlite::types::Value::Text(v));
    }
    if let Some(v) = rating {
        set_parts.push("rating = ?");
        params.push(rusqlite::types::Value::Integer(v));
    }
    if let Some(v) = path {
        set_parts.push("path = ?");
        params.push(rusqlite::types::Value::Text(normalize_path_str(&v)));
        // パス変更時: thumbnail='' (以前の失敗マーク) をリセットして再生成対象にする
        set_parts.push("thumbnail = CASE WHEN thumbnail = '' THEN NULL ELSE thumbnail END");
    }
    if let Some(v) = media_type {
        set_parts.push("media_type = ?");
        params.push(rusqlite::types::Value::Text(v));
    }
    if let Some(v) = source_url {
        set_parts.push("source_url = ?");
        params.push(rusqlite::types::Value::Text(v));
    }
    if let Some(v) = created_at {
        set_parts.push("created_at = ?");
        params.push(rusqlite::types::Value::Text(v));
    }

    if set_parts.is_empty() {
        return Ok(());
    }

    params.push(rusqlite::types::Value::Integer(video_id));
    let sql = format!("UPDATE videos SET {} WHERE id = ?", set_parts.join(", "));
    conn.execute(&sql, rusqlite::params_from_iter(params.iter()))
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// 新着 (`status = 'inbox'`) の件数。ホームのカード用
#[tauri::command]
pub async fn db_count_new_videos(state: State<'_, DbState>) -> Result<i64, String> {
    let conn = state.conn_read()?;
    conn.query_row("SELECT COUNT(*) FROM videos WHERE status = 'inbox'", [], |r| r.get(0))
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn db_get_recent_videos(state: State<'_, DbState>, limit: i64) -> Result<Vec<Video>, String> {
    let conn = state.conn_read()?;
    query_videos(&conn, "FROM videos v ORDER BY v.created_at DESC LIMIT ?1", [limit]).map_err(|e| e.to_string())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LastViewedItem {
    pub video: Video,
    pub last_viewed_at: String,
}

#[tauri::command]
pub async fn db_get_last_viewed_video(state: State<'_, DbState>) -> Result<Option<LastViewedItem>, String> {
    let conn = state.conn_read()?;
    conn.query_row(
        &format!(
            "SELECT {VIDEO_COLUMNS}, v.last_viewed_at FROM videos v
             WHERE v.last_viewed_at IS NOT NULL
             ORDER BY v.last_viewed_at DESC
             LIMIT 1"
        ),
        [],
        |r| {
            Ok(LastViewedItem {
                video: video_from_row(r)?,
                last_viewed_at: r.get(VIDEO_COLUMN_COUNT)?,
            })
        },
    )
    .optional()
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn db_update_last_viewed(state: State<'_, DbState>, video_id: i64) -> Result<(), String> {
    let conn = state.conn()?;
    conn.execute(
        &format!("UPDATE videos SET last_viewed_at = CURRENT_TIMESTAMP, {CLEAR_NEW} WHERE id = ?1"),
        [video_id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn db_update_video_thumbnail(
    state: State<'_, DbState>,
    video_id: i64,
    thumbnail: Option<String>,
) -> Result<(), String> {
    let conn = state.conn()?;
    conn.execute(
        "UPDATE videos SET thumbnail = ?1 WHERE id = ?2",
        rusqlite::params![thumbnail, video_id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// 動画の行を消す。タグ付け・プレイリスト・解析結果のキャッシュは外部キーの CASCADE で一緒に消え、
/// グループの代表からは外れる (SET NULL)。まとめて消すときは呼び出し側でトランザクションにする
pub(crate) fn delete_videos(conn: &rusqlite::Connection, ids: &[i64]) -> rusqlite::Result<()> {
    const BATCH: usize = 400;
    for chunk in ids.chunks(BATCH) {
        let ph = vec!["?"; chunk.len()].join(", ");
        conn.execute(&format!("DELETE FROM videos WHERE id IN ({ph})"), rusqlite::params_from_iter(chunk))?;
    }
    Ok(())
}

/// 動画の行を消し、どこからも使われなくなったサムネイルのファイルも消す
fn delete_videos_with_thumbnails(
    app: &tauri::AppHandle,
    conn: &rusqlite::Connection,
    ids: &[i64],
) -> Result<(), String> {
    if ids.is_empty() {
        return Ok(());
    }
    let thumbs = storage::thumbnails_for_ids(conn, ids)?;
    let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
    delete_videos(&tx, ids).map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())?;
    storage::remove_unreferenced_thumbnails(conn, &storage::thumbnail_roots(app), &thumbs);
    Ok(())
}

#[tauri::command]
pub async fn db_delete_video(
    app: tauri::AppHandle,
    state: State<'_, DbState>,
    video_id: i64,
) -> Result<(), String> {
    delete_videos_with_thumbnails(&app, &*state.conn()?, &[video_id])
}

#[tauri::command]
pub async fn db_remove_video(
    app: tauri::AppHandle,
    state: State<'_, DbState>,
    video_id: i64,
) -> Result<(), String> {
    delete_videos_with_thumbnails(&app, &*state.conn()?, &[video_id])
}

#[tauri::command]
pub async fn db_remove_multiple(
    app: tauri::AppHandle,
    state: State<'_, DbState>,
    video_ids: Vec<i64>,
) -> Result<(), String> {
    delete_videos_with_thumbnails(&app, &*state.conn()?, &video_ids)
}

#[tauri::command]
pub async fn db_add_video_from_path(
    state: State<'_, DbState>,
    path: String,
    title: String,
    source_url: Option<String>,
    source_type: Option<String>,
) -> Result<Option<i64>, String> {
    let path = normalize_path_str(&path);
    let media_type = media_type_for_path(&path);
    let st = source_type.as_deref().unwrap_or("download");
    let conn = state.conn()?;
    conn.execute(
        "INSERT OR IGNORE INTO videos (path, title, media_type, source_url, status, source_type) VALUES (?1, ?2, ?3, ?4, 'inbox', ?5)",
        rusqlite::params![path, title, media_type, source_url, st],
    )
    .map_err(|e| e.to_string())?;
    // ウォッチャーが先に行を挿入していた場合、INSERT OR IGNORE は無視されるため
    // source_url が指定されていれば UPDATE で確実に保存する
    if let Some(ref url) = source_url {
        conn.execute(
            "UPDATE videos SET source_url = ?1, source_type = COALESCE(source_type, ?3) WHERE path = ?2",
            rusqlite::params![url, path, st],
        )
        .map_err(|e| e.to_string())?;
    }
    let id: Option<i64> = conn
        .query_row("SELECT id FROM videos WHERE path = ?1", [&path], |r| r.get(0))
        .optional()
        .map_err(|e| e.to_string())?;
    Ok(id)
}

/// 変換元 `source_id` のユーザーが付けた情報を、変換後のファイル `target_id` へ写す。
///
/// 写すもの: タイトル・評価・追加日・カテゴリ・新着かどうか (inbox / active)・視聴履歴
/// (最終視聴・再生位置・視聴回数)・取得元 (source_url / source_type)・タグ・グループとプレイリスト
/// (どちらも元のすぐ後ろ)。
/// 写さないもの: パス・長さ・サムネイル・音声の有無・サイズと、解析キャッシュ (中身が変わるため)。
/// グループの代表は、元ファイルを消すときだけ `take_over_group_cover` で移す
pub(crate) fn inherit_video_metadata(
    conn: &rusqlite::Connection,
    source_id: i64,
    target_id: i64,
) -> Result<(), String> {
    if source_id == target_id {
        return Err("変換元と変換後が同じ動画です".to_string());
    }
    let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
    let updated = tx
        .execute(
            "UPDATE videos SET
                title          = COALESCE(s.title, videos.title),
                rating         = s.rating,
                created_at     = s.created_at,
                category_id    = s.category_id,
                status         = CASE WHEN s.status = 'missing' THEN videos.status ELSE s.status END,
                watched_at     = s.watched_at,
                progress       = s.progress,
                watch_count    = s.watch_count,
                last_viewed_at = s.last_viewed_at,
                source_url     = COALESCE(s.source_url, videos.source_url),
                source_type    = COALESCE(s.source_type, videos.source_type)
             FROM (SELECT * FROM videos WHERE id = ?1) AS s
             WHERE videos.id = ?2",
            rusqlite::params![source_id, target_id],
        )
        .map_err(|e| e.to_string())?;
    if updated == 0 {
        return Err("変換元か変換後の動画がライブラリに見つかりません".to_string());
    }
    tx.execute(
        "INSERT OR IGNORE INTO video_tags (video_id, tag_id)
         SELECT ?2, tag_id FROM video_tags WHERE video_id = ?1",
        rusqlite::params![source_id, target_id],
    )
    .map_err(|e| e.to_string())?;
    db_groups::insert_after(&tx, source_id, target_id).map_err(|e| e.to_string())?;
    insert_after_in_playlists(&tx, source_id, target_id).map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())
}

/// 元が入っているプレイリストそれぞれで、`target_id` を元のすぐ後ろに入れる (後ろの項目は 1 つずつずらす)。
/// すでに入っているプレイリストはそのまま
fn insert_after_in_playlists(
    conn: &rusqlite::Connection,
    source_id: i64,
    target_id: i64,
) -> rusqlite::Result<()> {
    let slots: Vec<(i64, i64)> = {
        let mut stmt = conn.prepare(
            "SELECT playlist_id, COALESCE(position, 0) FROM playlist_items
             WHERE video_id = ?1
               AND playlist_id NOT IN (SELECT playlist_id FROM playlist_items WHERE video_id = ?2)",
        )?;
        let rows = stmt.query_map(rusqlite::params![source_id, target_id], |r| Ok((r.get(0)?, r.get(1)?)))?;
        rows.collect::<rusqlite::Result<_>>()?
    };
    for (playlist_id, pos) in slots {
        conn.execute(
            "UPDATE playlist_items SET position = position + 1 WHERE playlist_id = ?1 AND position > ?2",
            rusqlite::params![playlist_id, pos],
        )?;
        conn.execute(
            "INSERT INTO playlist_items (playlist_id, video_id, position) VALUES (?1, ?2, ?3)",
            rusqlite::params![playlist_id, target_id, pos + 1],
        )?;
    }
    Ok(())
}

/// 元ファイルを消す前に、元がグループの代表なら変換後を代表にする
pub(crate) fn take_over_group_cover(
    conn: &rusqlite::Connection,
    source_id: i64,
    target_id: i64,
) -> Result<(), String> {
    if source_id == target_id {
        return Err("変換元と変換後が同じ動画です".to_string());
    }
    conn.execute(
        "UPDATE media_groups SET cover_video_id = ?2
         WHERE cover_video_id = ?1
           AND EXISTS (SELECT 1 FROM videos WHERE id = ?2 AND group_id = media_groups.id)",
        rusqlite::params![source_id, target_id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn db_inherit_video_metadata(
    state: State<'_, DbState>,
    source_id: i64,
    target_id: i64,
) -> Result<(), String> {
    inherit_video_metadata(&*state.conn()?, source_id, target_id)
}

#[tauri::command]
pub async fn db_take_over_group_cover(
    state: State<'_, DbState>,
    source_id: i64,
    target_id: i64,
) -> Result<(), String> {
    take_over_group_cover(&*state.conn()?, source_id, target_id)
}

#[tauri::command]
pub async fn db_remove_video_by_path(
    app: tauri::AppHandle,
    state: State<'_, DbState>,
    path: String,
) -> Result<(), String> {
    let path = normalize_path_str(&path);
    let conn = state.conn()?;
    let id: Option<i64> = conn
        .query_row("SELECT id FROM videos WHERE path = ?1", [&path], |r| r.get(0))
        .optional()
        .map_err(|e| e.to_string())?;
    match id {
        Some(video_id) => delete_videos_with_thumbnails(&app, &conn, &[video_id]),
        None => Ok(()),
    }
}

/// `path` にある `exclude_id` 以外の行を消す。ファイルウォッチャーが移動先を先に見つけて
/// 別の行を入れていることがあるので、パスを書き換える前に呼ぶ
pub(crate) fn remove_conflicting_videos(
    conn: &rusqlite::Connection,
    path: &str,
    exclude_id: i64,
) -> Result<(), String> {
    conn.execute("DELETE FROM videos WHERE path = ?1 AND id != ?2", rusqlite::params![path, exclude_id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// 動画のパスを変える。行が無ければ false
fn move_video_path(conn: &rusqlite::Connection, video_id: i64, new_path: &str) -> Result<bool, String> {
    let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
    remove_conflicting_videos(&tx, new_path, video_id)?;
    // サイズは測り直す。thumbnail='' (以前の失敗の印) は戻して作り直す対象にする
    let updated = tx.execute(
        "UPDATE videos SET path = ?1, file_size = NULL,
                thumbnail = CASE WHEN thumbnail = '' THEN NULL ELSE thumbnail END
         WHERE id = ?2",
        rusqlite::params![new_path, video_id],
    )
    .map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())?;
    Ok(updated > 0)
}

#[tauri::command]
pub async fn db_update_video_path(
    state: State<'_, DbState>,
    old_path: String,
    new_path: String,
) -> Result<(), String> {
    let old_path = normalize_path_str(&old_path);
    let new_path = normalize_path_str(&new_path);
    let conn = state.conn()?;
    let video_id: Option<i64> = conn
        .query_row("SELECT id FROM videos WHERE path = ?1", [&old_path], |r| r.get(0))
        .optional()
        .map_err(|e| e.to_string())?;
    if let Some(video_id) = video_id {
        move_video_path(&conn, video_id, &new_path)?;
    }
    Ok(())
}

#[tauri::command]
pub async fn db_rename_video_file(
    state: State<'_, DbState>,
    video_id: i64,
    new_path: String,
) -> Result<(), String> {
    let new_path = normalize_path_str(&new_path);
    move_video_path(&*state.conn()?, video_id, &new_path)?;
    Ok(())
}

#[tauri::command]
pub async fn db_move_video_file_db(
    state: State<'_, DbState>,
    video_id: i64,
    new_path: String,
) -> Result<(), String> {
    let new_path = normalize_path_str(&new_path);
    if !move_video_path(&*state.conn()?, video_id, &new_path)? {
        log::warn!("[db_move_video_file_db] video_id={video_id} がデータベースに存在しません");
        return Err(format!("動画 (id={video_id}) がデータベースに存在しません"));
    }
    Ok(())
}

// ── watch dirs ────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn db_add_watch_dir(
    state: State<'_, DbState>,
    path: String,
    use_dir_as_category: bool,
) -> Result<(), String> {
    // パス検証: 絶対パス・パストラバーサル禁止
    super::utils::validate_path(&path)?;
    let path = normalize_path_str(&path);
    // ルートや最上位ディレクトリ (/Volumes, /Users 等) の登録を拒否する。
    // escape_like_dir("/") が空文字になるとウォッチ削除時に全動画が消えるため、
    // パスコンポーネント数が 3 未満 (例: "/" や "/Users") は受け付けない。
    let depth = std::path::Path::new(&path).components().count();
    if depth < 3 {
        return Err(
            "ルートや最上位ディレクトリはウォッチディレクトリに登録できません (少なくとも /a/b/ 以上の深さが必要です)".to_string(),
        );
    }
    let conn = state.conn()?;
    conn.execute(
        "INSERT OR REPLACE INTO watch_dirs (path, use_dir_as_category) VALUES (?1, ?2)",
        rusqlite::params![path, use_dir_as_category as i64],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn db_remove_watch_dir(
    app: tauri::AppHandle,
    state: State<'_, DbState>,
    path: String,
) -> Result<(), String> {
    let path = normalize_path_str(&path);
    let conn = state.conn()?;
    let escaped = escape_like_dir(&path);
    // escape_like_dir("/") は空文字になり LIKE '/%' が全パスにマッチするため、
    // 空文字の場合は即座にエラーとして全動画誤削除を防ぐ。
    if escaped.is_empty() {
        return Err("無効なウォッチディレクトリパスです (ルートパスは指定できません)".to_string());
    }
    // Find all videos under this dir
    let mut stmt_v = conn
        .prepare("SELECT id FROM videos WHERE path LIKE ? ESCAPE '!'")
        .map_err(|e| e.to_string())?;
    let videos: Vec<i64> = stmt_v
        .query_map([format!("{escaped}/%")], |r| r.get(0))
        .map_err(|e| e.to_string())?
        .collect::<rusqlite::Result<_>>()
        .map_err(|e| e.to_string())?;
    delete_videos_with_thumbnails(&app, &conn, &videos)?;
    conn.execute("DELETE FROM watch_dirs WHERE path = ?1", [&path])
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn db_get_watch_dirs(state: State<'_, DbState>) -> Result<Vec<WatchDir>, String> {
    let conn = state.conn_read()?;
    let mut stmt = conn
        .prepare("SELECT path, use_dir_as_category FROM watch_dirs")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |r| {
            Ok(WatchDir {
                path: r.get(0)?,
                use_dir_as_category: r.get(1)?,
            })
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<rusqlite::Result<_>>().map_err(|e| e.to_string())
}

// ── thumbnail / audio batch ───────────────────────────────────────────────────

#[tauri::command]
pub async fn db_get_pending_thumbnails(
    state: State<'_, DbState>,
    limit: i64,
) -> Result<Vec<PendingThumbnail>, String> {
    let conn = state.conn_read()?;
    let mut stmt = conn
        .prepare(
            "SELECT id, path, thumbnail FROM videos
             WHERE thumbnail IS NULL OR has_audio IS NULL
             LIMIT ?1",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([limit], |r| {
            Ok(PendingThumbnail {
                id: r.get(0)?,
                path: r.get(1)?,
                thumbnail: r.get(2)?,
            })
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<rusqlite::Result<_>>().map_err(|e| e.to_string())
}

/// .jpg サムネイルを持つ動画レコードの thumbnail を NULL にリセットする。
/// WebP 移行時に既存 .jpg サムネイルを再生成対象にするために使用する。
#[tauri::command]
pub async fn db_reset_jpg_thumbnails(
    state: State<'_, DbState>,
) -> Result<u32, String> {
    let conn = state.conn()?;
    let count = conn
        .execute(
            "UPDATE videos SET thumbnail = NULL WHERE thumbnail LIKE '%.jpg'",
            [],
        )
        .map_err(|e| e.to_string())?;
    Ok(count as u32)
}

#[tauri::command]
pub async fn db_update_thumbnails_batch(
    state: State<'_, DbState>,
    updates: Vec<ThumbnailUpdate>,
) -> Result<(), String> {
    if updates.is_empty() {
        return Ok(());
    }
    let conn = state.conn()?;

    let when_clause = updates.iter().map(|_| "WHEN ? THEN ?").collect::<Vec<_>>().join(" ");
    let id_ph = updates.iter().map(|_| "?").collect::<Vec<_>>().join(", ");
    let sql = format!(
        "UPDATE videos SET
           thumbnail = CASE id {when_clause} ELSE thumbnail END,
           duration  = CASE id {when_clause} ELSE duration END,
           has_audio = CASE id {when_clause} ELSE has_audio END
         WHERE id IN ({id_ph})"
    );

    let mut params: Vec<rusqlite::types::Value> = Vec::new();
    for u in &updates {
        params.push(rusqlite::types::Value::Integer(u.id));
        match &u.thumbnail {
            Some(t) => params.push(rusqlite::types::Value::Text(t.clone())),
            None => params.push(rusqlite::types::Value::Null),
        }
    }
    for u in &updates {
        params.push(rusqlite::types::Value::Integer(u.id));
        match u.duration {
            Some(d) => params.push(rusqlite::types::Value::Real(d)),
            None => params.push(rusqlite::types::Value::Null),
        }
    }
    for u in &updates {
        params.push(rusqlite::types::Value::Integer(u.id));
        params.push(rusqlite::types::Value::Integer(u.has_audio));
    }
    for u in &updates {
        params.push(rusqlite::types::Value::Integer(u.id));
    }

    conn.execute(&sql, rusqlite::params_from_iter(params.iter()))
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn db_update_audio_only_batch(
    state: State<'_, DbState>,
    updates: Vec<AudioUpdate>,
) -> Result<(), String> {
    if updates.is_empty() {
        return Ok(());
    }
    let conn = state.conn()?;

    let when_clause = updates.iter().map(|_| "WHEN ? THEN ?").collect::<Vec<_>>().join(" ");
    let id_ph = updates.iter().map(|_| "?").collect::<Vec<_>>().join(", ");
    let sql = format!(
        "UPDATE videos SET has_audio = CASE id {when_clause} ELSE has_audio END WHERE id IN ({id_ph})"
    );

    let mut params: Vec<rusqlite::types::Value> = Vec::new();
    for u in &updates {
        params.push(rusqlite::types::Value::Integer(u.id));
        params.push(rusqlite::types::Value::Integer(u.has_audio));
    }
    for u in &updates {
        params.push(rusqlite::types::Value::Integer(u.id));
    }

    conn.execute(&sql, rusqlite::params_from_iter(params.iter()))
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// 指定した動画 ID がフィルタ条件下で何ページ目に位置するかを返す。
/// fetchAllForShuffle による全件 IPC 転送を避けるための専用コマンド。
#[tauri::command]
pub async fn db_find_video_page(
    state: State<'_, DbState>,
    video_id: i64,
    filter: VideoFilter,
) -> Result<Option<i64>, String> {
    if filter.filter_sort_by == "file_size" {
        if let Err(e) = fill_missing_file_sizes(&state) {
            log::warn!("[fill_missing_file_sizes] {e}");
        }
    }
    let conn = state.conn_read()?;
    let (where_clause, params) = build_where_clause(&conn, &filter);
    let source = video_source(&where_clause, filter.filter_collapse_groups);

    let sort_col = sort_column(&filter.filter_sort_by);
    let dir = if filter.filter_sort_order == "asc" { "ASC" } else { "DESC" };

    // ウィンドウ関数 ROW_NUMBER() でフィルタ済み結果内の行番号を取得
    let sql = format!(
        "WITH ranked AS (
           SELECT v.id, ROW_NUMBER() OVER (ORDER BY {sort_col} {dir}) AS rn
           FROM {source}
         )
         SELECT rn FROM ranked WHERE id = ?",
    );

    let mut all_params: Vec<rusqlite::types::Value> = params;
    all_params.push(rusqlite::types::Value::Integer(video_id));

    let rn: Option<i64> = conn
        .query_row(
            &sql,
            rusqlite::params_from_iter(all_params.iter()),
            |r| r.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?;

    Ok(rn.map(|n| (n - 1) / filter.page_size + 1))
}

#[tauri::command]
pub async fn db_get_random_video(state: State<'_, DbState>) -> Result<Vec<Video>, String> {
    let conn = state.conn_read()?;
    query_videos(
        &conn,
        "FROM videos v WHERE v.media_type != 'image' AND v.status != 'missing' ORDER BY RANDOM() LIMIT 5",
        [],
    )
    .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use rusqlite::Connection;
    use super::{delete_videos, inherit_video_metadata, move_video_path, take_over_group_cover};
    use crate::db::schema::init_db;

    fn setup() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        init_db(&conn).unwrap();
        conn
    }

    fn insert_video(conn: &Connection, path: &str) -> i64 {
        conn.execute(
            "INSERT INTO videos (path, status) VALUES (?1, 'active')",
            [path],
        )
        .unwrap();
        conn.last_insert_rowid()
    }

    fn insert_tag(conn: &Connection, name: &str) -> i64 {
        conn.execute("INSERT INTO tags (name) VALUES (?1)", [name]).unwrap();
        conn.last_insert_rowid()
    }

    fn insert_playlist(conn: &Connection, name: &str) -> i64 {
        conn.execute("INSERT INTO playlists (name) VALUES (?1)", [name]).unwrap();
        conn.last_insert_rowid()
    }

    fn count_rows(conn: &Connection, table: &str) -> i64 {
        conn.query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |r| r.get(0))
            .unwrap()
    }

    // ── delete_videos / move_video_path ──────────────────────────────────────

    #[test]
    fn delete_videos_cascades_to_tags_playlists_and_caches() {
        let conn = setup();
        let v1 = insert_video(&conn, "/tmp/m1.mp4");
        let v2 = insert_video(&conn, "/tmp/m2.mp4");
        let v3 = insert_video(&conn, "/tmp/m3.mp4");
        let tag = insert_tag(&conn, "comedy");
        let pl = insert_playlist(&conn, "My List");
        for v in [v1, v2, v3] {
            conn.execute("INSERT INTO video_tags VALUES (?1, ?2)", [v, tag]).unwrap();
            conn.execute("INSERT INTO playlist_items VALUES (?1, ?2, 0)", [pl, v]).unwrap();
            conn.execute("INSERT INTO media_phash VALUES (?1, '1')", [v]).unwrap();
        }

        delete_videos(&conn, &[v1, v2, 9999]).unwrap();

        let remaining: i64 = conn.query_row("SELECT id FROM videos", [], |r| r.get(0)).unwrap();
        assert_eq!(remaining, v3);
        assert_eq!(count_rows(&conn, "video_tags"), 1);
        assert_eq!(count_rows(&conn, "playlist_items"), 1);
        assert_eq!(count_rows(&conn, "media_phash"), 1);
        delete_videos(&conn, &[]).unwrap();
        assert_eq!(count_rows(&conn, "videos"), 1);
    }

    #[test]
    fn delete_videos_handles_more_than_one_batch() {
        let conn = setup();
        let ids: Vec<i64> = (0..450).map(|i| insert_video(&conn, &format!("/tmp/{i}.mp4"))).collect();
        delete_videos(&conn, &ids).unwrap();
        assert_eq!(count_rows(&conn, "videos"), 0);
    }

    #[test]
    fn move_video_path_replaces_row_already_at_destination() {
        let conn = setup();
        let moved = insert_video(&conn, "/tmp/old.mp4");
        insert_video(&conn, "/tmp/new.mp4"); // ウォッチャーが先に入れた行
        conn.execute("UPDATE videos SET thumbnail = '', file_size = 10 WHERE id = ?1", [moved]).unwrap();

        assert!(move_video_path(&conn, moved, "/tmp/new.mp4").unwrap());

        let (id, thumb, size): (i64, Option<String>, Option<i64>) = conn
            .query_row("SELECT id, thumbnail, file_size FROM videos", [], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))
            .unwrap();
        assert_eq!(count_rows(&conn, "videos"), 1);
        assert_eq!((id, thumb, size), (moved, None, None));
        assert!(!move_video_path(&conn, 9999, "/tmp/x.mp4").unwrap());
    }

    // ── cascade behavior ────────────────────────────────────────────────────────

    #[test]
    fn deleting_tag_cascades_video_tags() {
        let conn = setup();
        let vid = insert_video(&conn, "/tmp/tagged.mp4");
        let tag = insert_tag(&conn, "sci-fi");
        conn.execute("INSERT INTO video_tags VALUES (?1, ?2)", [vid, tag]).unwrap();
        assert_eq!(count_rows(&conn, "video_tags"), 1);

        conn.execute("DELETE FROM tags WHERE id = ?1", [tag]).unwrap();
        assert_eq!(count_rows(&conn, "video_tags"), 0);
        // Video itself should still exist
        assert_eq!(count_rows(&conn, "videos"), 1);
    }

    #[test]
    fn deleting_playlist_cascades_playlist_items() {
        let conn = setup();
        let vid = insert_video(&conn, "/tmp/inlist.mp4");
        let pl = insert_playlist(&conn, "Cascade Test");
        conn.execute(
            "INSERT INTO playlist_items (playlist_id, video_id, position) VALUES (?1, ?2, 1)",
            [pl, vid],
        )
        .unwrap();
        assert_eq!(count_rows(&conn, "playlist_items"), 1);

        conn.execute("DELETE FROM playlists WHERE id = ?1", [pl]).unwrap();
        assert_eq!(count_rows(&conn, "playlist_items"), 0);
        // Video itself should still exist
        assert_eq!(count_rows(&conn, "videos"), 1);
    }

    // ── db_add_video_from_path ─────────────────────────────────────────────────

    #[test]
    fn add_video_from_path_inserts_row() {
        let conn = setup();
        conn.execute(
            "INSERT OR IGNORE INTO videos (path, title, media_type, source_url, status, source_type)
             VALUES (?1, ?2, ?3, ?4, 'inbox', ?5)",
            rusqlite::params!["/tmp/new.mp4", "New Video", "video", Option::<String>::None, "local"],
        )
        .unwrap();
        assert_eq!(count_rows(&conn, "videos"), 1);
        let title: String = conn
            .query_row("SELECT title FROM videos WHERE path = '/tmp/new.mp4'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(title, "New Video");
    }

    #[test]
    fn add_video_from_path_duplicate_is_ignored() {
        let conn = setup();
        let sql = "INSERT OR IGNORE INTO videos (path, title, media_type, status, source_type)
                   VALUES (?1, ?2, 'video', 'inbox', 'local')";
        conn.execute(sql, rusqlite::params!["/tmp/dup.mp4", "First"]).unwrap();
        conn.execute(sql, rusqlite::params!["/tmp/dup.mp4", "Second"]).unwrap();
        assert_eq!(count_rows(&conn, "videos"), 1);
        let title: String = conn
            .query_row("SELECT title FROM videos WHERE path = '/tmp/dup.mp4'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(title, "First"); // Second was ignored
    }

    // ── watch_dir operations ───────────────────────────────────────────────────

    #[test]
    fn add_and_remove_watch_dir() {
        let conn = setup();
        conn.execute(
            "INSERT OR IGNORE INTO watch_dirs (path, use_dir_as_category) VALUES (?1, 0)",
            ["/media/videos"],
        )
        .unwrap();
        assert_eq!(count_rows(&conn, "watch_dirs"), 1);

        conn.execute("DELETE FROM watch_dirs WHERE path = ?1", ["/media/videos"]).unwrap();
        assert_eq!(count_rows(&conn, "watch_dirs"), 0);
    }

    #[test]
    fn add_duplicate_watch_dir_is_ignored() {
        let conn = setup();
        let sql = "INSERT OR IGNORE INTO watch_dirs (path, use_dir_as_category) VALUES (?1, 0)";
        conn.execute(sql, ["/media/videos"]).unwrap();
        conn.execute(sql, ["/media/videos"]).unwrap();
        assert_eq!(count_rows(&conn, "watch_dirs"), 1);
    }

    // ── fill_missing_file_sizes / sort_column ─────────────────────────────────

    #[test]
    fn sort_column_maps_file_size_and_falls_back_to_created_at() {
        assert_eq!(super::sort_column("file_size"), "COALESCE(v.file_size, -1)");
        assert_eq!(super::sort_column("unknown; DROP TABLE videos"), "v.created_at");
    }

    #[test]
    fn fill_missing_file_sizes_stores_size_and_skips_missing_files() {
        let dir = std::env::temp_dir().join(format!(
            "css-filesize-test-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        let db_path = dir.join("test.db");
        let media = dir.join("a.mp4");
        std::fs::write(&media, vec![0u8; 1234]).unwrap();

        let writer = Connection::open(&db_path).unwrap();
        init_db(&writer).unwrap();
        let existing = insert_video(&writer, media.to_str().unwrap());
        let missing = insert_video(&writer, dir.join("nope.mp4").to_str().unwrap());
        let reader = Connection::open(&db_path).unwrap();
        let state = crate::db::DbState {
            writer: std::sync::Mutex::new(writer),
            reader: std::sync::Mutex::new(reader),
        };

        super::fill_missing_file_sizes(&state).unwrap();

        let conn = state.conn().unwrap();
        let size_of = |id: i64| -> Option<i64> {
            conn.query_row("SELECT file_size FROM videos WHERE id = ?1", [id], |r| r.get(0))
                .unwrap()
        };
        assert_eq!(size_of(existing), Some(1234));
        assert_eq!(size_of(missing), None);
        drop(conn);
        drop(state);
        let _ = std::fs::remove_dir_all(&dir);
    }

    // ── filter_av1 ───────────────────────────────────────────────────────────

    fn filtered_paths(conn: &Connection, av1: &str) -> Vec<String> {
        filtered_paths_with(conn, serde_json::json!({ "filterAv1": av1 }))
    }

    /// 既定の条件に `overrides` を重ねて絞り込む
    fn filtered_paths_with(conn: &Connection, overrides: serde_json::Value) -> Vec<String> {
        let mut json = serde_json::json!({
            "filterSearch": "", "filterCategoryId": null, "filterTagIds": [],
            "filterTagMode": "and", "filterMinRating": 0, "filterHasAudio": null,
            "filterMinDuration": 0.0, "filterMaxDuration": null, "filterWatchedStatus": "all",
            "filterWatchDir": null, "filterMediaType": "all", "filterAv1": "all",
            "filterSortBy": "created_at", "filterSortOrder": "asc",
            "currentPage": 1, "pageSize": 100,
        });
        for (k, v) in overrides.as_object().unwrap() {
            json[k] = v.clone();
        }
        let filter: super::VideoFilter = serde_json::from_value(json).unwrap();
        let (where_clause, params) = super::build_where_clause(conn, &filter);
        let mut stmt = conn
            .prepare(&format!("SELECT v.path FROM videos v {where_clause} ORDER BY v.id"))
            .unwrap();
        stmt.query_map(rusqlite::params_from_iter(params), |r| r.get(0))
            .unwrap()
            .collect::<Result<_, _>>()
            .unwrap()
    }

    #[test]
    fn filter_av1_matches_transcode_output_names() {
        let conn = setup();
        for p in ["/v/a.mp4", "/v/a.av1.mkv", "/v/b.av1_2.mkv", "/v/C.AV1.MKV", "/v/av1.mkv", "/v/x.av1.mkv.part"] {
            insert_video(&conn, p);
        }
        assert_eq!(filtered_paths(&conn, "only"), ["/v/a.av1.mkv", "/v/b.av1_2.mkv", "/v/C.AV1.MKV"]);
        assert_eq!(filtered_paths(&conn, "exclude"), ["/v/a.mp4", "/v/av1.mkv", "/v/x.av1.mkv.part"]);
        assert_eq!(filtered_paths(&conn, "all").len(), 6);
    }

    #[test]
    fn filter_new_only_selects_unopened_items() {
        let conn = setup();
        for (p, status) in [("/v/new.mp4", "inbox"), ("/v/seen.mp4", "active"), ("/v/gone.mp4", "missing")] {
            let id = insert_video(&conn, p);
            conn.execute("UPDATE videos SET status = ?1 WHERE id = ?2", rusqlite::params![status, id]).unwrap();
        }
        assert_eq!(filtered_paths_with(&conn, serde_json::json!({ "filterNewOnly": true })), ["/v/new.mp4"]);
        // 省いたら絞り込まない (保存済みのスマートプレイリストなど)
        assert_eq!(filtered_paths_with(&conn, serde_json::json!({})).len(), 3);
    }

    #[test]
    fn clear_new_only_touches_new_items() {
        let conn = setup();
        let mut ids = Vec::new();
        for (p, status) in [("/v/new.mp4", "inbox"), ("/v/seen.mp4", "active"), ("/v/gone.mp4", "missing")] {
            let id = insert_video(&conn, p);
            conn.execute("UPDATE videos SET status = ?1 WHERE id = ?2", rusqlite::params![status, id]).unwrap();
            ids.push(id);
        }
        for &id in &ids {
            conn.execute(&format!("UPDATE videos SET {} WHERE id = ?1", super::CLEAR_NEW), [id]).unwrap();
        }
        let statuses: Vec<String> = ids
            .iter()
            .map(|&id| conn.query_row("SELECT status FROM videos WHERE id = ?1", [id], |r| r.get(0)).unwrap())
            .collect();
        assert_eq!(statuses, ["active", "active", "missing"]);
    }

    #[test]
    fn filter_has_audio_can_select_silent_tracks() {
        let conn = setup();
        for (p, has_audio, silence) in [
            ("/v/loud.mp4", Some(1), Some("none")),
            ("/v/all.mp4", Some(1), Some("all")),
            ("/v/part.mp4", Some(1), Some("partial")),
            ("/v/unchecked.mp4", Some(1), None),
            ("/v/mute.mp4", Some(0), None),
        ] {
            let id = insert_video(&conn, p);
            conn.execute("UPDATE videos SET has_audio = ?1 WHERE id = ?2", rusqlite::params![has_audio, id])
                .unwrap();
            if let Some(silence) = silence {
                conn.execute(
                    "INSERT INTO media_silent_audio (video_id, silence) VALUES (?1, ?2)",
                    rusqlite::params![id, silence],
                )
                .unwrap();
            }
        }
        let with = |v: i64| filtered_paths_with(&conn, serde_json::json!({ "filterHasAudio": v }));
        assert_eq!(with(2), ["/v/all.mp4", "/v/part.mp4"]);
        assert_eq!(with(1).len(), 4, "音声ありは従来どおりトラックの有無で選ぶ");
        assert_eq!(with(0), ["/v/mute.mp4"]);
    }

    #[test]
    fn collapse_groups_keeps_one_representative_per_group() {
        use super::super::db_groups::{create_group, KIND_SERIES};
        let conn = setup();
        let a = insert_video(&conn, "/v/ep1.mp4");
        let b = insert_video(&conn, "/v/ep2.mp4");
        let c = insert_video(&conn, "/v/ep3.mp4");
        insert_video(&conn, "/v/solo.mp4");
        let g = create_group(&conn, "show", KIND_SERIES, &[a, b, c]).unwrap();
        let collapsed = |conn: &Connection, extra: &str| -> Vec<String> {
            let mut json = serde_json::json!({
                "filterSearch": extra, "filterCategoryId": null, "filterTagIds": [],
                "filterTagMode": "and", "filterMinRating": 0, "filterHasAudio": null,
                "filterMinDuration": 0.0, "filterMaxDuration": null, "filterWatchedStatus": "all",
                "filterWatchDir": null, "filterMediaType": "all",
                "filterSortBy": "created_at", "filterSortOrder": "asc",
                "currentPage": 1, "pageSize": 100,
            });
            json["filterCollapseGroups"] = serde_json::json!(true);
            let filter: super::VideoFilter = serde_json::from_value(json).unwrap();
            let (where_clause, params) = super::build_where_clause(conn, &filter);
            let source = super::video_source(&where_clause, true);
            let mut stmt = conn.prepare(&format!("SELECT v.path FROM {source} ORDER BY v.id")).unwrap();
            stmt.query_map(rusqlite::params_from_iter(params), |r| r.get(0))
                .unwrap()
                .collect::<Result<_, _>>()
                .unwrap()
        };
        assert_eq!(collapsed(&conn, ""), ["/v/ep1.mp4", "/v/solo.mp4"], "並び順で最初のものが代表");
        conn.execute("UPDATE media_groups SET cover_video_id = ?1 WHERE id = ?2", [c, g]).unwrap();
        assert_eq!(collapsed(&conn, ""), ["/v/ep3.mp4", "/v/solo.mp4"], "代表を決めればそれを出す");
        assert_eq!(collapsed(&conn, "ep2"), ["/v/ep2.mp4"], "代表が条件に合わなければ合うものを出す");
    }

    #[test]
    fn filter_av1_defaults_to_all_when_missing() {
        let filter: super::VideoFilter = serde_json::from_value(serde_json::json!({
            "filterSearch": "", "filterCategoryId": null, "filterTagIds": [],
            "filterTagMode": "and", "filterMinRating": 0, "filterHasAudio": null,
            "filterMinDuration": 0.0, "filterMaxDuration": null, "filterWatchedStatus": "all",
            "filterWatchDir": null, "filterMediaType": "all",
            "filterSortBy": "created_at", "filterSortOrder": "asc",
            "currentPage": 1, "pageSize": 100,
        }))
        .unwrap();
        assert_eq!(filter.filter_av1, "all");
    }

    #[test]
    fn transcoded_copy_inherits_metadata_tags_and_group_slot() {
        let conn = setup();
        let a = insert_video(&conn, "/m/ep1.mp4");
        let src = insert_video(&conn, "/m/ep2.mp4");
        let c = insert_video(&conn, "/m/ep3.mp4");
        conn.execute("INSERT INTO categories (name) VALUES ('cat')", []).unwrap();
        let cat = conn.last_insert_rowid();
        conn.execute(
            "UPDATE videos SET title = 'Ep 2', rating = 4, created_at = '2020-01-01 00:00:00', category_id = ?2,
                    watched_at = '2024-05-01', progress = 12.5, watch_count = 3, last_viewed_at = '2024-05-02',
                    source_url = 'https://example.com/v', source_type = 'import'
             WHERE id = ?1",
            rusqlite::params![src, cat],
        ).unwrap();
        let tag = insert_tag(&conn, "t");
        conn.execute("INSERT INTO video_tags (video_id, tag_id) VALUES (?1, ?2)", [src, tag]).unwrap();
        let gid = super::db_groups::create_group(&conn, "S", "series", &[a, src, c]).unwrap();
        conn.execute(
            "INSERT INTO videos (path, title, status, source_type) VALUES ('/m/ep2.av1.mkv', 'ep2', 'inbox', 'download')",
            [],
        ).unwrap();
        let dst = conn.last_insert_rowid();

        inherit_video_metadata(&conn, src, dst).unwrap();

        let row: (String, i64, String, i64, String, f64, i64, String, String, String) = conn.query_row(
            "SELECT title, rating, created_at, category_id, status, progress, watch_count, last_viewed_at, source_url, source_type
             FROM videos WHERE id = ?1",
            [dst],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?, r.get(6)?, r.get(7)?, r.get(8)?, r.get(9)?)),
        ).unwrap();
        assert_eq!(row, ("Ep 2".into(), 4, "2020-01-01 00:00:00".into(), cat, "active".into(), 12.5, 3,
                         "2024-05-02".into(), "https://example.com/v".into(), "import".into()));
        let tags: i64 = conn.query_row("SELECT COUNT(*) FROM video_tags WHERE video_id = ?1", [dst], |r| r.get(0)).unwrap();
        assert_eq!(tags, 1);
        let members: Vec<i64> = super::db_groups::get_group(&conn, gid).unwrap().unwrap()
            .members.into_iter().map(|v| v.id).collect();
        assert_eq!(members, vec![a, src, dst, c]);
    }

    #[test]
    fn transcoded_copy_joins_playlists_right_after_source_and_takes_over_cover() {
        let conn = setup();
        let other = insert_video(&conn, "/m/a.mp4");
        let src = insert_video(&conn, "/m/b.mp4");
        let dst = insert_video(&conn, "/m/b.av1.mkv");
        let pl = insert_playlist(&conn, "p");
        conn.execute("INSERT INTO playlist_items VALUES (?1, ?2, 1)", [pl, other]).unwrap();
        conn.execute("INSERT INTO playlist_items VALUES (?1, ?2, 2)", [pl, src]).unwrap();
        let last = insert_video(&conn, "/m/c.mp4");
        conn.execute("INSERT INTO playlist_items VALUES (?1, ?2, 3)", [pl, last]).unwrap();
        let gid = super::db_groups::create_group(&conn, "g", "variants", &[other, src]).unwrap();
        conn.execute("UPDATE media_groups SET cover_video_id = ?1 WHERE id = ?2", [src, gid]).unwrap();

        inherit_video_metadata(&conn, src, dst).unwrap();
        let order = |conn: &Connection| -> Vec<i64> {
            let mut stmt = conn
                .prepare("SELECT video_id FROM playlist_items WHERE playlist_id = ?1 ORDER BY position")
                .unwrap();
            stmt.query_map([pl], |r| r.get(0)).unwrap().map(|r| r.unwrap()).collect()
        };
        // 元を残しても、元のすぐ後ろに入る
        assert_eq!(order(&conn), vec![other, src, dst, last]);
        // もう一度呼んでも二重には入らない
        inherit_video_metadata(&conn, src, dst).unwrap();
        assert_eq!(order(&conn), vec![other, src, dst, last]);

        take_over_group_cover(&conn, src, dst).unwrap();
        delete_videos(&conn, &[src]).unwrap();
        assert_eq!(order(&conn), vec![other, dst, last]);
        let cover: Option<i64> = conn.query_row(
            "SELECT cover_video_id FROM media_groups WHERE id = ?1", [gid], |r| r.get(0),
        ).unwrap();
        assert_eq!(cover, Some(dst));
    }
}
