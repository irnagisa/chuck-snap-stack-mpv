pub mod commands;

use commands::mpv::MpvState;
use commands::settings::AppSettings;
use commands::watcher::new_watcher_state;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_sql::Builder::new().build())
        .plugin(tauri_plugin_opener::init())
        .manage(MpvState::new())
        .manage(AppSettings::new())
        .manage(new_watcher_state())
        .invoke_handler(tauri::generate_handler![
            commands::library::scan_directory,
            commands::library::generate_thumbnail,
            commands::mpv::play,
            commands::mpv::pause_resume,
            commands::mpv::seek,
            commands::mpv::get_playback_time,
            commands::mpv::quit_mpv,
            commands::mpv::relative_seek,
            commands::mpv::adjust_volume,
            commands::mpv::toggle_fullscreen,
            commands::library::delete_video_file,
            commands::library::delete_multiple_video_files,
            commands::settings::update_settings,
            commands::watcher::start_watching,
            commands::watcher::stop_watching,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
