use serde::{Deserialize, Serialize};

/// A tag suggested by AI that matches an existing user tag.
#[derive(Serialize, Deserialize, Clone)]
pub struct MatchedTag {
    pub tag_id: i64,
    pub score: f32,
}

/// A new tag name suggested by AI (not in the user's tag list).
#[derive(Serialize, Deserialize, Clone)]
pub struct NewSuggestion {
    pub name: String,
    pub score: f32,
}

/// Full result from AI tag analysis.
#[derive(Serialize, Deserialize)]
pub struct AiSuggestionResult {
    pub matched_tags: Vec<MatchedTag>,
    pub new_suggestions: Vec<NewSuggestion>,
}

/// Match WD Tagger output against user-defined tag names.
///
/// `ai_tags` — (danbooru_tag_name, score, category) from WD Tagger above threshold.
/// `user_tags` — (tag_id, tag_name) from the DB.
///
/// Returns existing tag matches and novel tag name proposals.
pub fn build_suggestions(
    ai_tags: &[(String, f32, i32)],
    user_tags: &[(i64, String)],
    max_new: usize,
) -> AiSuggestionResult {
    let mut matched_tags: Vec<MatchedTag> = Vec::new();
    let mut new_suggestions: Vec<NewSuggestion> = Vec::new();
    let mut matched_ids: std::collections::HashSet<i64> = std::collections::HashSet::new();

    for (danbooru_name, score, _category) in ai_tags {
        // Normalise for comparison: lowercase, replace spaces/underscores
        let norm_ai = normalise(danbooru_name);

        // Try to match against existing user tags
        let mut found = false;
        for (tag_id, tag_name) in user_tags {
            if matched_ids.contains(tag_id) {
                continue;
            }
            if normalise(tag_name) == norm_ai {
                matched_tags.push(MatchedTag {
                    tag_id: *tag_id,
                    score: *score,
                });
                matched_ids.insert(*tag_id);
                found = true;
                break;
            }
        }

        if !found {
            new_suggestions.push(NewSuggestion {
                name: danbooru_name.clone(),
                score: *score,
            });
        }
    }

    // Sort matches by score descending
    matched_tags.sort_by(|a, b| b.score.partial_cmp(&a.score).unwrap_or(std::cmp::Ordering::Equal));
    new_suggestions.sort_by(|a, b| b.score.partial_cmp(&a.score).unwrap_or(std::cmp::Ordering::Equal));
    new_suggestions.truncate(max_new);

    AiSuggestionResult {
        matched_tags,
        new_suggestions,
    }
}

fn normalise(s: &str) -> String {
    s.to_lowercase().replace('_', " ").replace('-', " ")
}
