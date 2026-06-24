pub mod commands;
pub mod db;

use std::sync::Mutex;

use tauri::Manager;
use commands::download::DownloadState;
use commands::window::MiniPlayerWindowState;
use commands::mpv::MpvState;
use commands::settings::AppSettings;
use commands::transcode::TranscodeState;
use commands::watcher::new_watcher_state;
use db::DbState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let db_path = app.path().app_data_dir()?.join("videos.db");
            let conn = rusqlite::Connection::open(&db_path)?;
            db::schema::init_db(&conn)?;
            db::migrations::run_data_migrations(&conn)?;
            app.manage(DbState(Mutex::new(conn)));
            Ok(())
        })
        .manage(MpvState::new())
        .manage(AppSettings::new())
        .manage(new_watcher_state())
        .manage(DownloadState::new())
        .manage(TranscodeState::new())
        .manage(commands::ytdlp::YtdlpState::new())
        .manage(MiniPlayerWindowState::new())
        .manage(commands::webserver::WebServerState::new())
        .invoke_handler(tauri::generate_handler![
            commands::library::scan_directory,
            commands::library::generate_thumbnail,
            commands::library::get_file_size,
            commands::library::get_file_sizes,
            commands::mpv::play,
            commands::mpv::pause_resume,
            commands::mpv::seek,
            commands::mpv::get_playback_time,
            commands::mpv::quit_mpv,
            commands::mpv::relative_seek,
            commands::mpv::adjust_volume,
            commands::mpv::toggle_fullscreen,
            commands::mpv::set_loop,
            commands::library::check_has_audio,
            commands::library::get_video_dimensions,
            commands::library::delete_video_file,
            commands::library::delete_multiple_video_files,
            commands::library::trash_video_file,
            commands::library::trash_multiple_video_files,
            commands::library::move_video_file,
            commands::library::copy_video_file,
            commands::settings::update_settings,
            commands::settings::get_default_mpv_path,
            commands::settings::path_exists,
            commands::watcher::start_watching,
            commands::watcher::stop_watching,
            commands::download::download_video,
            commands::download::cancel_download,
            commands::transcode::transcode_video,
            commands::transcode::cancel_transcode,
            commands::mpv::set_playback_speed,
            commands::mpv::take_screenshot,
            commands::mpv::set_ab_loop_a,
            commands::mpv::set_ab_loop_b,
            commands::mpv::clear_ab_loop,
            commands::mpv::load_subtitle,
            commands::library::get_chapters,
            commands::library::scan_subtitle_files,
            commands::library::capture_frame_at,
            commands::library::save_text_file,
            commands::library::read_text_file,
            commands::library::rename_video_file,
            commands::library::canonicalize_path,
            commands::ytdlp::download_with_ytdlp,
            commands::ytdlp::cancel_ytdlp_download,
            commands::ytdlp::detect_ytdlp_path,
            commands::window::enter_mini_player,
            commands::window::exit_mini_player,
            commands::webserver::start_web_server,
            commands::webserver::stop_web_server,
            commands::webserver::get_web_server_port,
            commands::webserver::get_local_ip,
            // db_settings
            commands::db_settings::db_load_settings,
            commands::db_settings::db_save_settings,
            commands::db_settings::db_save_keybindings,
            commands::db_settings::db_get_setting,
            commands::db_settings::db_set_setting,
            // db_tags
            commands::db_tags::db_fetch_tags,
            commands::db_tags::db_fetch_categories,
            commands::db_tags::db_fetch_tag_categories,
            commands::db_tags::db_fetch_video_tags_for_ids,
            commands::db_tags::db_fetch_video_tags,
            commands::db_tags::db_create_tag,
            commands::db_tags::db_update_tag,
            commands::db_tags::db_delete_tag,
            commands::db_tags::db_set_tag_category,
            commands::db_tags::db_create_tag_category,
            commands::db_tags::db_update_tag_category,
            commands::db_tags::db_delete_tag_category,
            commands::db_tags::db_create_category,
            commands::db_tags::db_update_category,
            commands::db_tags::db_delete_category,
            commands::db_tags::db_add_tag_to_video,
            commands::db_tags::db_remove_tag_from_video,
            commands::db_tags::db_set_video_category,
            commands::db_tags::db_add_tag_to_multiple,
            commands::db_tags::db_set_category_multiple,
            // db_playlists
            commands::db_playlists::db_fetch_playlists,
            commands::db_playlists::db_create_playlist,
            commands::db_playlists::db_delete_playlist,
            commands::db_playlists::db_fetch_playlist_videos,
            commands::db_playlists::db_add_video_to_playlist,
            commands::db_playlists::db_remove_video_from_playlist,
            commands::db_playlists::db_reorder_playlist_items,
            commands::db_playlists::db_get_smart_playlists,
            commands::db_playlists::db_create_smart_playlist,
            commands::db_playlists::db_delete_smart_playlist,
            // db_stats
            commands::db_stats::db_get_library_stats,
            // db_export
            commands::db_export::db_export_backup,
            commands::db_export::db_import_backup,
            // db_videos
            commands::db_videos::db_fetch_videos,
            commands::db_videos::db_fetch_all_for_shuffle,
            commands::db_videos::db_increment_watch_count,
            commands::db_videos::db_update_progress,
            commands::db_videos::db_update_video,
            commands::db_videos::db_update_video_thumbnail,
            commands::db_videos::db_delete_video,
            commands::db_videos::db_remove_video,
            commands::db_videos::db_remove_multiple,
            commands::db_videos::db_add_video_from_path,
            commands::db_videos::db_remove_video_by_path,
            commands::db_videos::db_update_video_path,
            commands::db_videos::db_rename_video_file,
            commands::db_videos::db_move_video_file_db,
            commands::db_videos_scan::db_scan_and_import,
            commands::db_videos_scan::db_rescan_all_dirs,
            commands::db_videos_scan::db_get_videos_for_paths,
            commands::db_videos_scan::db_batch_watcher_update,
            commands::db_videos_scan::db_assign_category_from_path,
            commands::db_videos::db_add_watch_dir,
            commands::db_videos::db_remove_watch_dir,
            commands::db_videos::db_get_watch_dirs,
            commands::db_videos::db_get_pending_thumbnails,
            commands::db_videos::db_update_thumbnails_batch,
            commands::db_videos::db_update_audio_only_batch,
            commands::db_videos::db_reset_jpg_thumbnails,
            commands::db_videos::db_get_inbox_videos,
            commands::db_videos::db_get_inbox_stats,
            commands::db_videos::db_graduate_from_inbox,
            commands::library::cleanup_jpg_thumbnails,
            commands::library::migrate_root_files_to_inbox,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            if let tauri::RunEvent::Exit = event {
                let state = app.state::<commands::mpv::SharedMpvState>();
                commands::mpv::kill_on_exit(&state);
            }
        });
}
