//! ストレージ整理の「重複」候補。
//!
//! 2 種類の重複をまとめて 1 つのグループにする。
//! - 中身が同じ: ファイルサイズが同じで、先頭・中央・末尾の抜き出しのハッシュも一致する
//! - 見た目が似ている: pHash のハミング距離が小さく、(動画なら) 長さもほぼ同じ
//!
//! 各グループで残すもの (`keep_id`) を 1 つ選び、残り全部を消したときに空く容量を返す。
//! APFS のクローン (中身のブロックを共有するコピー) は消しても空きがほとんど増えないため、
//! `fs_clone` で読んだ共有していない容量で見込みを補正する。
//!
//! 抜き出しのハッシュは `videos.content_digest` に取っておき、サイズと更新日時が変わっていなければ
//! 次からはファイルを読まずに使う (外付けや NAS では読み比べがいちばん時間がかかる)。

use std::cell::RefCell;
use std::collections::HashMap;
use std::io::{Read, Seek, SeekFrom};
use std::path::Path;
use std::time::UNIX_EPOCH;

use serde::Serialize;
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Manager};

use super::fs_clone::{clone_info, CloneInfo};
use super::phash::hamming_distance;
use super::storage::{cleanup_item_columns, item_from_row, CleanupItem, CLEANUP_ITEM_COLUMN_COUNT, ON_DISK_FILTER};
use crate::db::DbState;

/// 「見た目が似ている」とみなす pHash のハミング距離の上限。
/// 詳細画面の類似検索 (既定 8) より厳しくし、消してよい重複に絞る
const SIMILAR_PHASH_DISTANCE: u32 = 6;

/// 中身の比較で読む量 (先頭・中央・末尾それぞれ)
const SAMPLE_BYTES: u64 = 256 * 1024;

/// pHash のバケットがこれより大きいときは比較を飛ばす (単色フレーム等で同じ値が大量に出たとき用)
const MAX_BUCKET: usize = 2000;

/// 返すグループ数の上限 (件数・容量の合計は全グループ分)
const GROUP_LIMIT: usize = 200;

struct Row {
    item: CleanupItem,
    phash: Option<u64>,
    /// DB に取っておいた抜き出しのハッシュ
    cached: Option<CachedDigest>,
}

/// 抜き出しのハッシュと、計算したときのファイルの「サイズ:更新日時 (ナノ秒)」
#[derive(Debug, Clone, PartialEq)]
struct CachedDigest {
    key: String,
    digest: [u8; 32],
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct DuplicateGroup {
    /// すべてのファイルの中身が同じ
    pub exact: bool,
    pub keep_id: i64,
    /// 残すもの以外を消したときに空く容量 (クローンで共有している分は除く)
    pub reclaimable_bytes: i64,
    /// 残すものが先頭、残りは容量の大きい順
    pub items: Vec<CleanupItem>,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct DuplicateGroups {
    pub total_groups: usize,
    pub total_reclaimable_bytes: i64,
    /// pHash が未計算の動画・画像 (計算すると「似ている」の対象になる)
    pub phash_missing_count: i64,
    pub groups: Vec<DuplicateGroup>,
}

struct UnionFind(Vec<usize>);

impl UnionFind {
    fn new(n: usize) -> Self {
        Self((0..n).collect())
    }
    fn find(&mut self, mut x: usize) -> usize {
        while self.0[x] != x {
            self.0[x] = self.0[self.0[x]];
            x = self.0[x];
        }
        x
    }
    fn union(&mut self, a: usize, b: usize) {
        let (ra, rb) = (self.find(a), self.find(b));
        if ra != rb {
            self.0[rb] = ra;
        }
    }
}

/// 先頭・中央・末尾の抜き出しとサイズのハッシュ。
/// 読めない・DB のサイズと実際のサイズが違うときは None (比較しない)
fn sample_digest(path: &Path, expected_size: u64) -> Option<[u8; 32]> {
    let mut file = std::fs::File::open(path).ok()?;
    let size = file.metadata().ok()?.len();
    if size != expected_size {
        return None;
    }
    let mut hasher = Sha256::new();
    hasher.update(size.to_le_bytes());
    let mut offsets = vec![0, (size / 2).saturating_sub(SAMPLE_BYTES / 2), size.saturating_sub(SAMPLE_BYTES)];
    offsets.dedup();
    let mut buf = Vec::with_capacity(SAMPLE_BYTES as usize);
    for off in offsets {
        file.seek(SeekFrom::Start(off)).ok()?;
        buf.clear();
        (&mut file).take(SAMPLE_BYTES).read_to_end(&mut buf).ok()?;
        hasher.update(&buf);
    }
    Some(hasher.finalize().into())
}

fn digest_key(meta: &std::fs::Metadata) -> Option<String> {
    let mtime = meta.modified().ok()?.duration_since(UNIX_EPOCH).ok()?.as_nanos();
    Some(format!("{}:{mtime}", meta.len()))
}

/// 取っておいたハッシュが今のファイル (サイズ・更新日時) と合えばそれを使い、合わなければ読み直す。
/// 2 つ目は新しく計算した分 (DB に保存する)
fn digest_with_cache(
    path: &Path,
    expected_size: u64,
    cached: Option<&CachedDigest>,
) -> (Option<[u8; 32]>, Option<CachedDigest>) {
    let Ok(meta) = std::fs::metadata(path) else { return (None, None) };
    if meta.len() != expected_size {
        return (None, None);
    }
    let key = digest_key(&meta);
    if let (Some(key), Some(c)) = (&key, cached) {
        if *key == c.key {
            return (Some(c.digest), None);
        }
    }
    let digest = sample_digest(path, expected_size);
    (digest, digest.zip(key).map(|(digest, key)| CachedDigest { key, digest }))
}

fn digest_to_hex(d: &[u8; 32]) -> String {
    d.iter().map(|b| format!("{b:02x}")).collect()
}

fn digest_from_hex(s: &str) -> Option<[u8; 32]> {
    if s.len() != 64 || !s.is_ascii() {
        return None;
    }
    let mut out = [0u8; 32];
    for (i, b) in out.iter_mut().enumerate() {
        *b = u8::from_str_radix(&s[i * 2..i * 2 + 2], 16).ok()?;
    }
    Some(out)
}

fn save_digests(conn: &mut rusqlite::Connection, fresh: &[(i64, CachedDigest)]) -> rusqlite::Result<()> {
    let tx = conn.transaction()?;
    {
        let mut stmt = tx.prepare("UPDATE videos SET content_digest = ?1, content_digest_key = ?2 WHERE id = ?3")?;
        for (id, c) in fresh {
            stmt.execute(rusqlite::params![digest_to_hex(&c.digest), c.key, id])?;
        }
    }
    tx.commit()
}

/// 長さが近いか。両方とも長さがない (画像) なら近いとみなし、片方だけなら別物とする
fn durations_close(a: Option<f64>, b: Option<f64>) -> bool {
    match (a.filter(|d| *d > 0.0), b.filter(|d| *d > 0.0)) {
        (Some(x), Some(y)) => (x - y).abs() <= f64::max(2.0, x.max(y) * 0.01),
        (None, None) => true,
        _ => false,
    }
}

fn looks_similar(a: &Row, b: &Row) -> bool {
    let (Some(ha), Some(hb)) = (a.phash, b.phash) else { return false };
    a.item.media_type == b.item.media_type
        && hamming_distance(ha, hb) <= SIMILAR_PHASH_DISTANCE
        && durations_close(a.item.duration, b.item.duration)
}

/// 64 ビットを (距離の上限 + 1) 個に分けた i 番目の値。
/// 距離が上限以下なら、鳩の巣原理でどれか 1 つは完全に一致する
fn phash_chunk(hash: u64, i: u32) -> u64 {
    let parts = SIMILAR_PHASH_DISTANCE + 1;
    let start = i * 64 / parts;
    let end = (i + 1) * 64 / parts;
    (hash >> start) & ((1u64 << (end - start)) - 1)
}

/// 残すものを選ぶ: 評価 → 再生回数が高いもの。
/// 中身が同じなら先に登録したもの、似ているだけなら容量の大きい (画質が高い見込みの) もの
fn keep_index(rows: &[Row], members: &[usize], exact: bool) -> usize {
    *members
        .iter()
        .max_by_key(|&&i| {
            let it = &rows[i].item;
            let size = if exact { 0 } else { it.file_size };
            (it.rating, it.watch_count, size, std::cmp::Reverse(it.id))
        })
        .expect("グループは 2 件以上")
}

/// `removed` を消したときに空く容量の見込み (src/components/Library/storageTypes.ts の `freedBytes` と同じ規則)。
/// - クローンでないもの: 共有していない容量 (分からなければファイルサイズ)
/// - 残すものとクローンのもの: 共有していない容量だけ (共有分は残すものが使い続ける)
/// - 消すものどうしだけでクローンのもの: 共有分は 1 回だけ数える (最初の 1 つはファイルサイズ、残りは共有していない容量)
pub(crate) fn freed_bytes(items: &[CleanupItem], removed: impl Fn(&CleanupItem) -> bool) -> i64 {
    let private = |it: &CleanupItem| it.private_bytes.map_or(it.file_size, |p| p.min(it.file_size));
    let kept_groups: std::collections::HashSet<u32> =
        items.iter().filter(|it| !removed(it)).filter_map(|it| it.clone_group).collect();
    let mut counted: std::collections::HashSet<u32> = std::collections::HashSet::new();
    items
        .iter()
        .filter(|it| removed(it))
        .map(|it| match it.clone_group {
            Some(g) if !kept_groups.contains(&g) && counted.insert(g) => it.file_size,
            _ => private(it),
        })
        .sum()
}

/// クローンの情報を入れ、互いにクローンのものに同じ番号を付ける
fn attach_clone_info(items: &mut [CleanupItem], infos: &[Option<CloneInfo>]) {
    let mut count: HashMap<u64, usize> = HashMap::new();
    for info in infos.iter().flatten() {
        *count.entry(info.clone_id).or_default() += 1;
    }
    let mut numbers: HashMap<u64, u32> = HashMap::new();
    for (it, info) in items.iter_mut().zip(infos) {
        let Some(info) = info else { continue };
        it.private_bytes = i64::try_from(info.private_bytes).ok();
        if count[&info.clone_id] > 1 {
            let next = numbers.len() as u32;
            it.clone_group = Some(*numbers.entry(info.clone_id).or_insert(next));
        }
    }
}

fn build_groups(
    rows: Vec<Row>,
    digest_of: impl Fn(&CleanupItem) -> Option<[u8; 32]>,
    clone_of: impl Fn(&CleanupItem) -> Option<CloneInfo>,
) -> Vec<DuplicateGroup> {
    let n = rows.len();
    let mut uf = UnionFind::new(n);

    // 中身が同じ: サイズが同じものだけ読み比べる
    let mut by_size: HashMap<i64, Vec<usize>> = HashMap::new();
    for (i, r) in rows.iter().enumerate() {
        by_size.entry(r.item.file_size).or_default().push(i);
    }
    let mut digests: Vec<Option<[u8; 32]>> = vec![None; n];
    for members in by_size.values().filter(|m| m.len() > 1) {
        let mut by_digest: HashMap<[u8; 32], usize> = HashMap::new();
        for &i in members {
            let Some(d) = digest_of(&rows[i].item) else { continue };
            digests[i] = Some(d);
            match by_digest.get(&d) {
                Some(&first) => uf.union(first, i),
                None => {
                    by_digest.insert(d, i);
                }
            }
        }
    }

    // 見た目が似ている: pHash を分割した値が一致するものどうしだけ比べる
    for part in 0..=SIMILAR_PHASH_DISTANCE {
        let mut buckets: HashMap<u64, Vec<usize>> = HashMap::new();
        for (i, r) in rows.iter().enumerate() {
            if let Some(h) = r.phash {
                buckets.entry(phash_chunk(h, part)).or_default().push(i);
            }
        }
        for members in buckets.values().filter(|m| m.len() > 1 && m.len() <= MAX_BUCKET) {
            for (k, &a) in members.iter().enumerate() {
                for &b in &members[k + 1..] {
                    if looks_similar(&rows[a], &rows[b]) {
                        uf.union(a, b);
                    }
                }
            }
        }
    }

    let mut components: HashMap<usize, Vec<usize>> = HashMap::new();
    for i in 0..n {
        let root = uf.find(i);
        components.entry(root).or_default().push(i);
    }

    let mut groups: Vec<DuplicateGroup> = components
        .into_values()
        .filter(|m| m.len() > 1)
        .map(|members| {
            let first = digests[members[0]];
            let exact = first.is_some() && members.iter().all(|&i| digests[i] == first);
            let keep = keep_index(&rows, &members, exact);
            let mut ordered: Vec<usize> = members.into_iter().filter(|&i| i != keep).collect();
            ordered.sort_by(|&a, &b| {
                rows[b].item.file_size.cmp(&rows[a].item.file_size).then(rows[a].item.id.cmp(&rows[b].item.id))
            });
            ordered.insert(0, keep);
            let mut items: Vec<CleanupItem> = ordered.into_iter().map(|i| rows[i].item.clone()).collect();
            let infos: Vec<Option<CloneInfo>> = items.iter().map(&clone_of).collect();
            attach_clone_info(&mut items, &infos);
            let keep_id = rows[keep].item.id;
            DuplicateGroup {
                exact,
                keep_id,
                reclaimable_bytes: freed_bytes(&items, |it| it.id != keep_id),
                items,
            }
        })
        .collect();

    groups.sort_by(|a, b| b.reclaimable_bytes.cmp(&a.reclaimable_bytes).then(a.keep_id.cmp(&b.keep_id)));
    groups
}

fn load_rows(conn: &rusqlite::Connection) -> Result<(Vec<Row>, i64), String> {
    let mut stmt = conn
        .prepare(&format!(
            "SELECT {}, phash, content_digest, content_digest_key FROM videos WHERE {ON_DISK_FILTER}",
            cleanup_item_columns()
        ))
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |r| {
            let phash = r
                .get::<_, Option<String>>(CLEANUP_ITEM_COLUMN_COUNT)?
                .and_then(|p| p.parse::<u64>().ok())
                // 単色のフレームなどは何でも一致してしまうので使わない
                .filter(|&h| h != 0 && h != u64::MAX);
            let digest = r.get::<_, Option<String>>(CLEANUP_ITEM_COLUMN_COUNT + 1)?;
            let key = r.get::<_, Option<String>>(CLEANUP_ITEM_COLUMN_COUNT + 2)?;
            let cached = digest
                .as_deref()
                .and_then(digest_from_hex)
                .zip(key)
                .map(|(digest, key)| CachedDigest { key, digest });
            Ok(Row { item: item_from_row(r)?, phash, cached })
        })
        .map_err(|e| e.to_string())?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(|e| e.to_string())?;
    let phash_missing: i64 = conn
        .query_row(
            &format!("SELECT COUNT(*) FROM videos WHERE {ON_DISK_FILTER} AND phash IS NULL AND media_type IN ('video', 'image')"),
            [],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;
    Ok((rows, phash_missing))
}

/// 重複のグループを、消したときに空く容量の大きい順に返す
#[tauri::command]
pub async fn get_duplicate_groups(app: AppHandle) -> Result<DuplicateGroups, String> {
    // ファイルの情報を読む・読み比べるのはどれも待ちが長いので、まとめて別スレッドで行う
    tokio::task::spawn_blocking(move || {
        let state = app.state::<DbState>();
        if let Err(e) = super::db_videos::fill_missing_file_sizes(&state) {
            log::warn!("[storage] file_size の取得に失敗しました: {e}");
        }
        let (mut rows, phash_missing_count) = {
            let conn = state.conn_read()?;
            load_rows(&conn)?
        };
        let cache: HashMap<i64, CachedDigest> =
            rows.iter_mut().filter_map(|r| r.cached.take().map(|c| (r.item.id, c))).collect();
        let fresh: RefCell<Vec<(i64, CachedDigest)>> = RefCell::new(Vec::new());
        let mut groups = build_groups(
            rows,
            |it| {
                let (digest, new) =
                    digest_with_cache(Path::new(&it.path), u64::try_from(it.file_size).ok()?, cache.get(&it.id));
                if let Some(new) = new {
                    fresh.borrow_mut().push((it.id, new));
                }
                digest
            },
            |it| clone_info(Path::new(&it.path)),
        );
        let fresh = fresh.into_inner();
        if !fresh.is_empty() {
            // 保存できなくても結果は返す (次回また読む)
            if let Err(e) = state.conn().and_then(|mut c| save_digests(&mut c, &fresh).map_err(|e| e.to_string())) {
                log::warn!("[storage] 重複の比較結果を保存できませんでした: {e}");
            }
        }
        let total_groups = groups.len();
        let total_reclaimable_bytes = groups.iter().map(|g| g.reclaimable_bytes).sum();
        groups.truncate(GROUP_LIMIT);
        Ok(DuplicateGroups { total_groups, total_reclaimable_bytes, phash_missing_count, groups })
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    fn row(id: i64, size: i64, phash: Option<u64>, duration: Option<f64>) -> Row {
        Row {
            item: CleanupItem {
                id,
                path: format!("/m/{id}"),
                title: None,
                thumbnail: None,
                file_size: size,
                media_type: if duration.is_some() { "video" } else { "image" }.into(),
                rating: 0,
                watch_count: 0,
                created_at: String::new(),
                last_seen_at: None,
                duration,
                category_id: None,
                private_bytes: None,
                clone_group: None,
                silent_streams: None,
                silent_bytes: None,
                silent_sampled: None,
                saving_ratio: None,
            },
            phash,
            cached: None,
        }
    }

    fn ids(g: &DuplicateGroup) -> Vec<i64> {
        g.items.iter().map(|i| i.id).collect()
    }

    /// id ごとの「中身」を決める (同じ値なら同じ中身)
    fn digest_by(content: &'static [(i64, u8)]) -> impl Fn(&CleanupItem) -> Option<[u8; 32]> {
        move |it| content.iter().find(|(id, _)| *id == it.id).map(|(_, c)| [*c; 32])
    }

    #[test]
    fn exact_groups_need_same_size_and_same_content() {
        let rows = vec![
            row(1, 100, None, Some(10.0)),
            row(2, 100, None, Some(10.0)),
            row(3, 100, None, Some(10.0)), // サイズは同じだが中身が違う
            row(4, 999, None, Some(10.0)),
        ];
        let groups = build_groups(rows, digest_by(&[(1, 1), (2, 1), (3, 2), (4, 1)]), |_| None);
        assert_eq!(groups.len(), 1);
        assert!(groups[0].exact);
        assert_eq!(groups[0].keep_id, 1, "中身が同じなら先に登録したものを残す");
        assert_eq!(ids(&groups[0]), vec![1, 2]);
        assert_eq!(groups[0].reclaimable_bytes, 100);
    }

    #[test]
    fn similar_groups_use_phash_and_duration() {
        let base = 0x0123_4567_89ab_cdefu64;
        let rows = vec![
            row(1, 500, Some(base), Some(600.0)),
            row(2, 900, Some(base ^ 0b11_1111), Some(601.0)), // 距離 6・長さもほぼ同じ
            row(3, 400, Some(base), Some(300.0)),             // 見た目は同じだが長さが違う
            row(4, 400, Some(base ^ (0x7f << 32)), Some(600.0)), // 1 とは距離 7、2 とは距離 13
        ];
        let groups = build_groups(rows, |_| None, |_| None);
        assert_eq!(groups.len(), 1);
        assert!(!groups[0].exact);
        assert_eq!(groups[0].keep_id, 2, "似ているだけなら容量の大きいものを残す");
        assert_eq!(ids(&groups[0]), vec![2, 1]);
        assert_eq!(groups[0].reclaimable_bytes, 500);
    }

    #[test]
    fn rating_wins_over_size_when_choosing_what_to_keep() {
        let mut small = row(1, 100, Some(42), None);
        small.item.rating = 5;
        let rows = vec![small, row(2, 900, Some(42), None)];
        let groups = build_groups(rows, |_| None, |_| None);
        assert_eq!(groups[0].keep_id, 1);
        assert_eq!(groups[0].reclaimable_bytes, 900);
    }

    #[test]
    fn images_and_videos_are_never_grouped_together() {
        let rows = vec![row(1, 100, Some(42), None), row(2, 200, Some(42), Some(10.0))];
        assert!(build_groups(rows, |_| None, |_| None).is_empty());
    }

    /// id ごとのクローン情報 (id, 共有していない容量, clone_id)
    fn clones_by(table: &'static [(i64, u64, u64)]) -> impl Fn(&CleanupItem) -> Option<CloneInfo> {
        move |it| {
            table
                .iter()
                .find(|(id, _, _)| *id == it.id)
                .map(|&(_, private_bytes, clone_id)| CloneInfo { private_bytes, clone_id })
        }
    }

    #[test]
    fn clones_of_the_kept_file_free_almost_nothing() {
        let rows = vec![row(1, 1000, None, Some(10.0)), row(2, 1000, None, Some(10.0)), row(3, 1000, None, Some(10.0))];
        // 1 と 2 はクローン (共有していない分は 0)、3 は別に書いたコピー (割り当て単位で切り上がる)
        let groups = build_groups(
            rows,
            digest_by(&[(1, 1), (2, 1), (3, 1)]),
            clones_by(&[(1, 0, 7), (2, 0, 7), (3, 4096, 9)]),
        );
        let g = &groups[0];
        assert_eq!(g.keep_id, 1);
        assert_eq!(g.reclaimable_bytes, 1000, "2 はクローンなので空かず、3 はファイルサイズまで");
        let group_of = |id: i64| g.items.iter().find(|i| i.id == id).unwrap().clone_group;
        assert_eq!(group_of(1), group_of(2));
        assert!(group_of(1).is_some());
        assert_eq!(group_of(3), None, "クローン相手がグループにいなければ番号を付けない");
    }

    #[test]
    fn clones_among_removed_files_count_shared_blocks_once() {
        let item = |id: i64, private_bytes: Option<i64>, clone_group: Option<u32>| CleanupItem {
            private_bytes,
            clone_group,
            ..row(id, 1000, None, None).item
        };
        let items = vec![item(1, Some(1000), None), item(2, Some(0), Some(0)), item(3, Some(0), Some(0))];
        // 2 と 3 を両方消せば共有分も空く
        assert_eq!(freed_bytes(&items, |it| it.id != 1), 1000);
        // 3 を残すなら 2 を消しても空かない
        assert_eq!(freed_bytes(&items, |it| it.id == 2), 0);
        // クローン情報がなければファイルサイズ
        let plain = vec![row(1, 300, None, None).item, row(2, 500, None, None).item];
        assert_eq!(freed_bytes(&plain, |_| true), 800);
    }

    #[test]
    fn phash_chunks_cover_all_bits_once() {
        let mut combined = 0u64;
        let mut bits = 0;
        for i in 0..=SIMILAR_PHASH_DISTANCE {
            let start = i * 64 / (SIMILAR_PHASH_DISTANCE + 1);
            combined |= phash_chunk(u64::MAX, i) << start;
            bits += phash_chunk(u64::MAX, i).count_ones();
        }
        assert_eq!(combined, u64::MAX);
        assert_eq!(bits, 64);
    }

    #[test]
    fn sample_digest_detects_differences_and_stale_sizes() {
        let dir = std::env::temp_dir().join(format!("css-dup-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let size = (SAMPLE_BYTES * 4) as usize;
        let a = dir.join("a.bin");
        let b = dir.join("b.bin");
        let c = dir.join("c.bin");
        let data = vec![7u8; size];
        std::fs::write(&a, &data).unwrap();
        std::fs::write(&b, &data).unwrap();
        let mut changed = data.clone();
        changed[size - 1] = 8; // 末尾だけ違う
        std::fs::write(&c, &changed).unwrap();

        let n = size as u64;
        assert!(sample_digest(&a, n).is_some());
        assert_eq!(sample_digest(&a, n), sample_digest(&b, n));
        assert_ne!(sample_digest(&a, n), sample_digest(&c, n));
        assert_eq!(sample_digest(&a, n + 1), None, "DB のサイズが古ければ比べない");
    }

    #[test]
    fn digest_cache_is_used_until_the_file_changes() {
        let dir = std::env::temp_dir().join(format!("css-dup-cache-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("a.bin");
        std::fs::write(&path, vec![1u8; 4096]).unwrap();

        let (first, fresh) = digest_with_cache(&path, 4096, None);
        let fresh = fresh.expect("初回は計算して保存する");
        assert_eq!(first, Some(fresh.digest));

        // 同じサイズ・更新日時なら読まずに取っておいた値を使う (値が違うことで読んでいないと分かる)
        let stale = CachedDigest { key: fresh.key.clone(), digest: [9; 32] };
        assert_eq!(digest_with_cache(&path, 4096, Some(&stale)), (Some([9; 32]), None));

        // 中身を書き換えて更新日時が変われば読み直す
        std::fs::write(&path, vec![2u8; 4096]).unwrap();
        let f = std::fs::File::options().write(true).open(&path).unwrap();
        f.set_modified(std::time::SystemTime::now() + std::time::Duration::from_secs(5)).unwrap();
        let (again, new) = digest_with_cache(&path, 4096, Some(&stale));
        assert_ne!(again, Some([9; 32]));
        assert!(new.is_some());
        assert_ne!(again, first);

        // DB のサイズが古ければ比べない
        assert_eq!(digest_with_cache(&path, 1, None), (None, None));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn digest_hex_round_trips_and_rejects_junk() {
        let d: [u8; 32] = std::array::from_fn(|i| (i * 7) as u8);
        assert_eq!(digest_from_hex(&digest_to_hex(&d)), Some(d));
        assert_eq!(digest_from_hex("zz"), None);
        assert_eq!(digest_from_hex(&"g".repeat(64)), None);
    }

    #[test]
    fn digests_are_saved_and_loaded_back() {
        let mut conn = rusqlite::Connection::open_in_memory().unwrap();
        crate::db::schema::init_db(&conn).unwrap();
        conn.execute("INSERT INTO videos (path, media_type, status, file_size) VALUES ('/m/a.mp4', 'video', 'active', 10)", [])
            .unwrap();
        let id = conn.last_insert_rowid();
        let c = CachedDigest { key: "10:123".into(), digest: [3; 32] };
        save_digests(&mut conn, &[(id, c.clone())]).unwrap();
        let (rows, _) = load_rows(&conn).unwrap();
        assert_eq!(rows[0].cached, Some(c));
    }
}
