/// ONNX Runtime 初期化層。
///
/// OS 固有のライブラリロード処理はそれぞれのサブモジュールへ分離し、
/// AI 推論コード (ai/) はこのモジュールの存在を一切知らない構成にする。
///
/// 呼び出し元 (lib.rs) は `initialize_runtime(app)` を一度だけ呼ぶ。

#[cfg(target_os = "macos")]
mod macos;
#[cfg(target_os = "windows")]
mod windows;
#[cfg(target_os = "linux")]
mod linux;

/// アプリ起動時に一度だけ呼ぶ。ORT 共有ライブラリをロードして Runtime を初期化する。
///
/// バンドル済みライブラリが見つからない場合は `Err` を返す。
/// 開発環境では `ORT_LIB_LOCATION` 環境変数を設定することで代替できる
/// (その場合は macOS.rs 側で Err を返さず Ok(()) を返す実装でよいが、
///  本実装では必ずバンドル済み or 環境変数の存在を要求する設計にしている)。
pub fn initialize_runtime(app: &tauri::AppHandle) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        macos::initialize(app)
    }
    #[cfg(target_os = "windows")]
    {
        windows::initialize(app)
    }
    #[cfg(target_os = "linux")]
    {
        linux::initialize(app)
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
    {
        let _ = app;
        Err("ONNX Runtime: unsupported platform".to_string())
    }
}
