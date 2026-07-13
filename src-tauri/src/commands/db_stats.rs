use serde::Serialize;
use tauri::State;

use crate::db::DbState;

#[derive(Serialize)]
pub struct CategoryStat {
    pub name: String,
    pub count: i64,
}

#[derive(Serialize)]
pub struct TopRated {
    pub title: Option<String>,
    pub path: String,
    pub rating: i64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecentlyWatched {
    pub title: Option<String>,
    pub path: String,
    pub watched_at: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TopWatched {
    pub title: Option<String>,
    pub path: String,
    pub watch_count: i64,
}

#[derive(Serialize)]
pub struct TopTag {
    pub name: String,
    pub count: i64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryStats {
    pub total_videos: i64,
    pub image_count: i64,
    pub video_count: i64,
    pub watched_count: i64,
    pub today_added: i64,
    pub today_watched: i64,
    pub total_duration_sec: f64,
    pub avg_rating: f64,
    pub category_stats: Vec<CategoryStat>,
    pub top_rated: Vec<TopRated>,
    pub recently_watched: Vec<RecentlyWatched>,
    pub top_watched: Vec<TopWatched>,
    pub top_tags: Vec<TopTag>,
}

#[tauri::command]
pub async fn db_get_library_stats(state: State<'_, DbState>) -> Result<LibraryStats, String> {
    let conn = state.conn_read()?;

    // 8本の独立クエリを1本の集計クエリに統合。
    // today_added/today_watched は datetime(..., 'utc') による範囲比較で
    // idx_videos_created_at / idx_videos_watched_at を活用できる。
    let (total_videos, image_count, video_count, watched_count,
         total_duration_sec, avg_rating, today_added, today_watched): (i64, i64, i64, i64, f64, f64, i64, i64) = conn
        .query_row(
            "SELECT
               COUNT(*),
               SUM(CASE WHEN media_type = 'image' THEN 1 ELSE 0 END),
               SUM(CASE WHEN media_type IS NULL OR media_type != 'image' THEN 1 ELSE 0 END),
               SUM(CASE WHEN watched_at IS NOT NULL THEN 1 ELSE 0 END),
               COALESCE(SUM(duration), 0),
               COALESCE(AVG(NULLIF(rating, 0)), 0),
               SUM(CASE WHEN created_at >= datetime(date('now', 'localtime'), 'utc')
                         AND created_at <  datetime(date('now', '+1 day', 'localtime'), 'utc')
                    THEN 1 ELSE 0 END),
               SUM(CASE WHEN watched_at IS NOT NULL
                         AND watched_at >= datetime(date('now', 'localtime'), 'utc')
                         AND watched_at <  datetime(date('now', '+1 day', 'localtime'), 'utc')
                    THEN 1 ELSE 0 END)
             FROM videos",
            [],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?,
                    r.get(4)?, r.get(5)?, r.get::<_, Option<i64>>(6)?.unwrap_or(0),
                    r.get::<_, Option<i64>>(7)?.unwrap_or(0))),
        )
        .map_err(|e| e.to_string())?;

    let category_stats = {
        let mut stmt = conn
            .prepare(
                "SELECT c.name, COUNT(v.id) as count
                 FROM categories c JOIN videos v ON v.category_id = c.id
                 GROUP BY c.id ORDER BY count DESC LIMIT 10",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |r| Ok(CategoryStat { name: r.get(0)?, count: r.get(1)? }))
            .map_err(|e| e.to_string())?;
        rows.collect::<rusqlite::Result<Vec<_>>>()
            .map_err(|e| e.to_string())?
    };

    let top_rated = {
        let mut stmt = conn
            .prepare(
                "SELECT title, path, rating FROM videos
                 WHERE rating > 0 ORDER BY rating DESC, watched_at DESC LIMIT 5",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |r| {
                Ok(TopRated { title: r.get(0)?, path: r.get(1)?, rating: r.get(2)? })
            })
            .map_err(|e| e.to_string())?;
        rows.collect::<rusqlite::Result<Vec<_>>>()
            .map_err(|e| e.to_string())?
    };

    let recently_watched = {
        let mut stmt = conn
            .prepare(
                "SELECT title, path, watched_at FROM videos
                 WHERE watched_at IS NOT NULL ORDER BY watched_at DESC LIMIT 5",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |r| {
                Ok(RecentlyWatched {
                    title: r.get(0)?,
                    path: r.get(1)?,
                    watched_at: r.get(2)?,
                })
            })
            .map_err(|e| e.to_string())?;
        rows.collect::<rusqlite::Result<Vec<_>>>()
            .map_err(|e| e.to_string())?
    };

    let top_watched = {
        let mut stmt = conn
            .prepare(
                "SELECT title, path, COALESCE(watch_count, 0) as wc FROM videos
                 WHERE COALESCE(watch_count, 0) > 0 ORDER BY wc DESC LIMIT 5",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |r| {
                Ok(TopWatched { title: r.get(0)?, path: r.get(1)?, watch_count: r.get(2)? })
            })
            .map_err(|e| e.to_string())?;
        rows.collect::<rusqlite::Result<Vec<_>>>()
            .map_err(|e| e.to_string())?
    };

    let top_tags = {
        let mut stmt = conn
            .prepare(
                "SELECT t.name, COUNT(vt.video_id) as count
                 FROM tags t JOIN video_tags vt ON t.id = vt.tag_id
                 GROUP BY t.id ORDER BY count DESC LIMIT 10",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |r| Ok(TopTag { name: r.get(0)?, count: r.get(1)? }))
            .map_err(|e| e.to_string())?;
        rows.collect::<rusqlite::Result<Vec<_>>>()
            .map_err(|e| e.to_string())?
    };

    Ok(LibraryStats {
        total_videos,
        image_count,
        video_count,
        watched_count,
        today_added,
        today_watched,
        total_duration_sec,
        avg_rating,
        category_stats,
        top_rated,
        recently_watched,
        top_watched,
        top_tags,
    })
}
