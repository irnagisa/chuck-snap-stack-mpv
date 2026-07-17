/// Linux ORT Runtime 初期化。
///
/// bundle 配置: tauri.conf.json の `bundle.resources` に
/// `"libs/linux/libonnxruntime.so": "./"` を追加することで
/// `app.path().resource_dir()` 以下に配置される。
/// AppImage では `/usr/share/<app>/resources/` 相当のパスになる。
///
/// `ort::init_from()` で明示 dlopen するため rpath の設定は不要。
///
/// 将来 Linux 対応を実装する際は以下の手順で追加できる:
///   1. libonnxruntime.so を `libs/linux/` に配置
///      (バージョン付き .so.1.x.y の場合はシンボリックリンクで libonnxruntime.so を作成)
///   2. tauri.conf.json の bundle.resources に追加
///   3. このスタブを本実装に置き換える

use tauri::Manager;

const SO_NAME: &str = "libonnxruntime.so";

pub fn initialize(app: &tauri::AppHandle) -> Result<(), String> {
    // 1. 本番: resource_dir を探索
    if let Ok(resource_dir) = app.path().resource_dir() {
        let so_path = resource_dir.join(SO_NAME);
        if so_path.exists() {
            ort::init_from(&so_path)
                .map_err(|e| format!("ORT init_from({so_path:?}) failed: {e}"))?
                .commit();
            return Ok(());
        }
    }

    // 2. 開発: ORT_LIB_LOCATION 環境変数を確認
    if let Ok(lib_dir) = std::env::var("ORT_LIB_LOCATION") {
        let so_path = std::path::Path::new(&lib_dir).join(SO_NAME);
        if so_path.exists() {
            ort::init_from(&so_path)
                .map_err(|e| format!("ORT init_from({so_path:?}) failed: {e}"))?
                .commit();
            return Ok(());
        }
        return Err(format!(
            "ORT_LIB_LOCATION={lib_dir} が設定されていますが {SO_NAME} が見つかりません。\
             ONNX Runtime を {lib_dir}/ に配置してください。"
        ));
    }

    // 3. 開発フォールバック: CWD 基準で候補パスを探索
    if let Ok(cwd) = std::env::current_dir() {
        let candidates = [
            cwd.join("libs").join("linux").join(SO_NAME),
            cwd.join("src-tauri").join("libs").join("linux").join(SO_NAME),
        ];
        for so_path in &candidates {
            if so_path.exists() {
                ort::init_from(so_path)
                    .map_err(|e| format!("ORT init_from({so_path:?}) failed: {e}"))?
                    .commit();
                return Ok(());
            }
        }
    }

    Err(format!(
        "{SO_NAME} が見つかりません。\
         `pnpm update:onnxruntime` を実行して src-tauri/libs/linux/ に .so を配置するか、\
         ORT_LIB_LOCATION 環境変数にディレクトリパスを設定してください。"
    ))
}
