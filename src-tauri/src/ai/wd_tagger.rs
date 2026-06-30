use std::path::Path;
use image::{imageops, DynamicImage, Rgba, RgbaImage};
use tract_onnx::prelude::*;

pub const IMG_SIZE: u32 = 448;
pub const SCORE_THRESHOLD: f32 = 0.35;

pub struct TagEntry {
    pub name: String,
    pub category: i32,
}

pub struct WdTagger {
    model: SimplePlan<TypedFact, Box<dyn TypedOp>, Graph<TypedFact, Box<dyn TypedOp>>>,
    pub tags: Vec<TagEntry>,
}

impl WdTagger {
    pub fn load(model_path: &Path, csv_path: &Path) -> Result<Self, String> {
        let model = tract_onnx::onnx()
            .model_for_path(model_path)
            .map_err(|e| e.to_string())?
            .into_optimized()
            .map_err(|e| e.to_string())?
            .into_runnable()
            .map_err(|e| e.to_string())?;

        let tags = load_tags_csv(csv_path)?;
        Ok(Self { model, tags })
    }

    /// Run inference on the given image path (thumbnail JPEG/WebP).
    /// Returns (tag_name, score, category) for all tags above SCORE_THRESHOLD.
    pub fn run(&self, image_path: &Path) -> Result<Vec<(String, f32, i32)>, String> {
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
                // Flatten: index 0 * num_tags + i
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

/// Preprocess image to NHWC float32 tensor [1, 448, 448, 3] in BGR order, values [0, 255].
/// This matches the WD-ViT-Tagger-v3 preprocessing.
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

    tract_ndarray::Array4::from_shape_vec((n, h, w, c), data)
        .expect("shape mismatch")
        .into()
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
