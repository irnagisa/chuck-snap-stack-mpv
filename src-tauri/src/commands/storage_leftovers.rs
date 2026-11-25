//! 途中で止まったダウンロード・変換の残りファイル。
//!
//! - ダウンロード: yt-dlp の書きかけ (`*.part`・`*.part-FragN`・`*.ytdl`) と後処理の途中 (`*.temp.mp4` 等)
//! - 変換: ffmpeg の一時出力 (`._<名前>.<av1|hevc|opus|slim>.mkv.tmp`)。起動時にも
//!   `transcode::cleanup_stale_tmp_files` で消すが、それはライブラリのファイルと同じフォルダだけを見る
//! - AI モデル: 中断したダウンロード (`<app_data>/ai/<種類>/model.onnx.tmp`)
//!
//! 探す場所は監視フォルダとダウンロード先 (設定) の中 (隠しフォルダは除く)、
//! OS のダウンロードフォルダとライブラリのファイルがあるフォルダの直下。
//! ライブラリに登録されているファイル、更新から間もないファイル、実行中の処理のファイルは対象にしない。

use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::Serialize;
use tauri::{AppHandle, Manager};
use walkdir::WalkDir;

use super::transcode::{is_transcode_tmp_name, TranscodeState};
use super::ytdlp::YtdlpState;
use crate::ai::{AiTaggerState, ModelKind};
use crate::db::DbState;

/// 更新からこれだけ経っていないファイルは書き込み中かもしれないので残す
const MIN_AGE: Duration = Duration::from_secs(60 * 60);

/// フォルダの中を探す深さの上限
const MAX_DEPTH: usize = 12;

/// 一覧で返す件数の上限 (件数・容量の合計は全件分)
const LIST_LIMIT: usize = 300;

/// yt-dlp が後処理で `<名前>.temp.<拡張子>` を作るメディアの拡張子
const MEDIA_EXTS: [&str; 12] = ["mp4", "mkv", "webm", "mov", "m4a", "mp3", "opus", "ogg", "flac", "wav", "aac", "m4v"];

#[derive(Serialize, Debug, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum LeftoverKind {
    Download,
    Transcode,
    AiDownload,
}

#[derive(Serialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LeftoverFile {
    pub path: String,
    pub kind: LeftoverKind,
    pub bytes: u64,
    /// 最終更新 (Unix ミリ秒)
    pub modified_ms: Option<i64>,
}

#[derive(Serialize, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct LeftoverFiles {
    pub total_count: usize,
    pub total_bytes: u64,
    /// 容量の大きい順に上位 LIST_LIMIT 件
    pub files: Vec<LeftoverFile>,
}

#[derive(Serialize, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LeftoverCleanupResult {
    pub removed_files: u64,
    pub freed_bytes: u64,
}

/// yt-dlp の書きかけ・後処理途中のファイル名か
fn is_download_leftover_name(name: &str) -> bool {
    let lower = name.to_lowercase();
    if lower.ends_with(".part") || lower.ends_with(".ytdl") {
        return true;
    }
    // 断片ダウンロード: `<名前>.part-Frag12` / `<名前>.part-Frag12.part`
    if let Some(idx) = lower.rfind(".part-frag") {
        let rest = lower[idx + ".part-frag".len()..].trim_end_matches(".part");
        return !rest.is_empty() && rest.bytes().all(|b| b.is_ascii_digit());
    }
    // 後処理の途中: `<名前>.temp.mp4`
    let mut parts = lower.rsplitn(3, '.');
    let (Some(ext), Some(mid), Some(stem)) = (parts.next(), parts.next(), parts.next()) else { return false };
    mid == "temp" && !stem.is_empty() && MEDIA_EXTS.contains(&ext)
}

fn classify(name: &str) -> Option<LeftoverKind> {
    if is_transcode_tmp_name(name) {
        Some(LeftoverKind::Transcode)
    } else if is_download_leftover_name(name) {
        Some(LeftoverKind::Download)
    } else {
        None
    }
}

/// 探す場所
#[derive(Default)]
struct ScanPlan {
    /// 中まで探すフォルダ
    deep: Vec<PathBuf>,
    /// 直下だけ探すフォルダ
    shallow: Vec<PathBuf>,
    /// 中断した AI モデルのダウンロード (あれば)
    ai_partials: Vec<PathBuf>,
    /// ライブラリに登録されているファイル (正規化済み)
    library: HashSet<PathBuf>,
    /// yt-dlp を実行中ならダウンロードの残りは対象にしない
    skip_downloads: bool,
    /// 変換中の一時出力 (正規化済み)
    converting: Option<PathBuf>,
}

fn canon(p: &Path) -> PathBuf {
    p.canonicalize().unwrap_or_else(|_| p.to_path_buf())
}

fn modified_ms(t: Option<SystemTime>) -> Option<i64> {
    t?.duration_since(UNIX_EPOCH).ok().and_then(|d| i64::try_from(d.as_millis()).ok())
}

fn old_enough(meta: &std::fs::Metadata, now: SystemTime) -> bool {
    // 更新時刻が取れない・未来のものは新しいとみなして残す
    meta.modified().ok().and_then(|m| now.duration_since(m).ok()).is_some_and(|age| age >= MIN_AGE)
}

fn scan(plan: &ScanPlan, now: SystemTime) -> Vec<LeftoverFile> {
    let mut seen: HashSet<PathBuf> = HashSet::new();
    let mut out = Vec::new();

    let mut consider = |path: &Path, kind: LeftoverKind, meta: &std::fs::Metadata| {
        if !meta.is_file() || !old_enough(meta, now) {
            return;
        }
        let c = canon(path);
        if plan.library.contains(&c) || plan.converting.as_ref() == Some(&c) || !seen.insert(c) {
            return;
        }
        if kind == LeftoverKind::Download && plan.skip_downloads {
            return;
        }
        out.push(LeftoverFile {
            path: path.to_string_lossy().into_owned(),
            kind,
            bytes: meta.len(),
            modified_ms: modified_ms(meta.modified().ok()),
        });
    };

    let roots = plan.deep.iter().map(|d| (d, MAX_DEPTH)).chain(plan.shallow.iter().map(|d| (d, 1)));
    for (root, depth) in roots {
        let walker = WalkDir::new(root)
            .max_depth(depth)
            .into_iter()
            // 隠しフォルダ (.git・退避フォルダなど) には入らない
            .filter_entry(|e| e.depth() == 0 || !e.file_type().is_dir() || !e.file_name().to_string_lossy().starts_with('.'));
        for entry in walker.filter_map(|e| e.ok()) {
            // シンボリックリンクはたどらない (file_type はリンク自体の種類)
            if !entry.file_type().is_file() {
                continue;
            }
            let Some(kind) = entry.file_name().to_str().and_then(classify) else { continue };
            let Ok(meta) = entry.metadata() else { continue };
            consider(entry.path(), kind, &meta);
        }
    }

    for p in &plan.ai_partials {
        if let Ok(meta) = std::fs::symlink_metadata(p) {
            consider(p, LeftoverKind::AiDownload, &meta);
        }
    }

    out.sort_by(|a, b| b.bytes.cmp(&a.bytes).then(a.path.cmp(&b.path)));
    out
}

fn build_plan(app: &AppHandle) -> Result<ScanPlan, String> {
    let mut plan = ScanPlan::default();
    let mut shallow: HashSet<PathBuf> = HashSet::new();
    {
        let state = app.state::<DbState>();
        let conn = state.conn_read()?;
        let mut stmt = conn.prepare("SELECT path FROM watch_dirs").map_err(|e| e.to_string())?;
        for row in stmt.query_map([], |r| r.get::<_, String>(0)).map_err(|e| e.to_string())? {
            plan.deep.push(PathBuf::from(row.map_err(|e| e.to_string())?));
        }
        let download_dir: Option<String> = conn
            .query_row("SELECT value FROM settings WHERE key = 'download_dir'", [], |r| r.get(0))
            .ok();
        if let Some(d) = download_dir.filter(|d| !d.trim().is_empty()) {
            plan.deep.push(PathBuf::from(d));
        }
        let mut stmt = conn
            .prepare("SELECT path FROM videos WHERE COALESCE(media_type, 'video') != 'link'")
            .map_err(|e| e.to_string())?;
        for row in stmt.query_map([], |r| r.get::<_, String>(0)).map_err(|e| e.to_string())? {
            let path = PathBuf::from(row.map_err(|e| e.to_string())?);
            if let Some(parent) = path.parent() {
                shallow.insert(parent.to_path_buf());
            }
            plan.library.insert(canon(&path));
        }
    }
    if let Ok(d) = app.path().download_dir() {
        shallow.insert(d);
    }
    // 中まで探すフォルダの中にあるものは重ねて探さない
    let deep: Vec<PathBuf> = plan.deep.iter().map(|d| canon(d)).collect();
    plan.shallow = shallow.into_iter().filter(|s| !deep.iter().any(|d| canon(s).starts_with(d))).collect();
    plan.shallow.sort();

    plan.skip_downloads = app.state::<YtdlpState>().is_running();
    plan.converting = app.state::<TranscodeState>().current_output()?.map(|p| canon(Path::new(&p)));

    let ai_downloading = app.state::<AiTaggerState>().0.lock().map(|s| s.downloading).unwrap_or(true);
    if !ai_downloading {
        for kind in ModelKind::ALL.iter() {
            if let Ok(dir) = super::ai::ai_dir(app, kind) {
                plan.ai_partials.push(dir.join("model.onnx.tmp"));
            }
        }
    }
    Ok(plan)
}

/// 途中で止まったダウンロード・変換の残りファイルを容量の大きい順に返す
#[tauri::command]
pub async fn get_leftover_files(app: AppHandle) -> Result<LeftoverFiles, String> {
    tokio::task::spawn_blocking(move || {
        let mut files = scan(&build_plan(&app)?, SystemTime::now());
        let total_count = files.len();
        let total_bytes = files.iter().map(|f| f.bytes).sum();
        files.truncate(LIST_LIMIT);
        Ok(LeftoverFiles { total_count, total_bytes, files })
    })
    .await
    .map_err(|e| e.to_string())?
}

/// 渡したファイルのうち、今も残りファイルとして見つかるものだけを完全に削除する (元に戻せない)
fn delete_found(requested: &[String], found: &[LeftoverFile]) -> LeftoverCleanupResult {
    let requested: HashSet<&str> = requested.iter().map(String::as_str).collect();
    let mut result = LeftoverCleanupResult::default();
    for f in found.iter().filter(|f| requested.contains(f.path.as_str())) {
        match std::fs::remove_file(&f.path) {
            Ok(()) => {
                result.removed_files += 1;
                result.freed_bytes += f.bytes;
            }
            Err(e) => log::warn!("[storage] 残りファイルの削除に失敗しました ({}): {e}", f.path),
        }
    }
    result
}

#[tauri::command]
pub async fn delete_leftover_files(app: AppHandle, paths: Vec<String>) -> Result<LeftoverCleanupResult, String> {
    tokio::task::spawn_blocking(move || {
        // 一覧を出した後に状況が変わっていることがあるので、探し直して確かめる
        let found = scan(&build_plan(&app)?, SystemTime::now());
        Ok(delete_found(&paths, &found))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn download_leftover_names() {
        for name in ["動画.mp4.part", "a.webm.ytdl", "a.mp4.part-Frag12", "a.mp4.part-Frag3.part", "a.temp.mp4", "A.TEMP.MKV"] {
            assert!(is_download_leftover_name(name), "{name}");
        }
        for name in ["a.mp4", "party.mp4", "a.part-Frag", "a.part-Fragx", "temp.mp4", ".temp.mp4", "a.temp.txt", "a.partial"] {
            assert!(!is_download_leftover_name(name), "{name}");
        }
    }

    #[test]
    fn classify_prefers_transcode_tmp() {
        assert_eq!(classify("._動画.av1.mkv.tmp"), Some(LeftoverKind::Transcode));
        assert_eq!(classify("動画.mkv.part"), Some(LeftoverKind::Download));
        assert_eq!(classify("動画.mkv"), None);
    }

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("css-leftover-test-{}-{name}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn write(path: &Path, size: usize) {
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, vec![0u8; size]).unwrap();
    }

    #[test]
    fn scan_finds_old_leftovers_and_skips_protected_files() {
        let root = temp_dir("scan");
        let part = root.join("sub/a.mp4.part");
        let tmp = root.join("._b.hevc.mkv.tmp");
        let registered = root.join("c.temp.mp4");
        let hidden = root.join(".git/d.mp4.part");
        let normal = root.join("e.mp4");
        let converting = root.join("._f.av1.mkv.tmp");
        for (p, size) in [(&part, 300), (&tmp, 200), (&registered, 10), (&hidden, 10), (&normal, 10), (&converting, 10)] {
            write(p, size);
        }
        let plan = ScanPlan {
            deep: vec![root.clone()],
            library: [canon(&registered)].into_iter().collect(),
            converting: Some(canon(&converting)),
            ..ScanPlan::default()
        };

        // 書いた直後は書き込み中かもしれないので対象にしない
        assert!(scan(&plan, SystemTime::now()).is_empty());

        let later = SystemTime::now() + MIN_AGE + Duration::from_secs(1);
        let found = scan(&plan, later);
        let names: Vec<(&str, LeftoverKind)> = found
            .iter()
            .map(|f| (Path::new(&f.path).file_name().unwrap().to_str().unwrap(), f.kind))
            .collect();
        assert_eq!(names, [("a.mp4.part", LeftoverKind::Download), ("._b.hevc.mkv.tmp", LeftoverKind::Transcode)]);

        // yt-dlp の実行中はダウンロードの残りを対象にしない
        let busy = ScanPlan { skip_downloads: true, ..plan };
        let found_busy = scan(&busy, later);
        assert_eq!(found_busy.len(), 1);
        assert_eq!(found_busy[0].kind, LeftoverKind::Transcode);

        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn shallow_roots_do_not_descend() {
        let root = temp_dir("shallow");
        write(&root.join("a.mp4.part"), 10);
        write(&root.join("sub/b.mp4.part"), 10);
        let plan = ScanPlan { shallow: vec![root.clone()], ..ScanPlan::default() };
        let found = scan(&plan, SystemTime::now() + MIN_AGE * 2);
        assert_eq!(found.len(), 1);
        assert!(found[0].path.ends_with("a.mp4.part"));
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn delete_only_touches_files_found_by_the_scan() {
        let root = temp_dir("delete");
        let part = root.join("a.mp4.part");
        let other = root.join("keep.mp4");
        write(&part, 100);
        write(&other, 100);
        let found = vec![LeftoverFile {
            path: part.to_string_lossy().into_owned(),
            kind: LeftoverKind::Download,
            bytes: 100,
            modified_ms: None,
        }];
        let requested = vec![part.to_string_lossy().into_owned(), other.to_string_lossy().into_owned()];
        let r = delete_found(&requested, &found);
        assert_eq!(r, LeftoverCleanupResult { removed_files: 1, freed_bytes: 100 });
        assert!(!part.exists());
        assert!(other.exists(), "一覧にないファイルは消さない");
        let _ = std::fs::remove_dir_all(&root);
    }
}
