//! 無音の音声トラックの検出。
//!
//! 画面収録やミュートで書き出した動画には、音声トラックがあっても中身が無音のものがある。
//! ffmpeg の volumedetect で音声トラックごとの最大音量を測り、どれも基準以下なら無音とみなす。
//! 多くのファイルは音があるので、まず数か所だけを読んで音が見つかったトラックを外す。
//! 残ったトラックは、調べ方によって次のように確かめる。
//! - 簡易 (`Depth::Quick`): さらに多くの位置を 1 回の ffmpeg でまとめて読み、どこにも音がなければ無音とみなす。
//!   ファイル全体は読まないので速いが、ごく一部にだけ音があるトラックは見落としうる
//! - 精密 (`Depth::Full`): ファイル全体を読んで確かめる
//!
//! 結果は `videos` の次の列に保存する (NULL は未確認):
//! - `audio_silence`: `none` (無音のトラックなし) / `partial` (一部が無音) / `all` (すべて無音)
//! - `silent_audio_streams`: 無音のトラックの番号 (ffprobe の index、カンマ区切り)
//! - `silent_audio_bytes`: 無音のトラックが使っている容量の見込み (外すと空く)
//! - `audio_silence_sampled`: 1 なら無音のトラックは簡易判定 (外す前に精密に確かめる)

use serde::Serialize;

use super::settings::SharedAppSettings;
use super::transcode::{probe_source, ProbeInfo, StreamInfo};
use super::utils::{background_command, validate_video_path};
use crate::db::DbState;

/// 最大音量 (dBFS) がこれ以下なら無音とみなす。
/// 16 ビットの完全な無音は -91 dB、ディザや非可逆圧縮の残りかすでも -70 dB 前後に収まる
const SILENCE_DB: f64 = -60.0;

/// これより短いファイルは最初から全体を読む
const SAMPLE_MIN_DURATION: f64 = 120.0;
/// 先に読む位置 (長さに対する割合) と、1 か所あたりの秒数。たいていの動画はここで音が見つかって終わる
const SAMPLE_POSITIONS: [f64; 5] = [0.05, 0.25, 0.5, 0.75, 0.92];
const SAMPLE_SECS: f64 = 6.0;
/// 簡易判定で、先の位置で音が見つからなかったトラックをさらに読む箇所の数と、1 か所あたりの秒数
const MORE_WINDOWS: usize = 24;
const MORE_SECS: f64 = 4.0;

/// 調べ方
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Depth {
    /// 何か所かを読んで判定する (全体は読まない)
    Quick,
    /// 音が見つからなかったトラックはファイル全体を読んで確かめる
    Full,
}

/// まだ調べていない動画の条件 (音声トラックがないと分かっているものは調べない)
pub(crate) const UNCHECKED_FILTER: &str = "COALESCE(media_type, 'video') = 'video'
           AND COALESCE(status, '') != 'missing'
           AND COALESCE(has_audio, 1) != 0
           AND audio_silence IS NULL";

#[derive(Serialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TrackLevel {
    pub index: usize,
    /// 測った最大音量 (dBFS)。音がまったくない (-inf・読めた標本がない) ときは None。
    /// 一部だけ読んで音が見つかったトラックは、その部分での値
    pub peak_db: Option<f64>,
    pub silent: bool,
}

#[derive(Serialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SilenceReport {
    /// "none" | "partial" | "all"
    pub status: String,
    pub silent_streams: Vec<usize>,
    pub silent_bytes: i64,
    /// 無音のトラックは一部を読んだだけの簡易判定 (無音のトラックがなければ false)
    pub sampled: bool,
    pub tracks: Vec<TrackLevel>,
}

/// DB に保存した結果
#[derive(Serialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct StoredSilence {
    pub status: String,
    pub silent_streams: Vec<usize>,
    pub silent_bytes: i64,
    pub sampled: bool,
}

#[derive(Serialize)]
pub struct UncheckedVideo {
    pub id: i64,
    pub path: String,
}

/// "1,3" → [1, 3]
pub(crate) fn parse_stream_list(text: Option<&str>) -> Vec<usize> {
    text.unwrap_or_default().split(',').filter_map(|s| s.trim().parse().ok()).collect()
}

fn format_stream_list(streams: &[usize]) -> Option<String> {
    (!streams.is_empty()).then(|| streams.iter().map(usize::to_string).collect::<Vec<_>>().join(","))
}

// ── ffmpeg の volumedetect ───────────────────────────────────────────────────

/// volumedetect の出力から、フィルターごとの最大音量を読む。
/// フィルターグラフは設定のために一度作り直されることがあり、そのときの `n_samples: 0` も出るので、
/// フィルターごとに最後の値を使う。標本が 0 なら None、`-inf` は負の無限大
fn parse_peaks(stderr: &str, count: usize) -> Vec<Option<f64>> {
    let mut samples: Vec<Option<u64>> = vec![None; count];
    let mut peaks: Vec<Option<f64>> = vec![None; count];
    for line in stderr.lines() {
        let Some(rest) = line.split("[Parsed_volumedetect_").nth(1) else { continue };
        let Some(i) = rest.split(' ').next().and_then(|n| n.parse::<usize>().ok()).filter(|i| *i < count) else {
            continue;
        };
        if let Some(v) = rest.split("n_samples: ").nth(1) {
            samples[i] = v.trim().parse().ok();
            peaks[i] = None;
        } else if let Some(v) = rest.split("max_volume: ").nth(1) {
            let v = v.trim().trim_end_matches("dB").trim();
            peaks[i] = if v == "-inf" { Some(f64::NEG_INFINITY) } else { v.parse().ok() };
        }
    }
    peaks
        .into_iter()
        .zip(samples)
        .map(|(peak, n)| if n.unwrap_or(0) == 0 { None } else { peak.or(Some(f64::NEG_INFINITY)) })
        .collect()
}

/// 指定した音声トラックの最大音量を測る。`windows` は読む区間 (開始秒, 長さ秒) で、空ならファイル全体。
/// 区間ごとに入力を開き直して 1 回の ffmpeg でまとめて測り、トラックごとに全区間での最大を返す
async fn measure_peaks(
    ffmpeg_path: &str,
    path: &str,
    indices: &[usize],
    windows: &[(f64, f64)],
) -> Result<Vec<Option<f64>>, String> {
    let mut cmd = background_command(ffmpeg_path);
    cmd.args(["-nostdin", "-hide_banner", "-nostats", "-v", "info"]);
    if windows.is_empty() {
        cmd.args(["-i", path]);
    }
    for (start, len) in windows {
        cmd.args(["-ss", &format!("{start:.3}"), "-t", &format!("{len:.3}"), "-i", path]);
    }
    let graph = volumedetect_graph(windows.len().max(1), indices);
    let filters = windows.len().max(1) * indices.len();
    cmd.args(["-filter_complex", &graph]);
    for k in 0..filters {
        cmd.args(["-map", &format!("[a{k}]")]);
    }
    cmd.args(["-f", "null", "-"]);
    let out = cmd
        .stdin(std::process::Stdio::null())
        .kill_on_drop(true)
        .output()
        .await
        .map_err(|e| format!("ffmpeg 起動失敗: {e}"))?;
    let stderr = String::from_utf8_lossy(&out.stderr);
    if !out.status.success() {
        let tail: Vec<&str> = stderr.lines().rev().take(3).collect();
        return Err(format!("音量を測れませんでした: {}", tail.into_iter().rev().collect::<Vec<_>>().join(" / ")));
    }
    Ok(max_per_track(&parse_peaks(&stderr, filters), indices.len()))
}

/// 入力ごと・トラックごとの volumedetect。k 番目 (`[a{k}]`) は入力 k / tracks のトラック k % tracks
fn volumedetect_graph(inputs: usize, indices: &[usize]) -> String {
    (0..inputs)
        .flat_map(|input| indices.iter().map(move |idx| (input, idx)))
        .enumerate()
        .map(|(k, (input, idx))| format!("[{input}:{idx}]volumedetect[a{k}]"))
        .collect::<Vec<_>>()
        .join(";")
}

/// 区間ごとの値 (入力順にトラックが並ぶ) を、トラックごとの最大にまとめる。どの区間も標本がなければ None
fn max_per_track(peaks: &[Option<f64>], tracks: usize) -> Vec<Option<f64>> {
    (0..tracks)
        .map(|i| {
            peaks.iter().skip(i).step_by(tracks.max(1)).fold(None, |acc: Option<f64>, p| match (acc, *p) {
                (Some(a), Some(b)) => Some(a.max(b)),
                (a, b) => a.or(b),
            })
        })
        .collect()
}

fn is_silent(peak: Option<f64>) -> bool {
    peak.is_none_or(|p| p <= SILENCE_DB)
}

/// 先に読む区間 (開始秒, 長さ秒)。短いファイルは None (最初から全体を読む)
fn sample_windows(duration: f64) -> Option<Vec<(f64, f64)>> {
    (duration >= SAMPLE_MIN_DURATION)
        .then(|| SAMPLE_POSITIONS.iter().map(|f| ((duration * f).min(duration - SAMPLE_SECS), SAMPLE_SECS)).collect())
}

/// 簡易判定でさらに読む区間。全体に等間隔に散らす
fn more_windows(duration: f64) -> Vec<(f64, f64)> {
    (0..MORE_WINDOWS)
        .map(|k| {
            let center = duration * (k as f64 + 0.5) / MORE_WINDOWS as f64;
            ((center - MORE_SECS / 2.0).clamp(0.0, (duration - MORE_SECS).max(0.0)), MORE_SECS)
        })
        .collect()
}

/// 測った結果をまとめる
fn build_report(info: &ProbeInfo, audio: &[&StreamInfo], peaks: &[Option<f64>], sampled: bool) -> SilenceReport {
    let tracks: Vec<TrackLevel> = audio
        .iter()
        .zip(peaks)
        .map(|(s, p)| TrackLevel {
            index: s.index,
            peak_db: p.filter(|v| v.is_finite()),
            silent: is_silent(*p),
        })
        .collect();
    let silent: Vec<&StreamInfo> =
        audio.iter().zip(&tracks).filter(|(_, t)| t.silent).map(|(s, _)| *s).collect();
    let status = match silent.len() {
        0 => "none",
        n if n == audio.len() => "all",
        _ => "partial",
    };
    let silent_bytes = silent
        .iter()
        .filter_map(|s| s.bit_rate)
        .map(|bps| (bps as f64 * info.duration / 8.0) as i64)
        .sum();
    SilenceReport {
        status: status.into(),
        silent_streams: silent.iter().map(|s| s.index).collect(),
        silent_bytes,
        sampled: sampled && !silent.is_empty(),
        tracks,
    }
}

/// ファイルの音声トラックが無音かを調べる
async fn detect(ffmpeg_path: &str, ffprobe_path: &str, path: &str, depth: Depth) -> Result<SilenceReport, String> {
    let info = probe_source(ffprobe_path, path).await?;
    let audio: Vec<&StreamInfo> = info.streams.iter().filter(|s| s.codec_type == "audio").collect();
    if audio.is_empty() {
        return Ok(build_report(&info, &[], &[], false));
    }

    // peaks[i] は audio[i] の最大音量。どこかで音が見つかったものは確定 (無音ではない)
    let mut peaks: Vec<Option<f64>> = vec![None; audio.len()];
    let mut loud = vec![false; audio.len()];
    if let Some(first) = sample_windows(info.duration) {
        let mut rounds = vec![first];
        if depth == Depth::Quick {
            rounds.push(more_windows(info.duration));
        }
        let mut readable = true;
        for windows in rounds {
            let rest: Vec<usize> = (0..audio.len()).filter(|i| !loud[*i]).collect();
            let indices: Vec<usize> = rest.iter().map(|i| audio[*i].index).collect();
            match measure_peaks(ffmpeg_path, path, &indices, &windows).await {
                Ok(found) => {
                    for (i, p) in rest.into_iter().zip(found) {
                        peaks[i] = max_per_track(&[peaks[i], p], 1)[0];
                        loud[i] = !is_silent(peaks[i]);
                    }
                }
                // 途中を読めない形式は全体を読んで確かめる
                Err(e) => {
                    log::debug!("[silent_audio] 一部だけ読めませんでした ({path}): {e}");
                    readable = false;
                    break;
                }
            }
            if loud.iter().all(|l| *l) {
                return Ok(build_report(&info, &audio, &peaks, false));
            }
        }
        if readable && depth == Depth::Quick {
            return Ok(build_report(&info, &audio, &peaks, true));
        }
    }

    let rest: Vec<usize> = (0..audio.len()).filter(|i| !loud[*i]).collect();
    let indices: Vec<usize> = rest.iter().map(|i| audio[*i].index).collect();
    let found = measure_peaks(ffmpeg_path, path, &indices, &[]).await?;
    for (i, p) in rest.into_iter().zip(found) {
        peaks[i] = p;
    }
    Ok(build_report(&info, &audio, &peaks, false))
}

fn save_report(conn: &rusqlite::Connection, video_id: i64, report: &SilenceReport) -> Result<(), String> {
    conn.execute(
        "UPDATE videos SET audio_silence = ?1, silent_audio_streams = ?2, silent_audio_bytes = ?3,
                           audio_silence_sampled = ?4
         WHERE id = ?5",
        rusqlite::params![
            report.status,
            format_stream_list(&report.silent_streams),
            report.silent_bytes,
            report.sampled as i64,
            video_id
        ],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

fn load_stored(conn: &rusqlite::Connection, video_id: i64) -> Result<Option<StoredSilence>, String> {
    let stored = conn.query_row(
        "SELECT audio_silence, silent_audio_streams, silent_audio_bytes, audio_silence_sampled
         FROM videos WHERE id = ?1",
        [video_id],
        |r| {
            let Some(status) = r.get::<_, Option<String>>(0)? else { return Ok(None) };
            Ok(Some(StoredSilence {
                status,
                silent_streams: parse_stream_list(r.get::<_, Option<String>>(1)?.as_deref()),
                silent_bytes: r.get::<_, Option<i64>>(2)?.unwrap_or(0),
                sampled: r.get::<_, Option<i64>>(3)?.unwrap_or(0) != 0,
            }))
        },
    );
    match stored {
        Ok(s) => Ok(s),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

// ── Tauri コマンド ───────────────────────────────────────────────────────────

/// まだ調べていない動画を、空く容量が多そうな順 (ファイルの大きい順) に返す。`limit` を省くとすべて
fn query_unchecked(conn: &rusqlite::Connection, limit: Option<i64>) -> Result<Vec<UncheckedVideo>, String> {
    let mut stmt = conn
        .prepare(&format!(
            "SELECT id, path FROM videos WHERE {UNCHECKED_FILTER}
             ORDER BY file_size IS NULL, file_size DESC, id LIMIT ?1"
        ))
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([limit.filter(|n| *n >= 0).unwrap_or(-1)], |r| Ok(UncheckedVideo { id: r.get(0)?, path: r.get(1)? }))
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}

/// まだ無音かどうかを調べていない動画 (大きい順、`limit` 件まで)
#[tauri::command]
pub async fn get_videos_without_silence_check(
    db_state: tauri::State<'_, DbState>,
    limit: Option<i64>,
) -> Result<Vec<UncheckedVideo>, String> {
    let conn = db_state.conn_read()?;
    query_unchecked(&conn, limit)
}

/// 1 本の動画の音声トラックが無音かを調べ、結果を保存して返す。
/// `thorough` が true なら、音が見つからなかったトラックはファイル全体を読んで確かめる (既定は簡易判定)
#[tauri::command]
pub async fn detect_silent_audio(
    db_state: tauri::State<'_, DbState>,
    app_settings: tauri::State<'_, SharedAppSettings>,
    video_id: i64,
    thorough: Option<bool>,
) -> Result<SilenceReport, String> {
    let path: String = {
        let conn = db_state.conn_read()?;
        conn.query_row("SELECT path FROM videos WHERE id = ?1", [video_id], |r| r.get(0))
            .map_err(|e| format!("動画が見つかりません: {e}"))?
    };
    validate_video_path(&path)?;
    let (ffmpeg_path, ffprobe_path) = {
        let s = app_settings.lock().map_err(|e| e.to_string())?;
        (s.ffmpeg_path.clone(), s.ffprobe_path.clone())
    };
    let depth = if thorough.unwrap_or(false) { Depth::Full } else { Depth::Quick };
    let report = detect(&ffmpeg_path, &ffprobe_path, &path, depth).await?;
    let conn = db_state.conn()?;
    save_report(&conn, video_id, &report)?;
    Ok(report)
}

/// 保存済みの結果。まだ調べていなければ None
#[tauri::command]
pub async fn get_audio_silence(
    db_state: tauri::State<'_, DbState>,
    video_id: i64,
) -> Result<Option<StoredSilence>, String> {
    let conn = db_state.conn_read()?;
    load_stored(&conn, video_id)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::schema::init_db;

    #[test]
    fn parse_peaks_uses_last_values_and_handles_inf_and_empty() {
        let stderr = "\
[Parsed_volumedetect_0 @ 0x1] n_samples: 0
[Parsed_volumedetect_1 @ 0x2] n_samples: 0
  Stream #0:1 (aac) -> volumedetect:default
[Parsed_volumedetect_0 @ 0x3] n_samples: 2880000
[Parsed_volumedetect_0 @ 0x3] mean_volume: -91.0 dB
[Parsed_volumedetect_0 @ 0x3] max_volume: -91.0 dB
[Parsed_volumedetect_1 @ 0x4] n_samples: 1323000
[Parsed_volumedetect_1 @ 0x4] max_volume: -17.8 dB
[Parsed_volumedetect_2 @ 0x5] n_samples: 100
[Parsed_volumedetect_2 @ 0x5] max_volume: -inf dB
[Parsed_volumedetect_3 @ 0x6] n_samples: 0
";
        let peaks = parse_peaks(stderr, 4);
        assert_eq!(peaks[0], Some(-91.0));
        assert_eq!(peaks[1], Some(-17.8));
        assert_eq!(peaks[2], Some(f64::NEG_INFINITY));
        assert_eq!(peaks[3], None);
        assert!(is_silent(peaks[0]) && !is_silent(peaks[1]) && is_silent(peaks[2]) && is_silent(peaks[3]));
    }

    #[test]
    fn report_classifies_and_estimates_bytes() {
        let info = ProbeInfo::audio_only_for_test(100.0, &[(1, Some(128_000)), (2, Some(64_000))]);
        let audio: Vec<&StreamInfo> = info.streams.iter().collect();

        let r = build_report(&info, &audio, &[Some(-10.0), Some(-91.0)], true);
        assert_eq!(r.status, "partial");
        assert_eq!(r.silent_streams, vec![2]);
        assert_eq!(r.silent_bytes, 800_000);
        assert!(r.sampled);

        let r = build_report(&info, &audio, &[None, Some(f64::NEG_INFINITY)], false);
        assert_eq!(r.status, "all");
        assert_eq!(r.silent_bytes, 2_400_000);
        assert_eq!(r.tracks[1].peak_db, None, "-inf は JSON にできないので None");

        let r = build_report(&info, &audio, &[Some(-3.0), Some(-20.0)], true);
        assert_eq!(r.status, "none");
        assert!(r.silent_streams.is_empty());
        assert!(!r.sampled, "無音のトラックがなければ簡易判定の印は付けない");

        assert_eq!(build_report(&info, &[], &[], false).status, "none");
    }

    #[test]
    fn short_files_are_read_whole_and_windows_stay_inside() {
        assert!(sample_windows(60.0).is_none());
        let w = sample_windows(600.0).unwrap();
        assert_eq!(w.len(), SAMPLE_POSITIONS.len());
        assert!(w.iter().all(|(s, l)| *s >= 0.0 && s + l <= 600.0));
        let more = more_windows(600.0);
        assert_eq!(more.len(), MORE_WINDOWS);
        assert!(more.iter().all(|(s, l)| *s >= 0.0 && s + l <= 600.0));
        assert!(more.windows(2).all(|p| p[0].0 < p[1].0), "前から順に並ぶ");
    }

    #[test]
    fn graph_lists_tracks_per_input_and_peaks_fold_per_track() {
        assert_eq!(
            volumedetect_graph(2, &[1, 3]),
            "[0:1]volumedetect[a0];[0:3]volumedetect[a1];[1:1]volumedetect[a2];[1:3]volumedetect[a3]"
        );
        // 入力 0: トラック 1 = -80, トラック 3 = 標本なし / 入力 1: トラック 1 = -20, トラック 3 = -inf
        let folded = max_per_track(&[Some(-80.0), None, Some(-20.0), Some(f64::NEG_INFINITY)], 2);
        assert_eq!(folded, vec![Some(-20.0), Some(f64::NEG_INFINITY)]);
        assert_eq!(max_per_track(&[None, None], 1), vec![None]);
    }

    #[test]
    fn stored_result_round_trips_and_unchecked_filter_skips_known() {
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        init_db(&conn).unwrap();
        let add = |path: &str, extra: &str| {
            conn.execute("INSERT INTO videos (path, media_type, status) VALUES (?1, 'video', 'active')", [path]).unwrap();
            let id = conn.last_insert_rowid();
            if !extra.is_empty() {
                conn.execute(&format!("UPDATE videos SET {extra} WHERE id = ?1"), [id]).unwrap();
            }
            id
        };
        let a = add("/m/a.mp4", "");
        add("/m/mute.mp4", "has_audio = 0");
        add("/m/gone.mp4", "status = 'missing'");
        add("/m/song.mp3", "media_type = 'audio'");
        let unchecked: Vec<i64> = conn
            .prepare(&format!("SELECT id FROM videos WHERE {UNCHECKED_FILTER}"))
            .unwrap()
            .query_map([], |r| r.get(0))
            .unwrap()
            .collect::<Result<_, _>>()
            .unwrap();
        assert_eq!(unchecked, vec![a]);

        // 大きい順、サイズ不明は最後。limit で件数を絞れる
        let big = add("/m/big.mp4", "file_size = 900");
        let small = add("/m/small.mp4", "file_size = 10");
        let order: Vec<i64> = query_unchecked(&conn, None).unwrap().into_iter().map(|v| v.id).collect();
        assert_eq!(order, vec![big, small, a]);
        assert_eq!(query_unchecked(&conn, Some(1)).unwrap().len(), 1);
        conn.execute("DELETE FROM videos WHERE id IN (?1, ?2)", [big, small]).unwrap();

        assert_eq!(load_stored(&conn, a).unwrap(), None);
        let report =
            SilenceReport { status: "partial".into(), silent_streams: vec![2, 3], silent_bytes: 42, sampled: true, tracks: vec![] };
        save_report(&conn, a, &report).unwrap();
        assert_eq!(
            load_stored(&conn, a).unwrap(),
            Some(StoredSilence { status: "partial".into(), silent_streams: vec![2, 3], silent_bytes: 42, sampled: true })
        );
        assert_eq!(load_stored(&conn, 9999).unwrap(), None);
    }

    /// 実際の ffmpeg で、無音と音ありのトラックを見分けられるか (ffmpeg がない環境では飛ばす)。
    /// トラック 1 は無音、2 は全体に音、3 は読む位置のすき間 (5.5 秒から 1.5 秒) にだけ音がある
    #[tokio::test]
    async fn detects_silent_track_with_real_ffmpeg() {
        let (ffmpeg, ffprobe) = ("ffmpeg", "ffprobe");
        if std::process::Command::new(ffmpeg).arg("-version").output().is_err() {
            return;
        }
        let dir = std::env::temp_dir().join(format!("silent_audio_test_{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let input = dir.join("t.mkv");
        let status = std::process::Command::new(ffmpeg)
            .args(["-v", "error", "-y"])
            .args(["-f", "lavfi", "-i", "testsrc=d=150:s=64x48:r=5"])
            .args(["-f", "lavfi", "-i", "anullsrc=r=8000:cl=mono"])
            .args(["-f", "lavfi", "-i", "sine=f=440:r=8000:d=150"])
            .args(["-f", "lavfi", "-i", "sine=f=440:r=8000:d=1.5,adelay=5500,apad=whole_dur=150"])
            .args(["-map", "0", "-map", "1", "-map", "2", "-map", "3", "-t", "150"])
            .args(["-c:v", "mpeg4", "-c:a", "pcm_s16le"])
            .arg(&input)
            .status()
            .unwrap();
        assert!(status.success());
        let path = input.to_str().unwrap();

        let quick = detect(ffmpeg, ffprobe, path, Depth::Quick).await.unwrap();
        let full = detect(ffmpeg, ffprobe, path, Depth::Full).await.unwrap();
        let _ = std::fs::remove_dir_all(&dir);

        assert_eq!(quick.status, "partial");
        assert_eq!(quick.silent_streams, vec![1, 3], "簡易判定は読まなかった部分の音を見落とす");
        assert!(quick.sampled);
        assert!(quick.silent_bytes > 0);
        assert!(!quick.tracks[1].silent);

        assert_eq!(full.silent_streams, vec![1], "精密に調べれば短い音も見つかる");
        assert!(!full.sampled);
    }
}
