//! 映像の情報 (コーデック・解像度・fps・映像のビットレート) を ffprobe で調べ、`media_probe` テーブルに取っておく。
//!
//! 整理画面の「高ビットレート」で、AV1 に変換したときに減る割合を見積もって並べるのに使う。
//! いつでも調べ直せるキャッシュなので `videos` とは別のテーブルにしている (動画を消すと一緒に消える)。
//!
//! - `probe_key`: 調べたときの「サイズ:更新日時(ns)」(`content_digest_key` と同じ形)。
//!   サイズが `videos.file_size` と食い違っていたら、調べていないものとして扱う
//!
//! 見積もりは目安で、映像の中身 (動き・ノイズ) までは分からない。実際の大きさは変換してみるまで分からない

use std::time::UNIX_EPOCH;

use serde::Serialize;

use super::settings::SharedAppSettings;
use super::transcode::{codec_efficiency, probe_media, video_summary, VideoSummary};
use super::utils::validate_video_path;
use crate::db::DbState;

/// `videos` の行に、サイズの合う (= 古くない) 調べた結果を付ける JOIN
pub(crate) const PROBE_JOIN: &str =
    "LEFT JOIN media_probe mp ON mp.video_id = videos.id AND mp.probe_key LIKE (videos.file_size || ':%')";

/// `PROBE_JOIN` で付けた列 (`probe_from_row` と順番を合わせる)
pub(crate) const PROBE_COLUMNS: &str = "mp.video_id IS NOT NULL, mp.video_codec, mp.width, mp.height, mp.fps, mp.video_bitrate";

/// `PROBE_COLUMNS` を `offset` 列目から読む。調べていなければ None
pub(crate) fn probe_from_row(r: &rusqlite::Row, offset: usize) -> rusqlite::Result<Option<VideoSummary>> {
    if !r.get::<_, bool>(offset)? {
        return Ok(None);
    }
    Ok(Some(VideoSummary {
        codec: r.get(offset + 1)?,
        width: r.get(offset + 2)?,
        height: r.get(offset + 3)?,
        fps: r.get(offset + 4)?,
        bitrate: r.get::<_, Option<i64>>(offset + 5)?.map(|b| b as f64),
    }))
}

// ── 見積もり ─────────────────────────────────────────────────────────────────

/// 見積もりの基準: 1080p30 の映像を既定の設定 (CRF 32) の AV1 にしたときのビットレート (bps)。
/// 実写でふつうの動きの映像のおおよその値。アニメや画面録画はこれより小さく、ノイズの多い映像は大きくなる
const AV1_REFERENCE_BPS: f64 = 3_000_000.0;
const REFERENCE_PIXELS_PER_SEC: f64 = 1920.0 * 1080.0 * 30.0;
/// 画素数が増えても必要なビットレートは比例ほどは増えない (隣り合う画素が似てくるため)
const PIXEL_SCALING_EXPONENT: f64 = 0.75;
/// AV1 が同じ画質に必要なビットレートの、H.264 に対する比
const AV1_VS_H264: f64 = 0.5;
/// 見積もりの上限 (どれだけ無駄が多くても、これ以上とは言わない)
const MAX_SAVING_RATIO: f64 = 0.9;

/// AV1 に変換したとき、ファイル全体のうち減る割合の見積もり (0〜`MAX_SAVING_RATIO`)。
/// 映像の情報が足りなければ None。音声などは変わらないとみなす
pub(crate) fn estimate_av1_saving(v: &VideoSummary, file_size: i64, duration: f64) -> Option<f64> {
    let codec = v.codec.as_deref()?;
    if codec == "av1" {
        return Some(0.0);
    }
    let source = v.bitrate.filter(|b| *b > 0.0)?;
    let pixels_per_sec = v.width? as f64 * v.height? as f64 * v.fps.filter(|f| *f > 0.0 && *f <= 240.0)?;
    if pixels_per_sec <= 0.0 || file_size <= 0 || duration <= 0.0 {
        return None;
    }
    // 中身に見合ったビットレートと、元の圧縮の効率から見た上限 (元より良くはなるが、限度がある) の小さいほう
    let by_resolution = AV1_REFERENCE_BPS * (pixels_per_sec / REFERENCE_PIXELS_PER_SEC).powf(PIXEL_SCALING_EXPONENT);
    let by_source = source / codec_efficiency(codec) * AV1_VS_H264;
    let output = by_resolution.min(by_source);
    let saved_bytes = (source - output).max(0.0) * duration / 8.0;
    Some((saved_bytes / file_size as f64).clamp(0.0, MAX_SAVING_RATIO))
}

// ── 調べて保存する ───────────────────────────────────────────────────────────

fn probe_key(meta: &std::fs::Metadata) -> Option<String> {
    let mtime = meta.modified().ok()?.duration_since(UNIX_EPOCH).ok()?.as_nanos();
    Some(format!("{}:{mtime}", meta.len()))
}

fn save(conn: &rusqlite::Connection, video_id: i64, key: &str, v: &VideoSummary) -> Result<(), String> {
    conn.execute(
        "INSERT OR REPLACE INTO media_probe (video_id, probe_key, video_codec, width, height, fps, video_bitrate, probed_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, CURRENT_TIMESTAMP)",
        rusqlite::params![video_id, key, v.codec, v.width, v.height, v.fps, v.bitrate.map(|b| b.round() as i64)],
    )
    .map(|_| ())
    .map_err(|e| e.to_string())
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct UnprobedVideo {
    pub id: i64,
}

/// まだ調べていない (または調べた後にファイルが変わった) 高ビットレートの動画を大きい順に返す
fn query_unprobed(conn: &rusqlite::Connection, limit: Option<i64>) -> Result<Vec<UnprobedVideo>, String> {
    let filter = super::storage::high_bitrate_unprobed_filter();
    let mut stmt = conn
        .prepare(&format!("SELECT id FROM videos WHERE {filter} ORDER BY file_size DESC, id LIMIT ?1"))
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([limit.filter(|n| *n >= 0).unwrap_or(-1)], |r| Ok(UnprobedVideo { id: r.get(0)? }))
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}

/// 整理画面の「高ビットレート」に出る動画のうち、まだ映像の情報を調べていないもの (大きい順、`limit` 件まで)
#[tauri::command]
pub async fn get_videos_without_probe(
    db_state: tauri::State<'_, DbState>,
    limit: Option<i64>,
) -> Result<Vec<UnprobedVideo>, String> {
    let conn = db_state.conn_read()?;
    query_unprobed(&conn, limit)
}

/// 1 本の動画の映像の情報を ffprobe で調べて保存する (ファイルの先頭を読むだけなので軽い)
#[tauri::command]
pub async fn probe_video_info(
    db_state: tauri::State<'_, DbState>,
    app_settings: tauri::State<'_, SharedAppSettings>,
    video_id: i64,
) -> Result<(), String> {
    let path: String = {
        let conn = db_state.conn_read()?;
        conn.query_row("SELECT path FROM videos WHERE id = ?1", [video_id], |r| r.get(0))
            .map_err(|e| format!("動画が見つかりません: {e}"))?
    };
    validate_video_path(&path)?;
    let ffprobe_path = app_settings.lock().map_err(|e| e.to_string())?.ffprobe_path.clone();
    let meta = tokio::fs::metadata(&path).await.map_err(|e| format!("ファイルを読めません: {e}"))?;
    let key = probe_key(&meta).ok_or("ファイルの更新日時を読めません")?;
    let info = probe_media(&ffprobe_path, &path).await?;
    let summary = video_summary(&info, Some(meta.len()));
    let conn = db_state.conn()?;
    save(&conn, video_id, &key, &summary)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::schema::init_db;
    use rusqlite::Connection;

    fn summary(codec: &str, w: u32, h: u32, fps: f64, mbps: f64) -> VideoSummary {
        VideoSummary { codec: Some(codec.into()), width: Some(w), height: Some(h), fps: Some(fps), bitrate: Some(mbps * 1e6) }
    }

    /// `mbps` の映像 + 音声 128 kbps の `secs` 秒のファイルの大きさ
    fn file_size(mbps: f64, secs: f64) -> i64 {
        ((mbps * 1e6 + 128_000.0) * secs / 8.0) as i64
    }

    fn ratio(codec: &str, w: u32, h: u32, fps: f64, mbps: f64) -> f64 {
        estimate_av1_saving(&summary(codec, w, h, fps, mbps), file_size(mbps, 60.0), 60.0).unwrap()
    }

    #[test]
    fn high_bitrate_h264_saves_much_more_than_efficient_hevc_at_same_bitrate() {
        let h264 = ratio("h264", 1920, 1080, 30.0, 10.0);
        let hevc_4k = ratio("hevc", 3840, 2160, 60.0, 10.0);
        // 1080p30 の H.264 10 Mbps → 3 Mbps くらいになる見込み (約 7 割減)
        assert!((h264 - 0.69).abs() < 0.02, "{h264}");
        // 4K60 の HEVC 10 Mbps は既に効率がよく、ほとんど減らない
        assert!(hevc_4k < 0.25, "{hevc_4k}");
        assert!(h264 > hevc_4k);
    }

    #[test]
    fn same_bitrate_lower_resolution_saves_more() {
        assert!(ratio("h264", 1280, 720, 30.0, 8.0) > ratio("h264", 3840, 2160, 30.0, 8.0));
    }

    #[test]
    fn already_av1_saves_nothing_and_missing_info_is_unknown() {
        assert_eq!(ratio("av1", 1920, 1080, 30.0, 10.0), 0.0);
        let mut v = summary("h264", 1920, 1080, 30.0, 10.0);
        v.fps = None;
        assert_eq!(estimate_av1_saving(&v, file_size(10.0, 60.0), 60.0), None);
        let mut v = summary("h264", 1920, 1080, 30.0, 10.0);
        v.bitrate = None;
        assert_eq!(estimate_av1_saving(&v, file_size(10.0, 60.0), 60.0), None);
    }

    #[test]
    fn audio_heavy_files_save_less_of_the_whole() {
        let v = summary("h264", 1920, 1080, 30.0, 6.0);
        // 同じ映像でも、ファイルの半分が音声なら全体として減る割合は半分程度になる
        let video_only = estimate_av1_saving(&v, file_size(6.0, 60.0), 60.0).unwrap();
        let with_big_audio = estimate_av1_saving(&v, file_size(6.0, 60.0) * 2, 60.0).unwrap();
        assert!((with_big_audio - video_only / 2.0).abs() < 0.01);
    }

    #[test]
    fn saved_rows_are_read_back_only_while_file_size_matches() {
        let conn = Connection::open_in_memory().unwrap();
        init_db(&conn).unwrap();
        conn.execute("INSERT INTO videos (path, file_size) VALUES ('/m/a.mp4', 1000)", []).unwrap();
        let id = conn.last_insert_rowid();
        let v = summary("h264", 1920, 1080, 29.97, 8.0);
        save(&conn, id, "1000:123", &v).unwrap();

        let read = |conn: &Connection| {
            conn.query_row(&format!("SELECT {PROBE_COLUMNS} FROM videos {PROBE_JOIN} WHERE videos.id = ?1"), [id], |r| {
                probe_from_row(r, 0)
            })
            .unwrap()
        };
        assert_eq!(read(&conn), Some(v));
        // ファイルが差し替わってサイズが変わったら、調べていない扱いに戻る
        conn.execute("UPDATE videos SET file_size = 2000 WHERE id = ?1", [id]).unwrap();
        assert_eq!(read(&conn), None);
        // 動画を消すと一緒に消える
        conn.execute("DELETE FROM videos WHERE id = ?1", [id]).unwrap();
        let n: i64 = conn.query_row("SELECT COUNT(*) FROM media_probe", [], |r| r.get(0)).unwrap();
        assert_eq!(n, 0);
    }
}
