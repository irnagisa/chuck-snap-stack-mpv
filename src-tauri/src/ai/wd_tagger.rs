use std::path::Path;
use std::sync::Mutex;
use image::{imageops, DynamicImage, Rgba, RgbaImage};
use ndarray::{Array4, Ix2};
use ort::ep;
use ort::session::Session;
use ort::value::Tensor;

pub const IMG_SIZE: u32 = 448;
pub const SCORE_THRESHOLD: f32 = 0.35;

pub struct TagEntry {
    pub name: String,
    pub category: i32,
}

pub struct WdTagger {
    // session.run() は &mut self を要求するため Mutex で内部可変にする
    // これにより Tagger trait の &self シグネチャを維持できる
    session: Mutex<Session>,
    pub tags: Vec<TagEntry>,
}

impl WdTagger {
    pub fn load(model_path: &Path, csv_path: &Path) -> Result<Self, String> {
        let session = Session::builder()
            .map_err(|e| e.to_string())?
            // CPU EP を明示指定: CoreML EP は Intel Mac + macOS Tahoe でモデルコンパイルがハングするため除外
            .with_execution_providers([ep::CPU::default().build()])
            .map_err(|e| e.to_string())?
            .commit_from_file(model_path)
            .map_err(|e| e.to_string())?;
        let tags = load_tags_csv(csv_path)?;
        Ok(Self { session: Mutex::new(session), tags })
    }

    /// Run inference on the given image path (thumbnail JPEG/WebP).
    /// Returns (tag_name, score, category) for all tags above SCORE_THRESHOLD.
    pub fn run(&self, image_path: &Path) -> Result<Vec<(String, f32, i32)>, String> {
        let img = image::open(image_path).map_err(|e| e.to_string())?;
        let array = preprocess_image(img);

        let mut session = self.session.lock().map_err(|e| e.to_string())?;

        // 入力名をモデルメタデータから動的取得（ハードコードしない）
        let input_name = session.inputs()[0].name().to_string();

        let tensor = Tensor::<f32>::from_array(array)
            .map_err(|e| e.to_string())?;

        let outputs = session
            .run(ort::inputs![input_name => tensor])
            .map_err(|e| e.to_string())?;

        // 出力 shape: [1, num_tags] → Ix2 に変換してインデックスアクセス
        let raw_view = outputs[0]
            .try_extract_array::<f32>()
            .map_err(|e| e.to_string())?;
        let view = raw_view
            .into_dimensionality::<Ix2>()
            .map_err(|e| e.to_string())?;

        let num_tags = view.shape()[1];
        let results: Vec<(String, f32, i32)> = self
            .tags
            .iter()
            .enumerate()
            .filter_map(|(i, tag)| {
                if i >= num_tags {
                    return None;
                }
                let score = view[[0, i]];
                if score >= SCORE_THRESHOLD {
                    Some((tag.name.clone(), score, tag.category))
                } else {
                    None
                }
            })
            .collect();

        Ok(results)
    }
}

/// Preprocess image to NHWC float32 Array4 [1, 448, 448, 3] in BGR order, values [0, 255].
/// This matches the WD-ViT-Tagger-v3 preprocessing.
fn preprocess_image(img: DynamicImage) -> Array4<f32> {
    // Composite onto white background (handle transparency)
    let rgba = img.to_rgba8();
    let (w, h) = rgba.dimensions();
    let mut bg = RgbaImage::from_pixel(w, h, Rgba([255, 255, 255, 255]));
    for (x, y, pixel) in rgba.enumerate_pixels() {
        let a = pixel[3] as f32 / 255.0;
        let r = (pixel[0] as f32 * a + 255.0 * (1.0 - a)) as u8;
        let g = (pixel[1] as f32 * a + 255.0 * (1.0 - a)) as u8;
        let b = (pixel[2] as f32 * a + 255.0 * (1.0 - a)) as u8;
        bg.put_pixel(x, y, Rgba([r, g, b, 255]));
    }
    let rgb = DynamicImage::ImageRgba8(bg).to_rgb8();

    // Pad to square with white
    let max_dim = w.max(h);
    let pad_left = (max_dim - w) / 2;
    let pad_top = (max_dim - h) / 2;
    let mut padded = image::RgbImage::from_pixel(max_dim, max_dim, image::Rgb([255, 255, 255]));
    for (x, y, pixel) in rgb.enumerate_pixels() {
        padded.put_pixel(x + pad_left, y + pad_top, *pixel);
    }

    // Resize to 448x448
    let resized = imageops::resize(&padded, IMG_SIZE, IMG_SIZE, imageops::FilterType::Lanczos3);

    // Build flat buffer in NHWC order, BGR channel, values [0, 255]
    let n = 1usize;
    let h = IMG_SIZE as usize;
    let w = IMG_SIZE as usize;
    let c = 3usize;
    let mut data = vec![0f32; n * h * w * c];
    for (x, y, pixel) in resized.enumerate_pixels() {
        let base = (y as usize * w + x as usize) * c;
        data[base]     = pixel[2] as f32; // B
        data[base + 1] = pixel[1] as f32; // G
        data[base + 2] = pixel[0] as f32; // R
    }

    Array4::from_shape_vec((n, h, w, c), data).expect("shape mismatch")
}

/// Load tags from selected_tags.csv (columns: tag_id, name, category, count).
fn load_tags_csv(csv_path: &Path) -> Result<Vec<TagEntry>, String> {
    let mut rdr = csv::Reader::from_path(csv_path).map_err(|e| e.to_string())?;
    let mut tags = Vec::new();
    for result in rdr.records() {
        let record = result.map_err(|e| e.to_string())?;
        let name = record.get(1).unwrap_or("").to_string();
        let category: i32 = record.get(2).and_then(|s| s.parse().ok()).unwrap_or(0);
        tags.push(TagEntry { name, category });
    }
    Ok(tags)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    // ── helper: write a temporary CSV file ──────────────────────────────────

    fn write_temp_csv(rows: &[&str]) -> (std::fs::File, std::path::PathBuf) {
        use std::sync::atomic::{AtomicU64, Ordering};
        static COUNTER: AtomicU64 = AtomicU64::new(0);
        let id = COUNTER.fetch_add(1, Ordering::Relaxed);
        let path = std::env::temp_dir().join(format!("wd_tagger_test_{}.csv", id));
        let mut f = std::fs::File::create(&path).unwrap();
        // CSV header expected by load_tags_csv
        writeln!(f, "tag_id,name,category,count").unwrap();
        for row in rows {
            writeln!(f, "{}", row).unwrap();
        }
        (f, path)
    }

    // ── load_tags_csv ───────────────────────────────────────────────────────

    #[test]
    fn load_tags_csv_basic() {
        let (_f, path) = write_temp_csv(&["1,cat,0,100", "2,dog,1,200"]);
        let tags = load_tags_csv(&path).unwrap();
        std::fs::remove_file(&path).ok();
        assert_eq!(tags.len(), 2);
        assert_eq!(tags[0].name, "cat");
        assert_eq!(tags[0].category, 0);
        assert_eq!(tags[1].name, "dog");
        assert_eq!(tags[1].category, 1);
    }

    #[test]
    fn load_tags_csv_missing_category_defaults_to_zero() {
        let (_f, path) = write_temp_csv(&["1,cat,,"]);
        let tags = load_tags_csv(&path).unwrap();
        std::fs::remove_file(&path).ok();
        assert_eq!(tags[0].category, 0);
    }

    #[test]
    fn load_tags_csv_empty_name_preserved() {
        let (_f, path) = write_temp_csv(&["1,,0,10"]);
        let tags = load_tags_csv(&path).unwrap();
        std::fs::remove_file(&path).ok();
        assert_eq!(tags[0].name, "");
    }

    // ── preprocess_image ────────────────────────────────────────────────────

    #[test]
    fn preprocess_image_output_shape_nhwc() {
        let img = DynamicImage::ImageRgb8(image::RgbImage::from_pixel(
            100, 200, image::Rgb([128u8, 64u8, 32u8]),
        ));
        let array = preprocess_image(img);
        // Must be NHWC [1, 448, 448, 3]
        assert_eq!(array.shape(), &[1, 448, 448, 3]);
    }

    #[test]
    fn preprocess_image_bgr_channel_order() {
        // Pure red image (RGB = 255, 0, 0) → BGR order in array = B=0, G=0, R=255
        let img = DynamicImage::ImageRgb8(image::RgbImage::from_pixel(
            10, 10, image::Rgb([255u8, 0u8, 0u8]),
        ));
        let array = preprocess_image(img);
        let b = array[[0, 0, 0, 0]];
        let g = array[[0, 0, 0, 1]];
        let r = array[[0, 0, 0, 2]];
        assert!((b - 0.0).abs() < 1.0,   "B channel should be ~0, got {b}");
        assert!((g - 0.0).abs() < 1.0,   "G channel should be ~0, got {g}");
        assert!((r - 255.0).abs() < 1.0, "R channel should be ~255, got {r}");
    }

    #[test]
    fn preprocess_image_white_pixel_value() {
        // White → BGR (255, 255, 255)
        let img = DynamicImage::ImageRgb8(image::RgbImage::from_pixel(
            10, 10, image::Rgb([255u8, 255u8, 255u8]),
        ));
        let array = preprocess_image(img);
        for ch in 0..3usize {
            let v = array[[0, 0, 0, ch]];
            assert!((v - 255.0).abs() < 1.0, "ch={ch} expected 255.0, got {v}");
        }
    }

    #[test]
    fn preprocess_image_black_pixel_value() {
        // Black → BGR (0, 0, 0)
        let img = DynamicImage::ImageRgb8(image::RgbImage::from_pixel(
            10, 10, image::Rgb([0u8, 0u8, 0u8]),
        ));
        let array = preprocess_image(img);
        for ch in 0..3usize {
            let v = array[[0, 0, 0, ch]];
            assert!((v - 0.0).abs() < 1.0, "ch={ch} expected 0.0, got {v}");
        }
    }

    #[test]
    fn preprocess_image_transparent_composited_on_white() {
        // Fully transparent black pixel → composited onto white → white (255, 255, 255)
        let mut rgba_img = image::RgbaImage::new(10, 10);
        for pixel in rgba_img.pixels_mut() {
            *pixel = image::Rgba([0u8, 0u8, 0u8, 0u8]);
        }
        let array = preprocess_image(DynamicImage::ImageRgba8(rgba_img));
        for ch in 0..3usize {
            let v = array[[0, 0, 0, ch]];
            assert!((v - 255.0).abs() < 1.0, "ch={ch} expected 255.0, got {v}");
        }
    }

    #[test]
    fn preprocess_image_non_square_padded_to_square() {
        // 100×200 image: after padding and resize the shape must be [1, 448, 448, 3]
        let img = DynamicImage::ImageRgb8(image::RgbImage::from_pixel(
            100, 200, image::Rgb([0u8, 0u8, 0u8]),
        ));
        let array = preprocess_image(img);
        assert_eq!(array.shape(), &[1, 448, 448, 3]);
        // All values must be in [0, 255]
        for &v in array.iter().take(50) {
            assert!(v >= 0.0 && v <= 255.0, "pixel value out of range: {v}");
        }
    }
}
