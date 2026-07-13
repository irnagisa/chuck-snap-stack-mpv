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
    let conn = state.conn_read()?;
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
    let conn = state.conn_read()?;
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
    let conn = state.conn_read()?;
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
        status: None,
        source_type: None,
    })
}

#[cfg(test)]
mod tests {
    use rusqlite::Connection;
    use crate::db::schema::init_db;

    fn setup() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        init_db(&conn).unwrap();
        conn
    }

    fn count_rows(conn: &Connection, table: &str) -> i64 {
        conn.query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |r| r.get(0))
            .unwrap()
    }

    fn insert_video(conn: &Connection, path: &str) -> i64 {
        conn.execute(
            "INSERT INTO videos (path, status) VALUES (?1, 'active')",
            [path],
        )
        .unwrap();
        conn.last_insert_rowid()
    }

    fn insert_playlist(conn: &Connection, name: &str) -> i64 {
        conn.execute("INSERT INTO playlists (name) VALUES (?1)", [name]).unwrap();
        conn.last_insert_rowid()
    }

    // ── playlist CRUD ──────────────────────────────────────────────────────────

    #[test]
    fn create_playlist() {
        let conn = setup();
        insert_playlist(&conn, "Favorites");
        assert_eq!(count_rows(&conn, "playlists"), 1);
    }

    #[test]
    fn delete_playlist_explicit_removes_items_first() {
        let conn = setup();
        let vid = insert_video(&conn, "/tmp/v.mp4");
        let pl = insert_playlist(&conn, "To Watch");
        conn.execute(
            "INSERT INTO playlist_items (playlist_id, video_id, position) VALUES (?1, ?2, 1)",
            [pl, vid],
        )
        .unwrap();
        assert_eq!(count_rows(&conn, "playlist_items"), 1);

        // Simulate db_delete_playlist: delete items, then playlist
        conn.execute("DELETE FROM playlist_items WHERE playlist_id = ?1", [pl]).unwrap();
        conn.execute("DELETE FROM playlists WHERE id = ?1", [pl]).unwrap();

        assert_eq!(count_rows(&conn, "playlists"), 0);
        assert_eq!(count_rows(&conn, "playlist_items"), 0);
        assert_eq!(count_rows(&conn, "videos"), 1); // video survives
    }

    #[test]
    fn delete_playlist_cascade_removes_items() {
        let conn = setup();
        let vid = insert_video(&conn, "/tmp/v2.mp4");
        let pl = insert_playlist(&conn, "Cascade Test");
        conn.execute(
            "INSERT INTO playlist_items (playlist_id, video_id, position) VALUES (?1, ?2, 1)",
            [pl, vid],
        )
        .unwrap();
        assert_eq!(count_rows(&conn, "playlist_items"), 1);

        // With foreign_keys=ON, deleting the playlist cascades to items
        conn.execute("DELETE FROM playlists WHERE id = ?1", [pl]).unwrap();
        assert_eq!(count_rows(&conn, "playlist_items"), 0);
        assert_eq!(count_rows(&conn, "videos"), 1);
    }

    #[test]
    fn add_video_to_playlist() {
        let conn = setup();
        let vid = insert_video(&conn, "/tmp/add.mp4");
        let pl = insert_playlist(&conn, "Queue");
        conn.execute(
            "INSERT OR IGNORE INTO playlist_items (playlist_id, video_id, position)
             SELECT ?1, ?2, COALESCE(MAX(position), 0) + 1 FROM playlist_items WHERE playlist_id = ?1",
            [pl, vid],
        )
        .unwrap();
        assert_eq!(count_rows(&conn, "playlist_items"), 1);
    }

    #[test]
    fn add_duplicate_video_to_playlist_is_ignored() {
        let conn = setup();
        let vid = insert_video(&conn, "/tmp/dup.mp4");
        let pl = insert_playlist(&conn, "Queue");
        let sql = "INSERT OR IGNORE INTO playlist_items (playlist_id, video_id, position)
                   SELECT ?1, ?2, COALESCE(MAX(position), 0) + 1 FROM playlist_items WHERE playlist_id = ?1";
        conn.execute(sql, [pl, vid]).unwrap();
        conn.execute(sql, [pl, vid]).unwrap();
        assert_eq!(count_rows(&conn, "playlist_items"), 1);
    }

    #[test]
    fn remove_video_from_playlist() {
        let conn = setup();
        let v1 = insert_video(&conn, "/tmp/v1.mp4");
        let v2 = insert_video(&conn, "/tmp/v2.mp4");
        let pl = insert_playlist(&conn, "Mix");
        conn.execute(
            "INSERT INTO playlist_items (playlist_id, video_id, position) VALUES (?1, ?2, 1)",
            [pl, v1],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO playlist_items (playlist_id, video_id, position) VALUES (?1, ?2, 2)",
            [pl, v2],
        )
        .unwrap();
        assert_eq!(count_rows(&conn, "playlist_items"), 2);

        conn.execute(
            "DELETE FROM playlist_items WHERE playlist_id = ?1 AND video_id = ?2",
            [pl, v1],
        )
        .unwrap();
        assert_eq!(count_rows(&conn, "playlist_items"), 1);
        let remaining: i64 = conn
            .query_row(
                "SELECT video_id FROM playlist_items WHERE playlist_id = ?1",
                [pl],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(remaining, v2);
    }

    #[test]
    fn delete_video_cascades_out_of_playlists() {
        let conn = setup();
        let vid = insert_video(&conn, "/tmp/gone.mp4");
        let pl = insert_playlist(&conn, "Watch Later");
        conn.execute(
            "INSERT INTO playlist_items (playlist_id, video_id, position) VALUES (?1, ?2, 1)",
            [pl, vid],
        )
        .unwrap();
        assert_eq!(count_rows(&conn, "playlist_items"), 1);

        conn.execute("DELETE FROM videos WHERE id = ?1", [vid]).unwrap();
        assert_eq!(count_rows(&conn, "playlist_items"), 0);
        assert_eq!(count_rows(&conn, "playlists"), 1); // playlist itself survives
    }

    // ── smart_playlist CRUD ───────────────────────────────────────────────────

    #[test]
    fn create_and_delete_smart_playlist() {
        let conn = setup();
        conn.execute(
            "INSERT INTO smart_playlists (name, filter_json) VALUES ('Top Rated', '{\"rating\":{\"gte\":4}}')",
            [],
        )
        .unwrap();
        let id: i64 = conn.last_insert_rowid();
        assert_eq!(count_rows(&conn, "smart_playlists"), 1);

        conn.execute("DELETE FROM smart_playlists WHERE id = ?1", [id]).unwrap();
        assert_eq!(count_rows(&conn, "smart_playlists"), 0);
    }

    // ── reorder ───────────────────────────────────────────────────────────────

    #[test]
    fn reorder_playlist_items() {
        let conn = setup();
        let v1 = insert_video(&conn, "/tmp/r1.mp4");
        let v2 = insert_video(&conn, "/tmp/r2.mp4");
        let pl = insert_playlist(&conn, "Reorder");
        conn.execute(
            "INSERT INTO playlist_items (playlist_id, video_id, position) VALUES (?1, ?2, 1)",
            [pl, v1],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO playlist_items (playlist_id, video_id, position) VALUES (?1, ?2, 2)",
            [pl, v2],
        )
        .unwrap();

        // Simulate reorder: swap positions
        conn.execute(
            "UPDATE playlist_items SET position = 2 WHERE playlist_id = ?1 AND video_id = ?2",
            [pl, v1],
        )
        .unwrap();
        conn.execute(
            "UPDATE playlist_items SET position = 1 WHERE playlist_id = ?1 AND video_id = ?2",
            [pl, v2],
        )
        .unwrap();

        let pos1: i64 = conn
            .query_row(
                "SELECT position FROM playlist_items WHERE playlist_id = ?1 AND video_id = ?2",
                [pl, v1],
                |r| r.get(0),
            )
            .unwrap();
        let pos2: i64 = conn
            .query_row(
                "SELECT position FROM playlist_items WHERE playlist_id = ?1 AND video_id = ?2",
                [pl, v2],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(pos1, 2);
        assert_eq!(pos2, 1);
    }
}
