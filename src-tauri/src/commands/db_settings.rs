use std::collections::HashMap;

use rusqlite::OptionalExtension;
use tauri::State;

use crate::db::DbState;

#[tauri::command]
pub async fn db_load_settings(state: State<'_, DbState>) -> Result<HashMap<String, String>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare(
            "SELECT key, value FROM settings WHERE key IN (
              'mpv_path','ffmpeg_path','ffprobe_path','ytdlp_path',
              'download_dir','screenshot_dir','keybindings','theme','auto_play_next'
            )",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)))
        .map_err(|e| e.to_string())?;
    let mut map = HashMap::new();
    for row in rows {
        let (k, v) = row.map_err(|e| e.to_string())?;
        map.insert(k, v);
    }
    Ok(map)
}

#[tauri::command]
pub async fn db_save_settings(
    state: State<'_, DbState>,
    mpv_path: String,
    ffmpeg_path: String,
    ffprobe_path: String,
    ytdlp_path: String,
    download_dir: String,
    screenshot_dir: String,
    theme: String,
    auto_play_next: bool,
) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let entries = [
        ("mpv_path", mpv_path),
        ("ffmpeg_path", ffmpeg_path),
        ("ffprobe_path", ffprobe_path),
        ("ytdlp_path", ytdlp_path),
        ("download_dir", download_dir),
        ("screenshot_dir", screenshot_dir),
        ("theme", theme),
        ("auto_play_next", auto_play_next.to_string()),
    ];
    for (k, v) in &entries {
        conn.execute(
            "INSERT OR REPLACE INTO settings (key, value) VALUES (?1, ?2)",
            rusqlite::params![k, v],
        )
        .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub async fn db_save_keybindings(
    state: State<'_, DbState>,
    bindings_json: String,
) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT OR REPLACE INTO settings (key, value) VALUES ('keybindings', ?1)",
        [&bindings_json],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn db_get_setting(
    state: State<'_, DbState>,
    key: String,
) -> Result<Option<String>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let result: Option<String> = conn
        .query_row(
            "SELECT value FROM settings WHERE key = ?1",
            [&key],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(|e| e.to_string())?;
    Ok(result)
}

#[tauri::command]
pub async fn db_set_setting(
    state: State<'_, DbState>,
    key: String,
    value: String,
) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT OR REPLACE INTO settings (key, value) VALUES (?1, ?2)",
        [&key, &value],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}
