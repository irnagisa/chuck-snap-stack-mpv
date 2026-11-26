//! グループ: シリーズ (連番の回) や、同じ内容の別パターン (画質違い・編集違い・変換後など) をまとめる。
//!
//! - 1 つの動画は 1 つのグループにだけ入る (`videos.group_id`)。並び順は `videos.group_position`
//! - ライブラリは `filter_collapse_groups` のとき代表の 1 件だけを出す (db_videos.rs の `video_source`)
//! - 代表は `media_groups.cover_video_id`。未設定 (NULL) なら並び順で最初のもの
//! - まとめる候補はファイル名から探す (同じフォルダで、画質・版・連番などを除いた名前が一致するもの)

use std::cmp::Ordering;
use std::collections::HashMap;

use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;
use tauri::State;
use unicode_normalization::UnicodeNormalization;

use super::db_videos::{video_from_row, Video};
use crate::db::DbState;

pub const KIND_VARIANTS: &str = "variants";
pub const KIND_SERIES: &str = "series";

const VIDEO_COLUMNS: &str = "v.id, v.path, v.title, v.duration, v.thumbnail, v.watched_at,
     v.progress, v.rating, v.category_id, v.has_audio, v.watch_count,
     v.created_at, v.media_type, v.source_url, v.status, v.source_type";

// ── Types ─────────────────────────────────────────────────────────────────────

/// 一覧の動画に付けるグループの情報
#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct VideoGroupRow {
    pub video_id: i64,
    pub group_id: i64,
    pub name: String,
    pub kind: String,
    pub member_count: i64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GroupDetail {
    pub id: i64,
    pub name: String,
    pub kind: String,
    pub cover_video_id: Option<i64>,
    pub created_at: String,
    pub members: Vec<Video>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GroupSummary {
    pub id: i64,
    pub name: String,
    pub kind: String,
    pub member_count: i64,
    pub thumbnail: Option<String>,
}

/// まとめる候補 (ライブラリ全体から探したもの)
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GroupSuggestion {
    /// 候補を見分けるためのキー (フォルダ + 正規化した名前)
    pub key: String,
    pub name: String,
    pub kind: String,
    pub videos: Vec<Video>,
}

/// ある動画と一緒にまとめられそうな動画
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GroupCandidate {
    pub video: Video,
    /// "variants": 同じ内容の別パターンらしい / "series": 同じシリーズの別の回らしい
    pub kind: String,
    /// 候補の動画がすでに入っているグループ
    pub group_id: Option<i64>,
}

/// ある動画の候補と、まとめるときの名前の案
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GroupCandidates {
    pub suggested_name: String,
    pub candidates: Vec<GroupCandidate>,
}

// ── ファイル名の正規化 ────────────────────────────────────────────────────────

/// 別パターンの違いとしてよく付く語 (小文字で比較)
const NOISE_TOKENS: &[&str] = &[
    // 画質・解像度
    "4k", "8k", "2k", "uhd", "fhd", "qhd", "hd", "sd", "hdr", "hdr10", "sdr", "dv", "60fps", "30fps",
    "120fps", "hq", "lq", "high", "low", "mid",
    // コーデック・形式
    "x264", "x265", "h264", "h265", "hevc", "avc", "av1", "vp9", "vp8", "aac", "ac3", "flac", "opus",
    "mp3", "10bit", "8bit", "hi10p",
    // 入手元
    "web", "webrip", "webdl", "dl", "bluray", "bdrip", "bd", "dvd", "dvdrip", "tv", "tvrip", "remux",
    // 版
    "ver", "version", "final", "copy", "edit", "edited", "proper", "repack", "alt", "raw", "orig",
    "original", "trim", "trimmed", "cut", "short", "full", "compressed", "small", "large", "preview",
    "コピー", "編集", "修正", "完成", "最終", "最終版", "完全版", "短縮版", "高画質", "低画質", "圧縮",
];

/// 連番を `#` にした語のうち、何話目かを表すもの (シリーズの名前を作るときに除く)
const EPISODE_TOKENS: &[&str] = &[
    "#", "ep#", "e#", "s#e#", "s#", "#話", "第#話", "第#回", "#回", "part#", "pt#", "vol#", "no#",
    "#巻", "第#巻", "第#章", "#章", "第#部", "#部", "episode#",
];

/// 連番だけが違う名前でも、シリーズとは言えない名前 (カメラ・スクリーンショットなど)
const GENERIC_SERIES_PREFIXES: &[&str] = &[
    "img", "dsc", "dscn", "dscf", "mov", "mvi", "vid", "pxl", "gopr", "dji", "screenshot",
    "screen recording", "スクリーンショット", "画面収録", "video", "clip", "image", "photo", "画像",
    "動画", "写真", "untitled", "名称未設定", "new", "file", "rec", "recording",
];

fn is_bracket_open(c: char) -> Option<char> {
    match c {
        '(' => Some(')'),
        '[' => Some(']'),
        '{' => Some('}'),
        '【' => Some('】'),
        '〔' => Some('〕'),
        '〈' => Some('〉'),
        _ => None,
    }
}

fn is_separator(c: char) -> bool {
    c.is_whitespace() || matches!(c, '_' | '-' | '.' | ',' | '+' | '~' | '・' | '|' | '–' | '—')
}

/// `v2` `ver3` のような版の番号
fn is_version_token(lower: &str) -> bool {
    let rest = lower
        .strip_prefix("ver")
        .or_else(|| lower.strip_prefix('v'))
        .unwrap_or("");
    !rest.is_empty() && rest.chars().all(|c| c.is_ascii_digit() || c == '.')
}

/// `720p` `1080i` のような解像度
fn is_resolution_token(lower: &str) -> bool {
    let Some(num) = lower.strip_suffix('p').or_else(|| lower.strip_suffix('i')) else {
        return false;
    };
    (3..=4).contains(&num.len()) && num.chars().all(|c| c.is_ascii_digit())
}

/// `1920x1080` のような縦横の大きさ
fn is_dimension_token(lower: &str) -> bool {
    let mut parts = lower.split('x');
    matches!(
        (parts.next(), parts.next(), parts.next()),
        (Some(a), Some(b), None)
            if !a.is_empty() && !b.is_empty()
                && a.chars().all(|c| c.is_ascii_digit())
                && b.chars().all(|c| c.is_ascii_digit())
    )
}

/// パスからファイル名 (拡張子なし) を取り出す
fn file_stem(path: &str) -> &str {
    let name = path.rsplit(['/', '\\']).next().unwrap_or(path);
    match name.rfind('.') {
        Some(i) if i > 0 => &name[..i],
        _ => name,
    }
}

fn parent_dir(path: &str) -> &str {
    match path.rfind(['/', '\\']) {
        Some(i) => &path[..i],
        None => "",
    }
}

/// ファイル名 (拡張子なし) から、別パターンの違いになりやすい部分 (括弧書き・画質・版・コピーの印) を除いた語の列。
/// 大文字小文字は元のまま残す。
pub fn variant_tokens(stem: &str) -> Vec<String> {
    let mut s: String = stem.nfkc().collect();

    // AV1 変換の出力名 (`{stem}.av1` / `{stem}.av1_{n}`) と、末尾の「のコピー」
    let lower = s.to_lowercase();
    if let Some(i) = lower.rfind(".av1") {
        let tail = &lower[i + 4..];
        if tail.is_empty() || (tail.starts_with('_') && tail[1..].chars().all(|c| c.is_ascii_digit())) {
            s.truncate(i);
        }
    }
    for suffix in ["のコピー", " のコピー"] {
        if let Some(stripped) = s.strip_suffix(suffix) {
            s = stripped.to_string();
        }
    }

    // 括弧書きを除く (入れ子は外側ごと)
    let mut without_brackets = String::with_capacity(s.len());
    let mut closers: Vec<char> = Vec::new();
    for c in s.chars() {
        if let Some(close) = is_bracket_open(c) {
            closers.push(close);
            without_brackets.push(' ');
        } else if closers.last() == Some(&c) {
            closers.pop();
        } else if closers.is_empty() {
            without_brackets.push(c);
        }
    }

    let raw: Vec<&str> = without_brackets.split(is_separator).filter(|t| !t.is_empty()).collect();
    let mut tokens = Vec::with_capacity(raw.len());
    let mut i = 0;
    while i < raw.len() {
        let token = raw[i];
        let lower = token.to_lowercase();
        let noise = NOISE_TOKENS.contains(&lower.as_str())
            || is_version_token(&lower)
            || is_resolution_token(&lower)
            || is_dimension_token(&lower);
        if noise {
            // "copy 2" / "コピー 3" の番号も一緒に除く
            if matches!(lower.as_str(), "copy" | "コピー")
                && raw.get(i + 1).is_some_and(|n| n.chars().all(|c| c.is_ascii_digit()))
            {
                i += 1;
            }
        } else {
            tokens.push(token.to_string());
        }
        i += 1;
    }
    tokens
}

/// 数字の並びを `#` に置き換える
fn mask_digits(token: &str) -> String {
    let mut out = String::with_capacity(token.len());
    let mut in_digits = false;
    for c in token.chars() {
        if c.is_ascii_digit() {
            if !in_digits {
                out.push('#');
            }
            in_digits = true;
        } else {
            out.push(c);
            in_digits = false;
        }
    }
    out
}

/// 別パターンとみなすキー (同じなら同じ内容の別パターンらしい)
pub fn variant_key(stem: &str) -> String {
    variant_tokens(stem).join(" ").to_lowercase()
}

/// シリーズとみなすキー (同じなら番号だけが違う)。シリーズと言えない名前なら None
pub fn series_key(stem: &str) -> Option<String> {
    let key = variant_tokens(stem)
        .iter()
        .map(|t| mask_digits(&t.to_lowercase()))
        .collect::<Vec<_>>()
        .join(" ");
    if !key.contains('#') {
        return None;
    }
    // 番号以外の部分 (カメラの連番など、それだけではシリーズと言えないものは除く)
    let words: String = key
        .split(' ')
        .filter(|t| !EPISODE_TOKENS.contains(t))
        .collect::<Vec<_>>()
        .join(" ")
        .replace('#', "");
    let letters = words.chars().filter(|c| c.is_alphanumeric()).count();
    if letters < 2 || GENERIC_SERIES_PREFIXES.contains(&words.trim()) {
        return None;
    }
    Some(key)
}

/// まとめる候補の名前 (シリーズなら番号の部分を除く)
fn suggested_name(stem: &str, kind: &str) -> String {
    let tokens = variant_tokens(stem);
    let kept: Vec<&String> = if kind == KIND_SERIES {
        tokens
            .iter()
            .filter(|t| !EPISODE_TOKENS.contains(&mask_digits(&t.to_lowercase()).as_str()))
            .collect()
    } else {
        tokens.iter().collect()
    };
    let name = kept.iter().map(|s| s.as_str()).collect::<Vec<_>>().join(" ");
    if name.trim().is_empty() {
        stem.to_string()
    } else {
        name
    }
}

/// 数字の部分を数として比べる並び順 (ep2 < ep10)
pub fn natural_cmp(a: &str, b: &str) -> Ordering {
    let (mut ai, mut bi) = (a.chars().peekable(), b.chars().peekable());
    loop {
        match (ai.peek().copied(), bi.peek().copied()) {
            (None, None) => return Ordering::Equal,
            (None, Some(_)) => return Ordering::Less,
            (Some(_), None) => return Ordering::Greater,
            (Some(x), Some(y)) if x.is_ascii_digit() && y.is_ascii_digit() => {
                let mut na = String::new();
                while let Some(c) = ai.peek().copied().filter(|c| c.is_ascii_digit()) {
                    na.push(c);
                    ai.next();
                }
                let mut nb = String::new();
                while let Some(c) = bi.peek().copied().filter(|c| c.is_ascii_digit()) {
                    nb.push(c);
                    bi.next();
                }
                let (ta, tb) = (na.trim_start_matches('0'), nb.trim_start_matches('0'));
                let ord = ta.len().cmp(&tb.len()).then_with(|| ta.cmp(tb));
                if ord != Ordering::Equal {
                    return ord;
                }
            }
            (Some(x), Some(y)) => {
                let ord = x.to_lowercase().cmp(y.to_lowercase());
                if ord != Ordering::Equal {
                    return ord;
                }
                ai.next();
                bi.next();
            }
        }
    }
}

// ── DB helpers ────────────────────────────────────────────────────────────────

fn validate_kind(kind: &str) -> Result<&'static str, String> {
    match kind {
        KIND_VARIANTS => Ok(KIND_VARIANTS),
        KIND_SERIES => Ok(KIND_SERIES),
        other => Err(format!("グループの種類が正しくありません: {other}")),
    }
}

fn in_placeholders(n: usize) -> String {
    std::iter::repeat_n("?", n).collect::<Vec<_>>().join(", ")
}

/// 一覧に出す動画のグループの情報
pub fn group_rows_for_videos(conn: &Connection, video_ids: &[i64]) -> rusqlite::Result<Vec<VideoGroupRow>> {
    let mut out = Vec::new();
    for chunk in video_ids.chunks(500) {
        let sql = format!(
            "SELECT v.id, g.id, g.name, g.kind,
                    (SELECT COUNT(*) FROM videos m WHERE m.group_id = g.id)
             FROM videos v JOIN media_groups g ON g.id = v.group_id
             WHERE v.id IN ({})",
            in_placeholders(chunk.len())
        );
        let mut stmt = conn.prepare(&sql)?;
        let rows = stmt.query_map(rusqlite::params_from_iter(chunk.iter()), |r| {
            Ok(VideoGroupRow {
                video_id: r.get(0)?,
                group_id: r.get(1)?,
                name: r.get(2)?,
                kind: r.get(3)?,
                member_count: r.get(4)?,
            })
        })?;
        for row in rows {
            out.push(row?);
        }
    }
    Ok(out)
}

/// 動画がひとつも入っていないグループを消す
fn delete_empty_groups(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute(
        "DELETE FROM media_groups
         WHERE id NOT IN (SELECT DISTINCT group_id FROM videos WHERE group_id IS NOT NULL)",
        [],
    )?;
    Ok(())
}

/// 動画のファイル名で並べた ID の列
fn sort_ids_by_name(conn: &Connection, ids: &[i64]) -> rusqlite::Result<Vec<i64>> {
    let mut named: Vec<(i64, String)> = Vec::with_capacity(ids.len());
    let mut stmt = conn.prepare("SELECT path FROM videos WHERE id = ?1")?;
    for &id in ids {
        if let Some(path) = stmt.query_row([id], |r| r.get::<_, String>(0)).optional()? {
            if !named.iter().any(|(i, _)| *i == id) {
                named.push((id, file_stem(&path).to_string()));
            }
        }
    }
    named.sort_by(|a, b| natural_cmp(&a.1, &b.1).then(a.0.cmp(&b.0)));
    Ok(named.into_iter().map(|(id, _)| id).collect())
}

/// グループの後ろに動画を足す (他のグループに入っていたものは移す)
fn append_members(conn: &Connection, group_id: i64, video_ids: &[i64]) -> rusqlite::Result<()> {
    let sorted = sort_ids_by_name(conn, video_ids)?;
    let mut next: i64 = conn.query_row(
        "SELECT COALESCE(MAX(group_position), -1) + 1 FROM videos WHERE group_id = ?1",
        [group_id],
        |r| r.get(0),
    )?;
    let mut stmt = conn.prepare(
        "UPDATE videos SET group_id = ?1, group_position = ?2 WHERE id = ?3 AND COALESCE(group_id, -1) != ?1",
    )?;
    for id in sorted {
        if stmt.execute(params![group_id, next, id])? > 0 {
            next += 1;
        }
    }
    Ok(())
}

pub fn create_group(conn: &Connection, name: &str, kind: &str, video_ids: &[i64]) -> Result<i64, String> {
    let kind = validate_kind(kind)?;
    let name = name.trim();
    if name.is_empty() {
        return Err("グループの名前を入力してください".to_string());
    }
    if video_ids.is_empty() {
        return Err("まとめる動画を選んでください".to_string());
    }
    with_transaction(conn, || {
        conn.execute("INSERT INTO media_groups (name, kind) VALUES (?1, ?2)", params![name, kind])?;
        let id = conn.last_insert_rowid();
        append_members(conn, id, video_ids)?;
        delete_empty_groups(conn)?;
        Ok(id)
    })
}

pub fn add_to_group(conn: &Connection, group_id: i64, video_ids: &[i64]) -> Result<(), String> {
    let exists: bool = conn
        .query_row("SELECT 1 FROM media_groups WHERE id = ?1", [group_id], |_| Ok(true))
        .optional()
        .map_err(|e| e.to_string())?
        .unwrap_or(false);
    if !exists {
        return Err("グループが見つかりません".to_string());
    }
    with_transaction(conn, || {
        append_members(conn, group_id, video_ids)?;
        delete_empty_groups(conn)
    })
}

/// グループから外す。残りが 1 件以下になったグループは解く
pub fn remove_from_group(conn: &Connection, video_ids: &[i64]) -> Result<(), String> {
    if video_ids.is_empty() {
        return Ok(());
    }
    with_transaction(conn, || {
        let ph = in_placeholders(video_ids.len());
        conn.execute(
            &format!(
                "UPDATE media_groups SET cover_video_id = NULL WHERE cover_video_id IN ({ph})"
            ),
            rusqlite::params_from_iter(video_ids.iter()),
        )?;
        conn.execute(
            &format!("UPDATE videos SET group_id = NULL, group_position = NULL WHERE id IN ({ph})"),
            rusqlite::params_from_iter(video_ids.iter()),
        )?;
        conn.execute(
            "UPDATE videos SET group_id = NULL, group_position = NULL
             WHERE group_id IN (SELECT group_id FROM videos WHERE group_id IS NOT NULL
                                GROUP BY group_id HAVING COUNT(*) <= 1)",
            [],
        )?;
        delete_empty_groups(conn)
    })
}

pub fn reorder_group(conn: &Connection, group_id: i64, video_ids: &[i64]) -> Result<(), String> {
    with_transaction(conn, || {
        let mut stmt =
            conn.prepare("UPDATE videos SET group_position = ?1 WHERE id = ?2 AND group_id = ?3")?;
        for (pos, id) in video_ids.iter().enumerate() {
            stmt.execute(params![pos as i64, id, group_id])?;
        }
        Ok(())
    })
}

pub fn get_group(conn: &Connection, group_id: i64) -> rusqlite::Result<Option<GroupDetail>> {
    let head = conn
        .query_row(
            "SELECT id, name, kind, cover_video_id, COALESCE(created_at, '') FROM media_groups WHERE id = ?1",
            [group_id],
            |r| Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?, r.get::<_, String>(2)?, r.get::<_, Option<i64>>(3)?, r.get::<_, String>(4)?)),
        )
        .optional()?;
    let Some((id, name, kind, cover_video_id, created_at)) = head else {
        return Ok(None);
    };
    let mut stmt = conn.prepare(&format!(
        "SELECT {VIDEO_COLUMNS} FROM videos v WHERE v.group_id = ?1
         ORDER BY COALESCE(v.group_position, 0), v.id"
    ))?;
    let members = stmt.query_map([id], video_from_row)?.collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(Some(GroupDetail { id, name, kind, cover_video_id, created_at, members }))
}

fn with_transaction<T>(
    conn: &Connection,
    f: impl FnOnce() -> rusqlite::Result<T>,
) -> Result<T, String> {
    conn.execute_batch("BEGIN").map_err(|e| e.to_string())?;
    match f() {
        Ok(v) => {
            conn.execute_batch("COMMIT").map_err(|e| e.to_string())?;
            Ok(v)
        }
        Err(e) => {
            if let Err(rb) = conn.execute_batch("ROLLBACK") {
                log::error!("[db_groups] ROLLBACK 失敗: {rb}");
            }
            Err(e.to_string())
        }
    }
}

struct NameRow {
    video: Video,
    group_id: Option<i64>,
}

/// 候補探しの対象 (リンク・見つからないファイルは除く)
fn load_name_rows(conn: &Connection, dir: Option<&str>) -> rusqlite::Result<Vec<NameRow>> {
    let base = format!(
        "SELECT {VIDEO_COLUMNS}, v.group_id FROM videos v
         WHERE COALESCE(v.media_type, 'video') != 'link' AND COALESCE(v.status, '') != 'missing'"
    );
    let map = |r: &rusqlite::Row<'_>| Ok(NameRow { video: video_from_row(r)?, group_id: r.get(16)? });
    let rows = match dir {
        Some(d) => {
            let pattern = format!("{}/%", super::db_videos::escape_like_dir(d));
            let mut stmt = conn.prepare(&format!("{base} AND REPLACE(v.path, '\\', '/') LIKE ?1 ESCAPE '!'"))?;
            let r = stmt.query_map([pattern], map)?.collect::<rusqlite::Result<Vec<_>>>()?;
            r
        }
        None => {
            let mut stmt = conn.prepare(&base)?;
            let r = stmt.query_map([], map)?.collect::<rusqlite::Result<Vec<_>>>()?;
            r
        }
    };
    // サブフォルダの中身は除く (同じフォルダのものだけ)
    Ok(match dir {
        Some(d) => rows.into_iter().filter(|r| parent_dir(&r.video.path) == d).collect(),
        None => rows,
    })
}

/// ライブラリ全体から、まとめる候補を探す (まだグループに入っていないものだけ)
pub fn find_suggestions(conn: &Connection, limit: usize) -> rusqlite::Result<Vec<GroupSuggestion>> {
    let rows = load_name_rows(conn, None)?;
    let mut clusters: HashMap<(String, String), Vec<Video>> = HashMap::new();
    for row in rows.into_iter().filter(|r| r.group_id.is_none()) {
        let stem = file_stem(&row.video.path);
        let key = series_key(stem).unwrap_or_else(|| variant_key(stem));
        if key.trim().is_empty() {
            continue;
        }
        let dir = parent_dir(&row.video.path).to_string();
        clusters.entry((dir, key)).or_default().push(row.video);
    }

    let mut out: Vec<GroupSuggestion> = clusters
        .into_iter()
        .filter(|(_, v)| v.len() >= 2)
        .map(|((dir, key), mut videos)| {
            videos.sort_by(|a, b| natural_cmp(file_stem(&a.path), file_stem(&b.path)));
            let first = variant_key(file_stem(&videos[0].path));
            // 数字を除いても除かなくても同じ名前 → 同じ内容の別パターン、数字だけ違う → シリーズ
            let kind = if videos.iter().all(|v| variant_key(file_stem(&v.path)) == first) {
                KIND_VARIANTS
            } else {
                KIND_SERIES
            };
            GroupSuggestion {
                key: format!("{dir}\u{0}{key}"),
                name: suggested_name(file_stem(&videos[0].path), kind),
                kind: kind.to_string(),
                videos,
            }
        })
        .collect();
    out.sort_by(|a, b| b.videos.len().cmp(&a.videos.len()).then_with(|| natural_cmp(&a.name, &b.name)));
    out.truncate(limit);
    Ok(out)
}

/// ある動画と同じフォルダで、一緒にまとめられそうな動画を探す
pub fn find_candidates_for(conn: &Connection, video_id: i64) -> rusqlite::Result<GroupCandidates> {
    let target: Option<(String, Option<i64>)> = conn
        .query_row("SELECT path, group_id FROM videos WHERE id = ?1", [video_id], |r| {
            Ok((r.get(0)?, r.get(1)?))
        })
        .optional()?;
    let Some((path, own_group)) = target else {
        return Ok(GroupCandidates { suggested_name: String::new(), candidates: vec![] });
    };
    let stem = file_stem(&path);
    let v_key = variant_key(stem);
    let s_key = series_key(stem);

    let mut out: Vec<GroupCandidate> = load_name_rows(conn, Some(parent_dir(&path)))?
        .into_iter()
        .filter(|r| r.video.id != video_id && (own_group.is_none() || r.group_id != own_group))
        .filter_map(|r| {
            let other = file_stem(&r.video.path);
            let kind = if !v_key.is_empty() && variant_key(other) == v_key {
                KIND_VARIANTS
            } else if s_key.is_some() && series_key(other) == s_key {
                KIND_SERIES
            } else {
                return None;
            };
            Some(GroupCandidate { video: r.video, kind: kind.to_string(), group_id: r.group_id })
        })
        .collect();
    out.sort_by(|a, b| {
        (a.kind != KIND_VARIANTS)
            .cmp(&(b.kind != KIND_VARIANTS))
            .then_with(|| natural_cmp(file_stem(&a.video.path), file_stem(&b.video.path)))
    });
    out.truncate(50);
    // 別パターンが無くシリーズの候補だけなら、番号を除いた名前にする
    let kind = match out.first() {
        Some(c) if c.kind == KIND_SERIES => KIND_SERIES,
        _ => KIND_VARIANTS,
    };
    Ok(GroupCandidates { suggested_name: suggested_name(stem, kind), candidates: out })
}

// ── Tauri commands ────────────────────────────────────────────────────────────

/// 動画をまとめて新しいグループを作る。返り値は作ったグループの ID
#[tauri::command]
pub async fn db_group_create(
    state: State<'_, DbState>,
    name: String,
    kind: String,
    video_ids: Vec<i64>,
) -> Result<i64, String> {
    let conn = state.conn()?;
    create_group(&conn, &name, &kind, &video_ids)
}

#[tauri::command]
pub async fn db_group_add_videos(
    state: State<'_, DbState>,
    group_id: i64,
    video_ids: Vec<i64>,
) -> Result<(), String> {
    let conn = state.conn()?;
    add_to_group(&conn, group_id, &video_ids)
}

#[tauri::command]
pub async fn db_group_remove_videos(state: State<'_, DbState>, video_ids: Vec<i64>) -> Result<(), String> {
    let conn = state.conn()?;
    remove_from_group(&conn, &video_ids)
}

#[tauri::command]
pub async fn db_group_update(
    state: State<'_, DbState>,
    group_id: i64,
    name: Option<String>,
    kind: Option<String>,
) -> Result<(), String> {
    let conn = state.conn()?;
    if let Some(name) = name {
        let name = name.trim();
        if name.is_empty() {
            return Err("グループの名前を入力してください".to_string());
        }
        conn.execute("UPDATE media_groups SET name = ?1 WHERE id = ?2", params![name, group_id])
            .map_err(|e| e.to_string())?;
    }
    if let Some(kind) = kind {
        let kind = validate_kind(&kind)?;
        conn.execute("UPDATE media_groups SET kind = ?1 WHERE id = ?2", params![kind, group_id])
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// 代表 (一覧でまとめたときに出す動画) を決める
#[tauri::command]
pub async fn db_group_set_cover(state: State<'_, DbState>, group_id: i64, video_id: i64) -> Result<(), String> {
    let conn = state.conn()?;
    let changed = conn
        .execute(
            "UPDATE media_groups SET cover_video_id = ?1
             WHERE id = ?2 AND EXISTS (SELECT 1 FROM videos WHERE id = ?1 AND group_id = ?2)",
            params![video_id, group_id],
        )
        .map_err(|e| e.to_string())?;
    if changed == 0 {
        return Err("このグループの動画ではありません".to_string());
    }
    Ok(())
}

#[tauri::command]
pub async fn db_group_reorder(state: State<'_, DbState>, group_id: i64, video_ids: Vec<i64>) -> Result<(), String> {
    let conn = state.conn()?;
    reorder_group(&conn, group_id, &video_ids)
}

/// グループを解く (動画はそのまま残る)
#[tauri::command]
pub async fn db_group_delete(state: State<'_, DbState>, group_id: i64) -> Result<(), String> {
    let conn = state.conn()?;
    with_transaction(&conn, || {
        conn.execute("UPDATE videos SET group_id = NULL, group_position = NULL WHERE group_id = ?1", [group_id])?;
        conn.execute("DELETE FROM media_groups WHERE id = ?1", [group_id])?;
        Ok(())
    })
}

#[tauri::command]
pub async fn db_group_get(state: State<'_, DbState>, group_id: i64) -> Result<Option<GroupDetail>, String> {
    let conn = state.conn_read()?;
    get_group(&conn, group_id).map_err(|e| e.to_string())
}

/// 動画が入っているグループ (入っていなければ None)
#[tauri::command]
pub async fn db_group_for_video(state: State<'_, DbState>, video_id: i64) -> Result<Option<GroupDetail>, String> {
    let conn = state.conn_read()?;
    let group_id: Option<i64> = conn
        .query_row("SELECT group_id FROM videos WHERE id = ?1", [video_id], |r| r.get(0))
        .optional()
        .map_err(|e| e.to_string())?
        .flatten();
    match group_id {
        Some(id) => get_group(&conn, id).map_err(|e| e.to_string()),
        None => Ok(None),
    }
}

#[tauri::command]
pub async fn db_group_list(state: State<'_, DbState>) -> Result<Vec<GroupSummary>, String> {
    let conn = state.conn_read()?;
    let mut stmt = conn
        .prepare(
            "SELECT g.id, g.name, g.kind, COUNT(v.id),
                    COALESCE(
                      (SELECT c.thumbnail FROM videos c WHERE c.id = g.cover_video_id AND c.group_id = g.id),
                      (SELECT f.thumbnail FROM videos f WHERE f.group_id = g.id
                       ORDER BY COALESCE(f.group_position, 0), f.id LIMIT 1))
             FROM media_groups g JOIN videos v ON v.group_id = g.id
             GROUP BY g.id
             ORDER BY g.name COLLATE NOCASE",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |r| {
            Ok(GroupSummary {
                id: r.get(0)?,
                name: r.get(1)?,
                kind: r.get(2)?,
                member_count: r.get(3)?,
                thumbnail: r.get(4)?,
            })
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<rusqlite::Result<Vec<_>>>().map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn db_group_suggestions(state: State<'_, DbState>) -> Result<Vec<GroupSuggestion>, String> {
    let conn = state.conn_read()?;
    find_suggestions(&conn, 200).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn db_group_candidates_for_video(
    state: State<'_, DbState>,
    video_id: i64,
) -> Result<GroupCandidates, String> {
    let conn = state.conn_read()?;
    find_candidates_for(&conn, video_id).map_err(|e| e.to_string())
}

// ── tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::schema::init_db;

    fn setup() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        init_db(&conn).unwrap();
        conn
    }

    fn insert(conn: &Connection, path: &str) -> i64 {
        conn.execute("INSERT INTO videos (path, status) VALUES (?1, 'active')", [path]).unwrap();
        conn.last_insert_rowid()
    }

    fn member_paths(conn: &Connection, group_id: i64) -> Vec<String> {
        get_group(conn, group_id).unwrap().unwrap().members.into_iter().map(|v| v.path).collect()
    }

    #[test]
    fn variant_key_ignores_quality_version_and_copy_marks() {
        let base = variant_key("Trip to Kyoto");
        for stem in [
            "Trip to Kyoto [1080p]",
            "Trip_to_Kyoto_720p",
            "Trip to Kyoto (1)",
            "Trip to Kyoto copy 2",
            "Trip to Kyoto v2",
            "Trip to Kyoto.av1",
            "Trip to Kyoto.av1_3",
            "trip-to-kyoto-4K-HEVC",
            "Trip to Kyoto 1920x1080",
            "Trip to Kyotoのコピー",
            "Ｔｒｉｐ ｔｏ Ｋｙｏｔｏ",
        ] {
            assert_eq!(variant_key(stem), base, "{stem}");
        }
        assert_ne!(variant_key("Trip to Osaka"), base);
    }

    #[test]
    fn series_key_matches_episode_numbers_only() {
        let a = series_key("My Show - 01 [1080p]").unwrap();
        assert_eq!(series_key("My Show - 12 [720p]").unwrap(), a);
        assert_eq!(series_key("My Show ep3"), series_key("My Show ep10"));
        assert_eq!(series_key("番組 第1話"), series_key("番組 第12話"));
        assert_ne!(series_key("Other Show - 01").unwrap(), a);
        assert_eq!(series_key("My Show"), None, "番号が無ければシリーズではない");
    }

    #[test]
    fn series_key_skips_camera_and_date_names() {
        assert_eq!(series_key("IMG_1234"), None);
        assert_eq!(series_key("DSC01234"), None);
        assert_eq!(series_key("2024-01-02 10.11.12"), None);
        assert_eq!(series_key("スクリーンショット 2024-01-02 10.11.12"), None);
    }

    #[test]
    fn suggested_name_drops_episode_part_for_series() {
        assert_eq!(suggested_name("My Show - 01 [1080p]", KIND_SERIES), "My Show");
        assert_eq!(suggested_name("番組 第3話", KIND_SERIES), "番組");
        assert_eq!(suggested_name("Trip to Kyoto 720p", KIND_VARIANTS), "Trip to Kyoto");
    }

    #[test]
    fn natural_cmp_orders_numbers_by_value() {
        let mut v = vec!["ep10", "ep2", "ep1", "Ep03"];
        v.sort_by(|a, b| natural_cmp(a, b));
        assert_eq!(v, ["ep1", "ep2", "Ep03", "ep10"]);
    }

    #[test]
    fn create_group_orders_members_by_file_name() {
        let conn = setup();
        let ids = [insert(&conn, "/v/show 10.mp4"), insert(&conn, "/v/show 2.mp4"), insert(&conn, "/v/show 1.mp4")];
        let g = create_group(&conn, "show", KIND_SERIES, &ids).unwrap();
        assert_eq!(member_paths(&conn, g), ["/v/show 1.mp4", "/v/show 2.mp4", "/v/show 10.mp4"]);
    }

    #[test]
    fn moving_videos_to_another_group_removes_emptied_group() {
        let conn = setup();
        let a = insert(&conn, "/v/a.mp4");
        let b = insert(&conn, "/v/b.mp4");
        let g1 = create_group(&conn, "one", KIND_VARIANTS, &[a, b]).unwrap();
        let g2 = create_group(&conn, "two", KIND_VARIANTS, &[a, b]).unwrap();
        assert!(get_group(&conn, g1).unwrap().is_none(), "空になったグループは消える");
        assert_eq!(member_paths(&conn, g2).len(), 2);
    }

    #[test]
    fn removing_down_to_one_member_dissolves_group() {
        let conn = setup();
        let a = insert(&conn, "/v/a.mp4");
        let b = insert(&conn, "/v/b.mp4");
        let c = insert(&conn, "/v/c.mp4");
        let g = create_group(&conn, "g", KIND_VARIANTS, &[a, b, c]).unwrap();
        conn.execute("UPDATE media_groups SET cover_video_id = ?1 WHERE id = ?2", [a, g]).unwrap();
        remove_from_group(&conn, &[a]).unwrap();
        let detail = get_group(&conn, g).unwrap().unwrap();
        assert_eq!(detail.members.len(), 2);
        assert_eq!(detail.cover_video_id, None, "外した動画が代表なら代表を外す");
        remove_from_group(&conn, &[b]).unwrap();
        assert!(get_group(&conn, g).unwrap().is_none());
        let left: Option<i64> = conn.query_row("SELECT group_id FROM videos WHERE id = ?1", [c], |r| r.get(0)).unwrap();
        assert_eq!(left, None);
    }

    #[test]
    fn deleting_a_video_keeps_the_group_consistent() {
        let conn = setup();
        let a = insert(&conn, "/v/a.mp4");
        let b = insert(&conn, "/v/b.mp4");
        let g = create_group(&conn, "g", KIND_VARIANTS, &[a, b]).unwrap();
        conn.execute("UPDATE media_groups SET cover_video_id = ?1 WHERE id = ?2", [a, g]).unwrap();
        conn.execute("DELETE FROM videos WHERE id = ?1", [a]).unwrap();
        let detail = get_group(&conn, g).unwrap().unwrap();
        assert_eq!(detail.cover_video_id, None);
        assert_eq!(detail.members.len(), 1);
    }

    #[test]
    fn group_rows_report_member_count() {
        let conn = setup();
        let a = insert(&conn, "/v/a.mp4");
        let b = insert(&conn, "/v/b.mp4");
        let c = insert(&conn, "/v/c.mp4");
        let g = create_group(&conn, "g", KIND_SERIES, &[a, b]).unwrap();
        let rows = group_rows_for_videos(&conn, &[a, c]).unwrap();
        assert_eq!(
            rows,
            [VideoGroupRow { video_id: a, group_id: g, name: "g".into(), kind: KIND_SERIES.into(), member_count: 2 }]
        );
    }

    #[test]
    fn suggestions_find_variants_and_series_in_the_same_folder() {
        let conn = setup();
        for p in [
            "/v/Trip [1080p].mp4",
            "/v/Trip [720p].mp4",
            "/v/Trip.av1.mkv",
            "/v/Show 01.mp4",
            "/v/Show 02.mp4",
            "/v/Show 03.mp4",
            "/v/IMG_0001.jpg",
            "/v/IMG_0002.jpg",
            "/other/Show 04.mp4",
            "/v/Alone.mp4",
        ] {
            insert(&conn, p);
        }
        let s = find_suggestions(&conn, 10).unwrap();
        let summary: Vec<(String, String, usize)> =
            s.iter().map(|g| (g.name.clone(), g.kind.clone(), g.videos.len())).collect();
        assert_eq!(
            summary,
            [("Show".to_string(), KIND_SERIES.to_string(), 3), ("Trip".to_string(), KIND_VARIANTS.to_string(), 3)]
        );
    }

    #[test]
    fn suggestions_skip_grouped_videos() {
        let conn = setup();
        let a = insert(&conn, "/v/Trip 720p.mp4");
        let b = insert(&conn, "/v/Trip 1080p.mp4");
        create_group(&conn, "Trip", KIND_VARIANTS, &[a, b]).unwrap();
        assert!(find_suggestions(&conn, 10).unwrap().is_empty());
    }

    #[test]
    fn candidates_for_video_lists_variants_before_series() {
        let conn = setup();
        let target = insert(&conn, "/v/Show 01.mp4");
        insert(&conn, "/v/Show 02.mp4");
        insert(&conn, "/v/Show 01 [720p].mp4");
        insert(&conn, "/v/sub/Show 03.mp4");
        insert(&conn, "/v/Unrelated.mp4");
        let found = find_candidates_for(&conn, target).unwrap();
        assert_eq!(found.suggested_name, "Show 01");
        let got: Vec<(&str, &str)> = found.candidates.iter().map(|c| (c.video.path.as_str(), c.kind.as_str())).collect();
        assert_eq!(got, [("/v/Show 01 [720p].mp4", KIND_VARIANTS), ("/v/Show 02.mp4", KIND_SERIES)]);
    }
}
