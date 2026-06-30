use std::sync::Mutex;
use tauri::{AppHandle, LogicalSize, Manager, Size};

pub struct MiniPlayerWindowState {
    prev_size: Mutex<Option<(f64, f64)>>,
}

impl MiniPlayerWindowState {
    pub fn new() -> Self {
        Self {
            prev_size: Mutex::new(None),
        }
    }
}

#[tauri::command]
pub async fn enter_mini_player(
    app: AppHandle,
    state: tauri::State<'_, MiniPlayerWindowState>,
) -> Result<(), String> {
    let window = app
        .get_webview_window("main")
        .ok_or("window not found")?;

    // 現在のサイズを論理ピクセルで保存
    let physical = window.inner_size().map_err(|e| e.to_string())?;
    let scale = window.scale_factor().map_err(|e| e.to_string())?;
    *state.prev_size.lock().map_err(|e| e.to_string())? = Some((
        physical.width as f64 / scale,
        physical.height as f64 / scale,
    ));

    // 最小サイズ制約を緩めてからリサイズ
    window
        .set_min_size(Some(Size::Logical(LogicalSize::new(260.0_f64, 110.0_f64))))
        .map_err(|e| e.to_string())?;
    window
        .set_size(Size::Logical(LogicalSize::new(300.0_f64, 150.0_f64)))
        .map_err(|e| e.to_string())?;
    window.set_always_on_top(true).map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
pub async fn exit_mini_player(
    app: AppHandle,
    state: tauri::State<'_, MiniPlayerWindowState>,
) -> Result<(), String> {
    let window = app
        .get_webview_window("main")
        .ok_or("window not found")?;

    window
        .set_always_on_top(false)
        .map_err(|e| e.to_string())?;

    let prev = state.prev_size.lock().map_err(|e| e.to_string())?.take();
    let (w, h) = prev.unwrap_or((1200.0, 800.0));

    // 元の最小サイズに戻してからリサイズ
    window
        .set_min_size(Some(Size::Logical(LogicalSize::new(640.0_f64, 360.0_f64))))
        .map_err(|e| e.to_string())?;
    window
        .set_size(Size::Logical(LogicalSize::new(w, h)))
        .map_err(|e| e.to_string())?;

    Ok(())
}
