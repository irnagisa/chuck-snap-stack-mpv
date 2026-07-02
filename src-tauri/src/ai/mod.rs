pub mod suggest;
pub mod wd_tagger;

use std::sync::{Arc, Mutex};
use crate::ai::wd_tagger::WdTagger;

pub struct AiTaggerState(pub Mutex<AiTaggerInner>);

pub struct AiTaggerInner {
    pub tagger: Option<Arc<WdTagger>>,
    pub downloading: bool,
    pub download_progress: f32,
}

impl AiTaggerState {
    pub fn new() -> Self {
        AiTaggerState(Mutex::new(AiTaggerInner {
            tagger: None,
            downloading: false,
            download_progress: 0.0,
        }))
    }
}
