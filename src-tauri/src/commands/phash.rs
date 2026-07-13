use std::collections::HashMap;
use std::process::Stdio;

use image::DynamicImage;
use serde::{Deserialize, Serialize};

use crate::commands::settings::SharedAppSettings;
use crate::db::DbState;

// ---------------------------------------------------------------------------
// pHash algorithm (DCT-based)
// ---------------------------------------------------------------------------

/// Resize `img` to 32×32 grayscale, apply 2D DCT, take the top-left 8×8
/// (64 lowest-frequency coefficients) and return a 64-bit hash where each
/// bit is 1 if the coefficient is above the mean, 0 otherwise.
fn phash_from_image(img: &DynamicImage) -> u64 {
    let small = img
        .resize_exact(32, 32, image::imageops::FilterType::Triangle)
        .to_luma8();

    let mut pixels = [[0f64; 32]; 32];
    for y in 0..32usize {
        for x in 0..32usize {
            pixels[y][x] = small.get_pixel(x as u32, y as u32).0[0] as f64;
        }
    }

    let dct = dct2d(&pixels);

    let mut values = [0f64; 64];
    for y in 0..8usize {
        for x in 0..8usize {
            values[y * 8 + x] = dct[y][x];
        }
    }

    // Exclude the DC component [0][0] (index 0) from the mean calculation.
    // DC dominates when included and collapses nearly all images to the same hash.
    // AC components (indices 1–63) carry the structural information.
    let mean = values[1..].iter().sum::<f64>() / 63.0;

    let mut hash = 0u64;
    for (i, &v) in values.iter().enumerate() {
        if v > mean {
            hash |= 1u64 << i;
        }
    }
    hash
}

fn dct1d(input: &[f64; 32]) -> [f64; 32] {
    let mut output = [0f64; 32];
    for k in 0..32usize {
        let mut sum = 0f64;
        for (n, &x) in input.iter().enumerate() {
            sum += x
                * (std::f64::consts::PI * k as f64 * (2 * n + 1) as f64 / 64.0).cos();
        }
        output[k] = sum;
    }
    output
}

fn dct2d(pixels: &[[f64; 32]; 32]) -> [[f64; 32]; 32] {
    // DCT along rows
    let mut row_dct = [[0f64; 32]; 32];
    for y in 0..32 {
        row_dct[y] = dct1d(&pixels[y]);
    }
    // DCT along columns
    let mut result = [[0f64; 32]; 32];
    for x in 0..32 {
        let col: [f64; 32] = std::array::from_fn(|y| row_dct[y][x]);
        let col_dct = dct1d(&col);
        for y in 0..32 {
            result[y][x] = col_dct[y];
        }
    }
    result
}

pub fn hamming_distance(a: u64, b: u64) -> u32 {
    (a ^ b).count_ones()
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::{DynamicImage, GrayImage, Luma};
    use rusqlite::Connection;
    use crate::db::schema::init_db;

    // ── Test image helpers ────────────────────────────────────────────────────

    /// Solid single-color image (32×32).
    fn solid_image(value: u8) -> DynamicImage {
        DynamicImage::ImageLuma8(GrayImage::from_fn(32, 32, |_, _| Luma([value])))
    }

    /// Horizontal gradient: pixel at column x = x * 8 (0..=248).
    fn gradient_h() -> DynamicImage {
        DynamicImage::ImageLuma8(GrayImage::from_fn(32, 32, |x, _| Luma([(x * 8) as u8])))
    }

    /// Inverse of gradient_h.
    fn gradient_h_inv() -> DynamicImage {
        DynamicImage::ImageLuma8(GrayImage::from_fn(32, 32, |x, _| {
            Luma([255 - (x * 8) as u8])
        }))
    }

    /// Vertical gradient.
    fn gradient_v() -> DynamicImage {
        DynamicImage::ImageLuma8(GrayImage::from_fn(32, 32, |_, y| Luma([(y * 8) as u8])))
    }

    /// Pseudo-random noise image (deterministic).
    /// Has high-frequency DCT content spread across many coefficients.
    fn noise_image() -> DynamicImage {
        DynamicImage::ImageLuma8(GrayImage::from_fn(32, 32, |x, y| {
            Luma([((x.wrapping_mul(37).wrapping_add(y.wrapping_mul(53)).wrapping_add(x.wrapping_mul(y))) % 256) as u8])
        }))
    }

    fn setup_db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        init_db(&conn).unwrap();
        conn
    }

    // ── hamming_distance ─────────────────────────────────────────────────────

    #[test]
    fn hamming_identical_is_zero() {
        assert_eq!(hamming_distance(0, 0), 0);
        assert_eq!(hamming_distance(u64::MAX, u64::MAX), 0);
        assert_eq!(hamming_distance(0xDEAD_BEEF_CAFE_F00D, 0xDEAD_BEEF_CAFE_F00D), 0);
    }

    #[test]
    fn hamming_single_bit_is_one() {
        assert_eq!(hamming_distance(0, 1), 1);
        assert_eq!(hamming_distance(0, 1 << 63), 1);
    }

    #[test]
    fn hamming_all_bits_differ_is_64() {
        assert_eq!(hamming_distance(0, u64::MAX), 64);
    }

    #[test]
    fn hamming_is_symmetric() {
        let a = 0x1234_5678_9ABC_DEF0_u64;
        let b = 0xFEDC_BA98_7654_3210_u64;
        assert_eq!(hamming_distance(a, b), hamming_distance(b, a));
    }

    #[test]
    fn hamming_known_values() {
        // 0b0000_0000 vs 0b0000_1111 = 4 bits
        assert_eq!(hamming_distance(0, 0xF), 4);
        // 0b1010 vs 0b0101 = 4 bits
        assert_eq!(hamming_distance(0b1010, 0b0101), 4);
    }

    // ── dct1d ────────────────────────────────────────────────────────────────

    #[test]
    fn dct1d_zero_input_gives_zero_output() {
        let output = dct1d(&[0f64; 32]);
        for &v in &output {
            assert!(v.abs() < 1e-10, "expected 0, got {v}");
        }
    }

    #[test]
    fn dct1d_dc_component_equals_sum() {
        // For k=0: X[0] = Σ x[n] · cos(0) = Σ x[n]
        let input = [2f64; 32];
        let output = dct1d(&input);
        assert!(
            (output[0] - 64.0).abs() < 1e-9,
            "DC should be sum of inputs (32 × 2 = 64), got {}",
            output[0]
        );
    }

    #[test]
    fn dct1d_constant_signal_has_zero_ac() {
        // Constant signal → all AC components should be 0
        let input = [5f64; 32];
        let output = dct1d(&input);
        for k in 1..32 {
            assert!(
                output[k].abs() < 1e-9,
                "AC component k={k} should be ~0 for constant signal, got {}",
                output[k]
            );
        }
    }

    // ── phash_from_image ────────────────────────────────────────────────────

    #[test]
    fn phash_is_deterministic() {
        let img = gradient_h();
        assert_eq!(phash_from_image(&img), phash_from_image(&img));
    }

    #[test]
    fn phash_same_image_distance_zero() {
        let img = gradient_h();
        let h = phash_from_image(&img);
        assert_eq!(hamming_distance(h, h), 0);
    }

    #[test]
    fn phash_different_orientations_differ() {
        // Horizontal gradient vs vertical gradient: both are linear ramps, just transposed.
        // DCT theory predicts exactly 8 bits differ (AC energy in row-0 vs col-0).
        let h_horiz = phash_from_image(&gradient_h());
        let h_vert = phash_from_image(&gradient_v());
        let d = hamming_distance(h_horiz, h_vert);
        // They must be distinguishable — distance should be within [1, 32].
        assert!(d > 0, "transposed gradients must produce different hashes");
        assert!(d <= 32, "transposed gradients should not be completely unrelated");
    }

    #[test]
    fn phash_smooth_vs_noise_differ_significantly() {
        // A smooth gradient and pseudo-random noise have very different DCT energy
        // distributions and should have a large Hamming distance.
        let h_smooth = phash_from_image(&gradient_h());
        let h_noise = phash_from_image(&noise_image());
        assert!(
            hamming_distance(h_smooth, h_noise) > 16,
            "smooth gradient and noise image should differ significantly, distance = {}",
            hamming_distance(h_smooth, h_noise)
        );
    }

    #[test]
    fn phash_inverse_image_differs_significantly() {
        let h_normal = phash_from_image(&gradient_h());
        let h_inv = phash_from_image(&gradient_h_inv());
        // Inverted image should have large Hamming distance (many bits flipped)
        assert!(
            hamming_distance(h_normal, h_inv) > 16,
            "gradient and its inverse should differ significantly, distance = {}",
            hamming_distance(h_normal, h_inv)
        );
    }

    #[test]
    fn phash_returns_u64() {
        // Smoke test — just verify the function runs without panic
        let _ = phash_from_image(&solid_image(128));
        let _ = phash_from_image(&solid_image(0));
        let _ = phash_from_image(&solid_image(255));
        let _ = phash_from_image(&gradient_h());
    }

    // ── union-find ───────────────────────────────────────────────────────────

    #[test]
    fn union_find_singleton_roots_to_self() {
        let mut parent: Vec<usize> = (0..5).collect();
        for i in 0..5 {
            assert_eq!(find(&mut parent, i), i);
        }
    }

    #[test]
    fn union_find_joins_two_elements() {
        let mut parent = vec![0, 1, 2];
        union(&mut parent, 0, 1);
        assert_eq!(find(&mut parent, 0), find(&mut parent, 1));
    }

    #[test]
    fn union_find_is_transitive() {
        let mut parent: Vec<usize> = (0..5).collect();
        union(&mut parent, 0, 1);
        union(&mut parent, 1, 2);
        // 0 and 2 are in the same set transitively
        assert_eq!(find(&mut parent, 0), find(&mut parent, 2));
    }

    #[test]
    fn union_find_does_not_merge_disjoint_sets() {
        let mut parent: Vec<usize> = (0..4).collect();
        union(&mut parent, 0, 1);
        union(&mut parent, 2, 3);
        assert_eq!(find(&mut parent, 0), find(&mut parent, 1));
        assert_eq!(find(&mut parent, 2), find(&mut parent, 3));
        assert_ne!(find(&mut parent, 0), find(&mut parent, 2));
    }

    #[test]
    fn union_find_path_compression_is_idempotent() {
        let mut parent: Vec<usize> = (0..5).collect();
        union(&mut parent, 0, 1);
        union(&mut parent, 1, 2);
        union(&mut parent, 2, 3);
        let root_first = find(&mut parent, 0);
        let root_second = find(&mut parent, 0);
        assert_eq!(root_first, root_second);
        assert_eq!(root_first, find(&mut parent, 3));
    }

    // ── DB schema ────────────────────────────────────────────────────────────

    #[test]
    fn phash_column_exists_and_defaults_to_null() {
        let conn = setup_db();
        conn.execute(
            "INSERT INTO videos (path, media_type, status) VALUES ('/tmp/test.mp4', 'video', 'inbox')",
            [],
        )
        .unwrap();
        let phash: Option<String> = conn
            .query_row(
                "SELECT phash FROM videos WHERE path = '/tmp/test.mp4'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert!(phash.is_none(), "phash should default to NULL");
    }

    #[test]
    fn phash_can_be_set_and_retrieved() {
        let conn = setup_db();
        conn.execute(
            "INSERT INTO videos (path, media_type, status) VALUES ('/tmp/test.mp4', 'video', 'inbox')",
            [],
        )
        .unwrap();
        conn.execute(
            "UPDATE videos SET phash = '12345678901234567890' WHERE path = '/tmp/test.mp4'",
            [],
        )
        .unwrap();
        let phash: String = conn
            .query_row(
                "SELECT phash FROM videos WHERE path = '/tmp/test.mp4'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(phash, "12345678901234567890");
    }

    #[test]
    fn videos_without_phash_query_filters_correctly() {
        let conn = setup_db();
        conn.execute_batch(
            "INSERT INTO videos (path, media_type, status, phash)
               VALUES ('/tmp/a.mp4', 'video', 'inbox', NULL);
             INSERT INTO videos (path, media_type, status, phash)
               VALUES ('/tmp/b.mp4', 'video', 'inbox', '999');
             INSERT INTO videos (path, media_type, status, phash)
               VALUES ('/tmp/c.jpg', 'image', 'inbox', NULL);",
        )
        .unwrap();

        let mut stmt = conn
            .prepare(
                "SELECT path FROM videos WHERE phash IS NULL AND media_type = 'video'",
            )
            .unwrap();
        let paths: Vec<String> = stmt
            .query_map([], |r| r.get(0))
            .unwrap()
            .filter_map(|r| r.ok())
            .collect();

        // Only /tmp/a.mp4 is a video with NULL phash
        assert_eq!(paths, vec!["/tmp/a.mp4"]);
    }

    #[test]
    fn find_similar_videos_groups_identical_hashes() {
        // Simulate the N² grouping logic used in db_find_similar_videos.
        // 42 vs 65535: distance = popcount(42 ^ 65535) = 14 bits → well above threshold 8
        let hashes: Vec<u64> = vec![42, 42, 65535, 42];
        let n = hashes.len();
        let mut parent: Vec<usize> = (0..n).collect();

        for i in 0..n {
            for j in (i + 1)..n {
                if hamming_distance(hashes[i], hashes[j]) <= 8 {
                    union(&mut parent, i, j);
                }
            }
        }

        // Indices 0, 1, 3 share hash 42 → same root
        assert_eq!(find(&mut parent, 0), find(&mut parent, 1));
        assert_eq!(find(&mut parent, 0), find(&mut parent, 3));
        // Index 2 (hash 65535) is isolated (distance to 42 = 14 > 8)
        assert_ne!(find(&mut parent, 0), find(&mut parent, 2));
    }

    #[test]
    fn find_similar_videos_respects_threshold() {
        // Distance between 0 and 7 (0b111) = 3 bits
        let hashes: Vec<u64> = vec![0, 7];
        let n = hashes.len();

        // Threshold 2: too strict, should NOT group
        let mut parent_strict: Vec<usize> = (0..n).collect();
        for i in 0..n {
            for j in (i + 1)..n {
                if hamming_distance(hashes[i], hashes[j]) <= 2 {
                    union(&mut parent_strict, i, j);
                }
            }
        }
        assert_ne!(find(&mut parent_strict, 0), find(&mut parent_strict, 1));

        // Threshold 4: loose enough, should group
        let mut parent_loose: Vec<usize> = (0..n).collect();
        for i in 0..n {
            for j in (i + 1)..n {
                if hamming_distance(hashes[i], hashes[j]) <= 4 {
                    union(&mut parent_loose, i, j);
                }
            }
        }
        assert_eq!(find(&mut parent_loose, 0), find(&mut parent_loose, 1));
    }
}

// ---------------------------------------------------------------------------
// Union-Find (for grouping similar videos)
// ---------------------------------------------------------------------------

fn find(parent: &mut Vec<usize>, mut x: usize) -> usize {
    while parent[x] != x {
        parent[x] = parent[parent[x]]; // path compression (halving)
        x = parent[x];
    }
    x
}

fn union(parent: &mut Vec<usize>, x: usize, y: usize) {
    let px = find(parent, x);
    let py = find(parent, y);
    if px != py {
        parent[px] = py;
    }
}

// ---------------------------------------------------------------------------
// Frame extraction via ffmpeg
// ---------------------------------------------------------------------------

async fn extract_frame_with_ffmpeg(
    video_path: &str,
    ffmpeg_path: &str,
) -> Result<DynamicImage, String> {
    // Deterministic temp filename based on path
    let name_hash = video_path
        .as_bytes()
        .iter()
        .fold(0u64, |h, &b| h.wrapping_mul(31).wrapping_add(b as u64));
    let tmp = std::env::temp_dir().join(format!("phash_{:016x}.jpg", name_hash));

    // Try seeking to 10 s first; some short videos may fail here
    let status = tokio::process::Command::new(ffmpeg_path)
        .args([
            "-y",
            "-ss", "00:00:10",
            "-i", video_path,
            "-frames:v", "1",
            "-vf", "scale=64:64:force_original_aspect_ratio=disable",
            "-q:v", "5",
            tmp.to_str().ok_or("invalid tmp path")?,
        ])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .await
        .map_err(|e| e.to_string())?;

    if !status.success()
        || !tmp.exists()
        || tmp.metadata().map(|m| m.len() == 0).unwrap_or(true)
    {
        // Fallback: extract from beginning
        let status2 = tokio::process::Command::new(ffmpeg_path)
            .args([
                "-y",
                "-i", video_path,
                "-frames:v", "1",
                "-vf", "scale=64:64:force_original_aspect_ratio=disable",
                "-q:v", "5",
                tmp.to_str().ok_or("invalid tmp path")?,
            ])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .await
            .map_err(|e| e.to_string())?;

        if !status2.success() {
            return Err("ffmpeg frame extraction failed".to_string());
        }
    }

    let result = tokio::task::spawn_blocking({
        let path = tmp.clone();
        move || image::open(&path).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string());

    // Always clean up the temp file, regardless of success or failure
    let _ = tokio::fs::remove_file(&tmp).await;

    Ok(result??)
}

// ---------------------------------------------------------------------------
// Tauri Commands
// ---------------------------------------------------------------------------

#[derive(Debug, Serialize, Deserialize)]
pub struct VideoForPhash {
    pub id: i64,
    pub path: String,
    pub thumbnail: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SimilarVideo {
    pub id: i64,
    pub path: String,
    pub title: Option<String>,
    pub thumbnail: Option<String>,
    pub duration: Option<f64>,
    pub phash: String,
}

/// Returns files (video or image) that have no pHash stored yet.
#[tauri::command]
pub async fn db_get_videos_without_phash(
    db_state: tauri::State<'_, DbState>,
) -> Result<Vec<VideoForPhash>, String> {
    let conn = db_state.conn_read()?;
    let mut stmt = conn
        .prepare(
            "SELECT id, path, thumbnail FROM videos \
             WHERE phash IS NULL AND media_type IN ('video', 'image')",
        )
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map([], |row| {
            Ok(VideoForPhash {
                id: row.get(0)?,
                path: row.get(1)?,
                thumbnail: row.get(2)?,
            })
        })
        .map_err(|e| e.to_string())?;

    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())
}

/// Compute the pHash for a single video and persist it to the DB.
/// Uses an existing thumbnail image when available to avoid spawning ffmpeg.
#[tauri::command]
pub async fn db_compute_video_phash(
    db_state: tauri::State<'_, DbState>,
    app_settings: tauri::State<'_, SharedAppSettings>,
    video_id: i64,
    video_path: String,
    thumbnail_path: Option<String>,
) -> Result<String, String> {
    if !std::path::Path::new(&video_path).exists() {
        return Err("File not found".to_string());
    }

    // Prefer existing thumbnail — no ffmpeg needed
    let img_from_thumb: Option<DynamicImage> = if let Some(ref thumb) = thumbnail_path {
        if !thumb.is_empty() {
            let tp = std::path::Path::new(thumb).to_path_buf();
            if tp.exists() {
                tokio::task::spawn_blocking(move || image::open(&tp).ok())
                    .await
                    .unwrap_or(None)
            } else {
                None
            }
        } else {
            None
        }
    } else {
        None
    };

    let img = if let Some(img) = img_from_thumb {
        img
    } else {
        // For image files, open directly without ffmpeg.
        let path_clone = video_path.clone();
        let img_direct = tokio::task::spawn_blocking(move || {
            image::open(&path_clone).ok()
        })
        .await
        .unwrap_or(None);

        if let Some(img) = img_direct {
            img
        } else {
            let ffmpeg_path = {
                let s = app_settings.lock().map_err(|e| e.to_string())?;
                s.ffmpeg_path.clone()
            };
            extract_frame_with_ffmpeg(&video_path, &ffmpeg_path).await?
        }
    };

    let hash = tokio::task::spawn_blocking(move || phash_from_image(&img))
        .await
        .map_err(|e| e.to_string())?;

    let hash_str = hash.to_string();

    {
        let conn = db_state.conn()?;
        conn.execute(
            "UPDATE videos SET phash = ?1 WHERE id = ?2",
            rusqlite::params![&hash_str, video_id],
        )
        .map_err(|e| e.to_string())?;
    }

    Ok(hash_str)
}

/// Find groups of visually similar videos using pHash Hamming distance.
/// `threshold` is the maximum Hamming distance (0–64) to consider two videos
/// similar; a value of 8 works well in practice.
#[tauri::command]
pub async fn db_find_similar_videos(
    db_state: tauri::State<'_, DbState>,
    threshold: u32,
) -> Result<Vec<Vec<SimilarVideo>>, String> {
    let videos: Vec<SimilarVideo> = {
        let conn = db_state.conn_read()?;
        let mut stmt = conn
            .prepare(
                "SELECT id, path, title, thumbnail, duration, phash \
                 FROM videos WHERE phash IS NOT NULL AND media_type = 'video'",
            )
            .map_err(|e| e.to_string())?;

        let rows: Vec<SimilarVideo> = stmt
            .query_map([], |row| {
                Ok(SimilarVideo {
                    id: row.get(0)?,
                    path: row.get(1)?,
                    title: row.get(2)?,
                    thumbnail: row.get(3)?,
                    duration: row.get(4)?,
                    phash: row.get(5)?,
                })
            })
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;
        rows
    };

    let hashes: Vec<u64> = videos
        .iter()
        .map(|v| v.phash.parse().unwrap_or(0))
        .collect();

    let n = videos.len();
    let mut parent: Vec<usize> = (0..n).collect();

    for i in 0..n {
        for j in (i + 1)..n {
            if hamming_distance(hashes[i], hashes[j]) <= threshold {
                union(&mut parent, i, j);
            }
        }
    }

    let mut group_map: HashMap<usize, Vec<usize>> = HashMap::new();
    for i in 0..n {
        let root = find(&mut parent, i);
        group_map.entry(root).or_default().push(i);
    }

    let mut result: Vec<Vec<SimilarVideo>> = group_map
        .into_values()
        .filter(|g| g.len() > 1)
        .map(|group| group.iter().map(|&i| videos[i].clone()).collect())
        .collect();

    // Largest groups first
    result.sort_by(|a, b| b.len().cmp(&a.len()));

    Ok(result)
}

/// Returns the stored pHash string for a video, or null if not yet computed.
#[tauri::command]
pub async fn db_get_video_stored_phash(
    db_state: tauri::State<'_, DbState>,
    video_id: i64,
) -> Result<Option<String>, String> {
    let conn = db_state.conn_read()?;
    let phash: Option<String> = conn
        .query_row(
            "SELECT phash FROM videos WHERE id = ?1",
            rusqlite::params![video_id],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;
    Ok(phash.filter(|p| !p.is_empty()))
}

/// Find videos visually similar to a specific video (by its id).
/// Returns other videos whose pHash is within `threshold` Hamming distance,
/// sorted by ascending distance (most similar first).
#[tauri::command]
pub async fn db_find_similar_to_video(
    db_state: tauri::State<'_, DbState>,
    video_id: i64,
    threshold: u32,
) -> Result<Vec<SimilarVideo>, String> {
    let conn = db_state.conn_read()?;

    // Fetch the pHash of the target video.
    let target_phash: Option<String> = conn
        .query_row(
            "SELECT phash FROM videos WHERE id = ?1",
            rusqlite::params![video_id],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;

    let target_phash = match target_phash {
        Some(p) if !p.is_empty() => p,
        _ => return Ok(vec![]),
    };
    let target_hash: u64 = target_phash.parse().unwrap_or(0);

    // Fetch all other videos that have a pHash.
    let mut stmt = conn
        .prepare(
            "SELECT id, path, title, thumbnail, duration, phash \
             FROM videos WHERE phash IS NOT NULL AND id != ?1",
        )
        .map_err(|e| e.to_string())?;

    let mut rows: Vec<(SimilarVideo, u32)> = stmt
        .query_map(rusqlite::params![video_id], |row| {
            Ok(SimilarVideo {
                id: row.get(0)?,
                path: row.get(1)?,
                title: row.get(2)?,
                thumbnail: row.get(3)?,
                duration: row.get(4)?,
                phash: row.get(5)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?
        .into_iter()
        .filter_map(|v| {
            let h: u64 = v.phash.parse().unwrap_or(u64::MAX);
            let dist = hamming_distance(target_hash, h);
            if dist <= threshold { Some((v, dist)) } else { None }
        })
        .collect();

    // Sort most-similar first.
    rows.sort_by_key(|(_, d)| *d);

    Ok(rows.into_iter().map(|(v, _)| v).collect())
}
