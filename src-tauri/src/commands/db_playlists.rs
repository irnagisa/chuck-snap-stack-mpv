use serde::{Deserialize, Serialize};
use tauri::State;

use crate::db::DbState;

#[derive(Serialize, Deserialize)]
pub struct Playlist {
    pub id: i64,
    pub name: String,
    pub created_at: String,
}

#[derive(Serialize, Deserialize)]
pub struct SmartPlaylist {
    pub id: i64,
    pub name: String,
    pub filter_json: String,
    pub created_at: String,
}

// Re-export Video for playlist video queries
use crate::commands::db_videos::Video;

// ── playlists ─────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn db_fetch_playlists(state: State<'_, DbState>) -> Result<Vec<Playlist>, String> {
    let conn = state.conn()?;
    let mut stmt = conn
        .prepare("SELECT id, name, created_at FROM playlists ORDER BY created_at DESC")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |r| {
            Ok(Playlist {
                id: r.get(0)?,
                name: r.get(1)?,
                created_at: r.get(2)?,
            })
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<rusqlite::Result<_>>().map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn db_create_playlist(state: State<'_, DbState>, name: String) -> Result<(), String> {
    let conn = state.conn()?;
    conn.execute("INSERT INTO playlists (name) VALUES (?1)", [&name])
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn db_delete_playlist(state: State<'_, DbState>, id: i64) -> Result<(), String> {
    let conn = state.conn()?;
    conn.execute("DELETE FROM playlist_items WHERE playlist_id = ?1", [id])
        .map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM playlists WHERE id = ?1", [id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn db_fetch_playlist_videos(
    state: State<'_, DbState>,
    playlist_id: i64,
) -> Result<Vec<Video>, String> {
    let conn = state.conn()?;
    let mut stmt = conn
        .prepare(
            "SELECT v.id, v.path, v.title, v.duration, v.thumbnail, v.watched_at,
                    v.progress, v.rating, v.category_id, v.has_audio, v.watch_count,
                    v.created_at, v.media_type, v.source_url
             FROM videos v
             JOIN playlist_items pi ON v.id = pi.video_id
             WHERE pi.playlist_id = ?1
             ORDER BY pi.position ASC",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([playlist_id], video_from_row)
        .map_err(|e| e.to_string())?;
    rows.collect::<rusqlite::Result<_>>().map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn db_add_video_to_playlist(
    state: State<'_, DbState>,
    playlist_id: i64,
    video_id: i64,
) -> Result<(), String> {
    let conn = state.conn()?;
    conn.execute(
        "INSERT OR IGNORE INTO playlist_items (playlist_id, video_id, position)
         SELECT ?1, ?2, COALESCE(MAX(position), 0) + 1 FROM playlist_items WHERE playlist_id = ?1",
        [playlist_id, video_id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn db_remove_video_from_playlist(
    state: State<'_, DbState>,
    playlist_id: i64,
    video_id: i64,
) -> Result<(), String> {
    let conn = state.conn()?;
    conn.execute(
        "DELETE FROM playlist_items WHERE playlist_id = ?1 AND video_id = ?2",
        [playlist_id, video_id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn db_reorder_playlist_items(
    state: State<'_, DbState>,
    playlist_id: i64,
    video_ids: Vec<i64>,
) -> Result<(), String> {
    let conn = state.conn()?;
    for (i, &vid) in video_ids.iter().enumerate() {
        conn.execute(
            "UPDATE playlist_items SET position = ?1 WHERE playlist_id = ?2 AND video_id = ?3",
            rusqlite::params![(i + 1) as i64, playlist_id, vid],
        )
        .map_err(|e| e.to_string())?;
    }
    Ok(())
}

// ── smart playlists ───────────────────────────────────────────────────────────

#[tauri::command]
pub async fn db_get_smart_playlists(
    state: State<'_, DbState>,
) -> Result<Vec<SmartPlaylist>, String> {
    let conn = state.conn()?;
    let mut stmt = conn
        .prepare(
            "SELECT id, name, filter_json, created_at FROM smart_playlists ORDER BY created_at DESC",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |r| {
            Ok(SmartPlaylist {
                id: r.get(0)?,
                name: r.get(1)?,
                filter_json: r.get(2)?,
                created_at: r.get(3)?,
            })
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<rusqlite::Result<_>>().map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn db_create_smart_playlist(
    state: State<'_, DbState>,
    name: String,
    filter_json: String,
) -> Result<SmartPlaylist, String> {
    let conn = state.conn()?;
    conn.execute(
        "INSERT INTO smart_playlists (name, filter_json) VALUES (?1, ?2)",
        rusqlite::params![name, filter_json],
    )
    .map_err(|e| e.to_string())?;
    let id = conn.last_insert_rowid();
    let created_at = conn
        .query_row(
            "SELECT created_at FROM smart_playlists WHERE id = ?1",
            [id],
            |r| r.get::<_, String>(0),
        )
        .map_err(|e| e.to_string())?;
    Ok(SmartPlaylist { id, name, filter_json, created_at })
}

#[tauri::command]
pub async fn db_delete_smart_playlist(
    state: State<'_, DbState>,
    id: i64,
) -> Result<(), String> {
    let conn = state.conn()?;
    conn.execute("DELETE FROM smart_playlists WHERE id = ?1", [id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

// ── helpers ───────────────────────────────────────────────────────────────────

fn video_from_row(r: &rusqlite::Row<'_>) -> rusqlite::Result<Video> {
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
    })
}
