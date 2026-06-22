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
    pub watched_count: i64,
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
    let conn = state.0.lock().map_err(|e| e.to_string())?;

    let total_videos: i64 = conn
        .query_row("SELECT COUNT(*) FROM videos", [], |r| r.get(0))
        .map_err(|e| e.to_string())?;

    let watched_count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM videos WHERE watched_at IS NOT NULL",
            [],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;

    let total_duration_sec: f64 = conn
        .query_row(
            "SELECT COALESCE(SUM(duration), 0) FROM videos",
            [],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;

    let avg_rating: f64 = conn
        .query_row(
            "SELECT COALESCE(AVG(NULLIF(rating, 0)), 0) FROM videos",
            [],
            |r| r.get(0),
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
        watched_count,
        total_duration_sec,
        avg_rating,
        category_stats,
        top_rated,
        recently_watched,
        top_watched,
        top_tags,
    })
}
