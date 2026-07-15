pub mod suggest;
pub mod wd_tagger;
pub mod joytag;

use std::path::Path;
use std::sync::{Arc, Mutex};

/// Unified tagger interface for all AI image-tagging models.
pub trait Tagger: Send + Sync {
    /// Returns `(tag_name, score, category)` for every tag above the model's threshold.
    /// Models without a category concept (e.g. JoyTag) always return `category = 0`.
    fn run(&self, image_path: &Path) -> Result<Vec<(String, f32, i32)>, String>;
}

impl Tagger for wd_tagger::WdTagger {
    fn run(&self, image_path: &Path) -> Result<Vec<(String, f32, i32)>, String> {
        // Delegates to the WdTagger inherent method (same signature, no recursion).
        wd_tagger::WdTagger::run(self, image_path)
    }
}

impl Tagger for joytag::JoyTagger {
    fn run(&self, image_path: &Path) -> Result<Vec<(String, f32, i32)>, String> {
        self.infer(image_path)
    }
}

/// Which AI tagging model is currently loaded.
#[derive(Clone, PartialEq, Debug)]
pub enum ModelKind {
    WdTagger,
    JoyTag,
}

impl ModelKind {
    pub fn from_str(s: &str) -> Self {
        match s {
            "joytag" => ModelKind::JoyTag,
            _ => ModelKind::WdTagger,
        }
    }

    pub fn as_str(&self) -> &'static str {
        match self {
            ModelKind::WdTagger => "wd-tagger",
            ModelKind::JoyTag => "joytag",
        }
    }
}

pub struct AiTaggerState(pub Mutex<AiTaggerInner>);

pub struct AiTaggerInner {
    pub tagger: Option<Arc<dyn Tagger>>,
    /// Which model is currently loaded into `tagger`.
    pub loaded_kind: Option<ModelKind>,
    pub downloading: bool,
    pub download_progress: f32,
}

impl AiTaggerState {
    pub fn new() -> Self {
        AiTaggerState(Mutex::new(AiTaggerInner {
            tagger: None,
            loaded_kind: None,
            downloading: false,
            download_progress: 0.0,
        }))
    }
}
