/// macOS ORT Runtime 初期化。
///
/// 探索順序:
/// 1a. `resource_dir()/libonnxruntime.dylib`          — 本番 (bundle.resources)
/// 1b. `resource_dir()/../Frameworks/libonnxruntime.dylib` — 本番 (bundle.macOS.frameworks)
/// 2.  `$ORT_LIB_LOCATION/libonnxruntime.dylib`       — 明示的な環境変数
/// 3.  `{cwd}/src-tauri/libs/macos/libonnxruntime.dylib` — 開発フォールバック
///
/// `pnpm update:onnxruntime` を実行すると (3) に universal2 版 dylib が配置されるため、
/// 環境変数なしで `pnpm tauri dev` が動作する。

use tauri::Manager;

const DYLIB_NAME: &str = "libonnxruntime.dylib";

pub fn initialize(app: &tauri::AppHandle) -> Result<(), String> {
    if let Ok(resource_dir) = app.path().resource_dir() {
        // 1a. 本番 (bundle.resources): .app/Contents/Resources/libonnxruntime.dylib
        let dylib_path = resource_dir.join(DYLIB_NAME);
        if dylib_path.exists() {
            ort::init_from(&dylib_path)
                .map_err(|e| format!("ORT init_from({dylib_path:?}) failed: {e}"))?
                .commit();
            return Ok(());
        }
        // 1b. 本番 (bundle.macOS.frameworks): .app/Contents/Frameworks/libonnxruntime.dylib
        if let Some(contents_dir) = resource_dir.parent() {
            let dylib_path = contents_dir.join("Frameworks").join(DYLIB_NAME);
            if dylib_path.exists() {
                ort::init_from(&dylib_path)
                    .map_err(|e| format!("ORT init_from({dylib_path:?}) failed: {e}"))?
                    .commit();
                return Ok(());
            }
        }
    }

    // 2. 開発: ORT_LIB_LOCATION 環境変数を確認
    if let Ok(lib_dir) = std::env::var("ORT_LIB_LOCATION") {
        let dylib_path = std::path::Path::new(&lib_dir).join(DYLIB_NAME);
        if dylib_path.exists() {
            ort::init_from(&dylib_path)
                .map_err(|e| format!("ORT init_from({dylib_path:?}) failed: {e}"))?
                .commit();
            return Ok(());
        }
        return Err(format!(
            "ORT_LIB_LOCATION={lib_dir} が設定されていますが {DYLIB_NAME} が見つかりません。\
             universal2 版 ONNX Runtime を {lib_dir}/ に配置してください。"
        ));
    }

    // 3. 開発フォールバック: CWD 基準で候補パスを探索
    //    pnpm tauri dev は src-tauri/ または プロジェクトルートから実行される場合がある
    if let Ok(cwd) = std::env::current_dir() {
        let candidates = [
            cwd.join("libs").join("macos").join(DYLIB_NAME),           // CWD = src-tauri/
            cwd.join("src-tauri").join("libs").join("macos").join(DYLIB_NAME), // CWD = project root
        ];
        for dylib_path in &candidates {
            if dylib_path.exists() {
                ort::init_from(dylib_path)
                    .map_err(|e| format!("ORT init_from({dylib_path:?}) failed: {e}"))?
                    .commit();
                return Ok(());
            }
        }
    }

    // 4. どこにも見つからない場合は明示的にエラー
    Err(format!(
        "{DYLIB_NAME} が見つかりません。\
         `pnpm update:onnxruntime` を実行して src-tauri/libs/macos/ に dylib を配置するか、\
         ORT_LIB_LOCATION 環境変数にディレクトリパスを設定してください。"
    ))
}
