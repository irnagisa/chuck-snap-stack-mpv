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

impl Default for MiniPlayerWindowState {
    fn default() -> Self {
        Self::new()
    }
}

/// ミニプレイヤーの大きさ。compact は再生操作だけ、medium は評価・カテゴリ・タグも編集できる
fn mini_player_dimensions(size: Option<&str>) -> ((f64, f64), (f64, f64)) {
    match size {
        // (最小サイズ, 初期サイズ)
        Some("medium") => ((320.0, 300.0), (360.0, 500.0)),
        _ => ((260.0, 110.0), (300.0, 150.0)),
    }
}

fn apply_mini_player_size(window: &tauri::WebviewWindow, size: Option<&str>) -> Result<(), String> {
    let ((min_w, min_h), (w, h)) = mini_player_dimensions(size);
    // 最小サイズ制約を先に合わせてからリサイズ (小さくするときに制約で止まらないように)
    window
        .set_min_size(Some(Size::Logical(LogicalSize::new(min_w, min_h))))
        .map_err(|e| e.to_string())?;
    window
        .set_size(Size::Logical(LogicalSize::new(w, h)))
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn enter_mini_player(
    app: AppHandle,
    state: tauri::State<'_, MiniPlayerWindowState>,
    size: Option<String>,
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

    apply_mini_player_size(&window, size.as_deref())?;
    window.set_always_on_top(true).map_err(|e| e.to_string())?;

    Ok(())
}

/// ミニプレイヤーのまま大きさ (compact / medium) を切り替える。元のウィンドウサイズは保ったまま
#[tauri::command]
pub async fn set_mini_player_size(app: AppHandle, size: String) -> Result<(), String> {
    let window = app
        .get_webview_window("main")
        .ok_or("window not found")?;
    apply_mini_player_size(&window, Some(size.as_str()))
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
