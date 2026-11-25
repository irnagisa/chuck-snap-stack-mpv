//! ストレージ整理の「重複」候補。
//!
//! 2 種類の重複をまとめて 1 つのグループにする。
//! - 中身が同じ: ファイルサイズが同じで、先頭・中央・末尾の抜き出しのハッシュも一致する
//! - 見た目が似ている: pHash のハミング距離が小さく、(動画なら) 長さもほぼ同じ
//!
//! 各グループで残すもの (`keep_id`) を 1 つ選び、残り全部を消したときに空く容量を返す。

use std::collections::HashMap;
use std::io::{Read, Seek, SeekFrom};
use std::path::Path;

use serde::Serialize;
use sha2::{Digest, Sha256};
use tauri::State;

use super::phash::hamming_distance;
use super::storage::{cleanup_item_columns, item_from_row, CleanupItem, ON_DISK_FILTER};
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
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct DuplicateGroup {
    /// すべてのファイルの中身が同じ
    pub exact: bool,
    pub keep_id: i64,
    /// 残すもの以外を消したときに空く容量
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

fn build_groups(rows: Vec<Row>, digest_of: impl Fn(&CleanupItem) -> Option<[u8; 32]>) -> Vec<DuplicateGroup> {
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
            let total: i64 = members.iter().map(|&i| rows[i].item.file_size).sum();
            let mut ordered: Vec<usize> = members.into_iter().filter(|&i| i != keep).collect();
            ordered.sort_by(|&a, &b| {
                rows[b].item.file_size.cmp(&rows[a].item.file_size).then(rows[a].item.id.cmp(&rows[b].item.id))
            });
            ordered.insert(0, keep);
            DuplicateGroup {
                exact,
                keep_id: rows[keep].item.id,
                reclaimable_bytes: total - rows[keep].item.file_size,
                items: ordered.into_iter().map(|i| rows[i].item.clone()).collect(),
            }
        })
        .collect();

    groups.sort_by(|a, b| b.reclaimable_bytes.cmp(&a.reclaimable_bytes).then(a.keep_id.cmp(&b.keep_id)));
    groups
}

fn load_rows(conn: &rusqlite::Connection) -> Result<(Vec<Row>, i64), String> {
    let mut stmt = conn
        .prepare(&format!("SELECT {}, phash FROM videos WHERE {ON_DISK_FILTER}", cleanup_item_columns()))
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |r| {
            let phash = r
                .get::<_, Option<String>>(12)?
                .and_then(|p| p.parse::<u64>().ok())
                // 単色のフレームなどは何でも一致してしまうので使わない
                .filter(|&h| h != 0 && h != u64::MAX);
            Ok(Row { item: item_from_row(r)?, phash })
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
pub async fn get_duplicate_groups(state: State<'_, DbState>) -> Result<DuplicateGroups, String> {
    if let Err(e) = super::db_videos::fill_missing_file_sizes(&state) {
        log::warn!("[storage] file_size の取得に失敗しました: {e}");
    }
    let (rows, phash_missing_count) = {
        let conn = state.conn_read()?;
        load_rows(&conn)?
    };
    tokio::task::spawn_blocking(move || {
        let mut groups = build_groups(rows, |it| {
            sample_digest(Path::new(&it.path), u64::try_from(it.file_size).ok()?)
        });
        let total_groups = groups.len();
        let total_reclaimable_bytes = groups.iter().map(|g| g.reclaimable_bytes).sum();
        groups.truncate(GROUP_LIMIT);
        DuplicateGroups { total_groups, total_reclaimable_bytes, phash_missing_count, groups }
    })
    .await
    .map_err(|e| e.to_string())
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
            },
            phash,
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
        let groups = build_groups(rows, digest_by(&[(1, 1), (2, 1), (3, 2), (4, 1)]));
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
        let groups = build_groups(rows, |_| None);
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
        let groups = build_groups(rows, |_| None);
        assert_eq!(groups[0].keep_id, 1);
        assert_eq!(groups[0].reclaimable_bytes, 900);
    }

    #[test]
    fn images_and_videos_are_never_grouped_together() {
        let rows = vec![row(1, 100, Some(42), None), row(2, 200, Some(42), Some(10.0))];
        assert!(build_groups(rows, |_| None).is_empty());
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
}
