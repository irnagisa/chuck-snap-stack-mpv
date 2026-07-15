use std::path::Path;
use image::{imageops, DynamicImage, Rgba, RgbaImage};
use tract_onnx::prelude::*;

pub const IMG_SIZE: u32 = 448;
pub const SCORE_THRESHOLD: f32 = 0.35;

/// CLIP image normalization constants (RGB order).
const MEAN: [f32; 3] = [0.48145466, 0.4578275, 0.40821073];
const STD: [f32; 3] = [0.26862954, 0.26130258, 0.27577711];

pub struct JoyTagger {
    model: SimplePlan<TypedFact, Box<dyn TypedOp>, Graph<TypedFact, Box<dyn TypedOp>>>,
    pub tags: Vec<String>,
}

impl JoyTagger {
    pub fn load(model_path: &Path, tags_path: &Path) -> Result<Self, String> {
        let model = tract_onnx::onnx()
            .model_for_path(model_path)
            .map_err(|e| e.to_string())?
            .into_optimized()
            .map_err(|e| e.to_string())?
            .into_runnable()
            .map_err(|e| e.to_string())?;

        let tags = load_tags_txt(tags_path)?;
        Ok(Self { model, tags })
    }

    /// Run inference on the given image path (thumbnail JPEG/WebP).
    /// Returns (tag_name, score, 0) for all tags above SCORE_THRESHOLD.
    /// Category is always 0 — JoyTag has no category concept.
    pub fn infer(&self, image_path: &Path) -> Result<Vec<(String, f32, i32)>, String> {
        let img = image::open(image_path).map_err(|e| e.to_string())?;
        let input = preprocess_image(img);

        let result = self
            .model
            .run(tvec!(input.into()))
            .map_err(|e| e.to_string())?;

        let view = result[0]
            .to_array_view::<f32>()
            .map_err(|e| e.to_string())?;

        // Output shape: [1, num_tags]
        let num_tags = view.len();
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

/// Preprocess image to NCHW float32 tensor [1, 3, 448, 448] in RGB order, CLIP normalized.
/// Values are normalised as: (pixel/255 - mean) / std per channel.
fn preprocess_image(img: DynamicImage) -> Tensor {
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

    tract_ndarray::Array4::from_shape_vec((n, c, h_sz, w_sz), data)
        .expect("shape mismatch")
        .into()
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
        let path = std::env::temp_dir().join(format!(
            "joytag_test_{}.txt",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .subsec_nanos()
        ));
        let mut f = std::fs::File::create(&path).unwrap();
        for line in lines {
            writeln!(f, "{}", line).unwrap();
        }
        (f, path)
    }

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

    #[test]
    fn preprocess_image_output_shape() {
        let img = DynamicImage::ImageRgb8(image::RgbImage::from_pixel(
            100,
            200,
            image::Rgb([128u8, 64u8, 32u8]),
        ));
        let tensor = preprocess_image(img);
        // Must be NCHW [1, 3, 448, 448]
        assert_eq!(tensor.shape(), &[1, 3, 448, 448]);
    }

    #[test]
    fn preprocess_image_white_pixel_clip_normalized() {
        // Pure white image: (1.0 - mean[c]) / std[c] per channel
        let img = DynamicImage::ImageRgb8(image::RgbImage::from_pixel(
            10,
            10,
            image::Rgb([255u8, 255u8, 255u8]),
        ));
        let tensor = preprocess_image(img);
        let view = tensor.to_array_view::<f32>().unwrap();
        for ch in 0..3usize {
            let expected = (1.0f32 - MEAN[ch]) / STD[ch];
            let actual = view[[0, ch, 0, 0]];
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
        let tensor = preprocess_image(img);
        let view = tensor.to_array_view::<f32>().unwrap();
        for ch in 0..3usize {
            let expected = (0.0f32 - MEAN[ch]) / STD[ch];
            let actual = view[[0, ch, 0, 0]];
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
        let tensor = preprocess_image(img);
        let view = tensor.to_array_view::<f32>().unwrap();
        // Should be treated as white
        for ch in 0..3usize {
            let expected = (1.0f32 - MEAN[ch]) / STD[ch];
            let actual = view[[0, ch, 0, 0]];
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
