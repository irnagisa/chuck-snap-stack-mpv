pub mod commands;

use commands::mpv::MpvState;
use commands::settings::AppSettings;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_sql::Builder::new().build())
        .plugin(tauri_plugin_opener::init())
        .manage(MpvState::new())
        .manage(AppSettings::new())
        .invoke_handler(tauri::generate_handler![
            commands::library::scan_directory,
            commands::library::generate_thumbnail,
            commands::mpv::play,
            commands::mpv::pause_resume,
            commands::mpv::seek,
            commands::mpv::get_playback_time,
            commands::mpv::quit_mpv,
            commands::settings::update_settings,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
