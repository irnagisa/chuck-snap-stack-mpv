use std::path::Path;
use std::sync::Mutex;
use image::{imageops, DynamicImage, Rgba, RgbaImage};
use ndarray::{Array4, Ix2};
use ort::ep;
use ort::session::builder::GraphOptimizationLevel;
use ort::session::Session;
use ort::value::Tensor;

pub const IMG_SIZE: u32 = 448;
pub const SCORE_THRESHOLD: f32 = 0.35;

/// CLIP image normalization constants (RGB order).
const MEAN: [f32; 3] = [0.48145466, 0.4578275, 0.40821073];
const STD: [f32; 3] = [0.26862954, 0.26130258, 0.27577711];

pub struct JoyTagger {
    // session.run() は &mut self を要求するため Mutex で内部可変にする
    session: Mutex<Session>,
    pub tags: Vec<String>,
}

impl JoyTagger {
    pub fn load(model_path: &Path, tags_path: &Path) -> Result<Self, String> {
        eprintln!("[joytag] load() 開始: {model_path:?}");
        let mut builder = Session::builder()
            .map_err(|e| e.to_string())?
            // CPU EP を明示指定: CoreML EP は Intel Mac + macOS Tahoe でモデルコンパイルがハングするため除外
            .with_execution_providers([ep::CPU::default().build()])
            .map_err(|e| e.to_string())?
            // Level3 (既定) の積極的最適化が Intel Mac + macOS Tahoe でのストール要因になり
            // 得るため抑制する。あわせてスレッドプール自動検出・並列実行も無効化する。
            .with_optimization_level(GraphOptimizationLevel::Level1)
            .map_err(|e| e.to_string())?
            .with_intra_threads(4)
            .map_err(|e| e.to_string())?
            .with_parallel_execution(false)
            .map_err(|e| e.to_string())?;
        eprintln!("[joytag] commit_from_file() 呼び出し前");
        let session = builder.commit_from_file(model_path).map_err(|e| e.to_string())?;
        eprintln!("[joytag] commit_from_file() 完了");
        let tags = load_tags_txt(tags_path)?;
        Ok(Self { session: Mutex::new(session), tags })
    }

    /// Run inference on the given image path (thumbnail JPEG/WebP).
    /// Returns (tag_name, score, 0) for all tags above SCORE_THRESHOLD.
    /// Category is always 0 — JoyTag has no category concept.
    pub fn infer(&self, image_path: &Path) -> Result<Vec<(String, f32, i32)>, String> {
        let img = image::open(image_path).map_err(|e| e.to_string())?;
        let array = preprocess_image(img);

        let mut session = self.session.lock().map_err(|e| e.to_string())?;

        // 入力名をモデルメタデータから動的取得（ハードコードしない）
        let input_name = session.inputs()[0].name().to_string();

        let tensor = Tensor::<f32>::from_array(array)
            .map_err(|e| e.to_string())?;

        eprintln!("[joytag] session.run() 呼び出し前");
        let outputs = session
            .run(ort::inputs![input_name => tensor])
            .map_err(|e| e.to_string())?;
        eprintln!("[joytag] session.run() 完了");

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
                    Some((tag.clone(), score, 0))
                } else {
                    None
                }
            })
            .collect();

        Ok(results)
    }
}

/// Preprocess image to NCHW float32 Array4 [1, 3, 448, 448] in RGB order, CLIP normalized.
/// Values are normalised as: (pixel/255 - mean) / std per channel.
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

    // Resize to 448×448
    let resized = imageops::resize(&padded, IMG_SIZE, IMG_SIZE, imageops::FilterType::Lanczos3);

    // Build NCHW buffer [1, 3, 448, 448], RGB order, CLIP-normalized
    let n = 1usize;
    let c = 3usize;
    let h_sz = IMG_SIZE as usize;
    let w_sz = IMG_SIZE as usize;
    let mut data = vec![0f32; n * c * h_sz * w_sz];
    for (x, y, pixel) in resized.enumerate_pixels() {
        for ch in 0..3usize {
            let val = pixel[ch] as f32 / 255.0;
            let normalized = (val - MEAN[ch]) / STD[ch];
            // NCHW: channel-first index
            data[ch * h_sz * w_sz + y as usize * w_sz + x as usize] = normalized;
        }
    }

    Array4::from_shape_vec((n, c, h_sz, w_sz), data).expect("shape mismatch")
}

/// Load tags from top_tags.txt (one tag per line, empty lines ignored).
fn load_tags_txt(path: &Path) -> Result<Vec<String>, String> {
    let content = std::fs::read_to_string(path).map_err(|e| e.to_string())?;
    Ok(content
        .lines()
        .map(str::trim)
        .filter(|l| !l.is_empty())
        .map(str::to_string)
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn write_temp_txt(lines: &[&str]) -> (std::fs::File, std::path::PathBuf) {
        use std::sync::atomic::{AtomicU64, Ordering};
        static COUNTER: AtomicU64 = AtomicU64::new(0);
        let id = COUNTER.fetch_add(1, Ordering::Relaxed);
        let path = std::env::temp_dir().join(format!("joytag_test_{}.txt", id));
        let mut f = std::fs::File::create(&path).unwrap();
        for line in lines {
            writeln!(f, "{}", line).unwrap();
        }
        (f, path)
    }

    // ── load_tags_txt ───────────────────────────────────────────────────────

    #[test]
    fn load_tags_txt_basic() {
        let (_f, path) = write_temp_txt(&["cat", "dog", "bird"]);
        let tags = load_tags_txt(&path).unwrap();
        std::fs::remove_file(&path).ok();
        assert_eq!(tags, vec!["cat", "dog", "bird"]);
    }

    #[test]
    fn load_tags_txt_ignores_empty_lines() {
        let (_f, path) = write_temp_txt(&["cat", "", "dog"]);
        let tags = load_tags_txt(&path).unwrap();
        std::fs::remove_file(&path).ok();
        assert_eq!(tags, vec!["cat", "dog"]);
    }

    #[test]
    fn load_tags_txt_trims_whitespace() {
        let (_f, path) = write_temp_txt(&["  cat  ", "dog"]);
        let tags = load_tags_txt(&path).unwrap();
        std::fs::remove_file(&path).ok();
        assert_eq!(tags, vec!["cat", "dog"]);
    }

    // ── preprocess_image ────────────────────────────────────────────────────

    #[test]
    fn preprocess_image_output_shape() {
        let img = DynamicImage::ImageRgb8(image::RgbImage::from_pixel(
            100,
            200,
            image::Rgb([128u8, 64u8, 32u8]),
        ));
        let array = preprocess_image(img);
        // Must be NCHW [1, 3, 448, 448]
        assert_eq!(array.shape(), &[1, 3, 448, 448]);
    }

    #[test]
    fn preprocess_image_white_pixel_clip_normalized() {
        // Pure white image: (1.0 - mean[c]) / std[c] per channel
        let img = DynamicImage::ImageRgb8(image::RgbImage::from_pixel(
            10,
            10,
            image::Rgb([255u8, 255u8, 255u8]),
        ));
        let array = preprocess_image(img);
        for ch in 0..3usize {
            let expected = (1.0f32 - MEAN[ch]) / STD[ch];
            let actual = array[[0, ch, 0, 0]];
            assert!(
                (actual - expected).abs() < 1e-4,
                "ch={} expected={:.6} actual={:.6}",
                ch,
                expected,
                actual
            );
        }
    }

    #[test]
    fn preprocess_image_black_pixel_clip_normalized() {
        // Pure black image: (0.0 - mean[c]) / std[c] per channel
        let img = DynamicImage::ImageRgb8(image::RgbImage::from_pixel(
            10,
            10,
            image::Rgb([0u8, 0u8, 0u8]),
        ));
        let array = preprocess_image(img);
        for ch in 0..3usize {
            let expected = (0.0f32 - MEAN[ch]) / STD[ch];
            let actual = array[[0, ch, 0, 0]];
            assert!(
                (actual - expected).abs() < 1e-4,
                "ch={} expected={:.6} actual={:.6}",
                ch,
                expected,
                actual
            );
        }
    }

    #[test]
    fn preprocess_image_transparent_composited_on_white() {
        // Fully transparent pixel should become white after compositing
        let mut rgba_img = image::RgbaImage::new(10, 10);
        for pixel in rgba_img.pixels_mut() {
            *pixel = image::Rgba([0u8, 0u8, 0u8, 0u8]); // fully transparent black
        }
        let img = DynamicImage::ImageRgba8(rgba_img);
        let array = preprocess_image(img);
        // Should be treated as white
        for ch in 0..3usize {
            let expected = (1.0f32 - MEAN[ch]) / STD[ch];
            let actual = array[[0, ch, 0, 0]];
            assert!(
                (actual - expected).abs() < 1e-4,
                "ch={} expected={:.6} actual={:.6}",
                ch,
                expected,
                actual
            );
        }
    }
}
