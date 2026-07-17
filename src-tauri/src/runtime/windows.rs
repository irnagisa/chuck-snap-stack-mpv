/// Windows ORT Runtime 初期化。
///
/// bundle 配置: tauri.conf.json の `bundle.resources` に
/// `"libs/windows/onnxruntime.dll": "./"` を追加することで
/// `app.path().resource_dir()` 以下に配置される。
///
/// Windows では DLL を `ort::init_from()` で明示ロードするため、
/// `resource_dir` → `ORT_LIB_LOCATION` の順で探索する。
///
/// 将来 Windows 対応を実装する際は以下の手順で追加できる:
///   1. onnxruntime.dll を `libs/windows/` に配置
///   2. tauri.conf.json の bundle.resources に追加
///   3. このスタブを本実装に置き換える

use tauri::Manager;

const DLL_NAME: &str = "onnxruntime.dll";

pub fn initialize(app: &tauri::AppHandle) -> Result<(), String> {
    // 1. 本番: resource_dir (インストール先の resources/) を探索
    if let Ok(resource_dir) = app.path().resource_dir() {
        let dll_path = resource_dir.join(DLL_NAME);
        if dll_path.exists() {
            ort::init_from(&dll_path)
                .map_err(|e| format!("ORT init_from({dll_path:?}) failed: {e}"))?
                .commit();
            return Ok(());
        }
    }

    // 2. 開発: ORT_LIB_LOCATION 環境変数を確認
    if let Ok(lib_dir) = std::env::var("ORT_LIB_LOCATION") {
        let dll_path = std::path::Path::new(&lib_dir).join(DLL_NAME);
        if dll_path.exists() {
            ort::init_from(&dll_path)
                .map_err(|e| format!("ORT init_from({dll_path:?}) failed: {e}"))?
                .commit();
            return Ok(());
        }
        return Err(format!(
            "ORT_LIB_LOCATION={lib_dir} が設定されていますが {DLL_NAME} が見つかりません。\
             ONNX Runtime を {lib_dir}\\ に配置してください。"
        ));
    }

    // 3. 開発フォールバック: CWD 基準で候補パスを探索
    if let Ok(cwd) = std::env::current_dir() {
        let candidates = [
            cwd.join("libs").join("windows").join(DLL_NAME),
            cwd.join("src-tauri").join("libs").join("windows").join(DLL_NAME),
        ];
        for dll_path in &candidates {
            if dll_path.exists() {
                ort::init_from(dll_path)
                    .map_err(|e| format!("ORT init_from({dll_path:?}) failed: {e}"))?
                    .commit();
                return Ok(());
            }
        }
    }

    Err(format!(
        "{DLL_NAME} が見つかりません。\
         `pnpm update:onnxruntime` を実行して src-tauri/libs/windows/ に dll を配置するか、\
         ORT_LIB_LOCATION 環境変数にディレクトリパスを設定してください。"
    ))
}
