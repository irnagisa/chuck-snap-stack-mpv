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

#[cfg(test)]
mod tests {
    use super::*;

    fn ai(name: &str, score: f32) -> (String, f32, i32) {
        (name.to_string(), score, 0)
    }

    fn user(id: i64, name: &str) -> (i64, String) {
        (id, name.to_string())
    }

    #[test]
    fn matched_when_name_equal() {
        let result = build_suggestions(&[ai("cat", 0.9)], &[user(1, "cat")], 10);
        assert_eq!(result.matched_tags.len(), 1);
        assert_eq!(result.matched_tags[0].tag_id, 1);
        assert_eq!(result.new_suggestions.len(), 0);
    }

    #[test]
    fn new_suggestion_when_no_match() {
        let result = build_suggestions(&[ai("dragon", 0.8)], &[user(1, "cat")], 10);
        assert_eq!(result.new_suggestions.len(), 1);
        assert_eq!(result.new_suggestions[0].name, "dragon");
        assert_eq!(result.matched_tags.len(), 0);
    }

    #[test]
    fn no_duplicate_matched_tag_ids() {
        // Two AI tags with same normalised name → second becomes new suggestion
        let result = build_suggestions(
            &[ai("cat", 0.9), ai("cat", 0.8)],
            &[user(1, "cat")],
            10,
        );
        assert_eq!(result.matched_tags.len(), 1);
        assert_eq!(result.new_suggestions.len(), 1);
    }

    #[test]
    fn matched_tags_sorted_by_score_descending() {
        let result = build_suggestions(
            &[ai("cat", 0.5), ai("dog", 0.9), ai("bird", 0.7)],
            &[user(1, "cat"), user(2, "dog"), user(3, "bird")],
            10,
        );
        assert_eq!(result.matched_tags.len(), 3);
        assert!(result.matched_tags[0].score >= result.matched_tags[1].score);
        assert!(result.matched_tags[1].score >= result.matched_tags[2].score);
    }

    #[test]
    fn max_new_truncates_new_suggestions() {
        let result = build_suggestions(
            &[ai("alpha", 0.9), ai("beta", 0.8), ai("gamma", 0.7)],
            &[],
            2,
        );
        assert_eq!(result.new_suggestions.len(), 2);
    }

    #[test]
    fn normalise_underscore_matches_space() {
        let result = build_suggestions(&[ai("blue_sky", 0.9)], &[user(1, "blue sky")], 10);
        assert_eq!(result.matched_tags.len(), 1);
    }

    #[test]
    fn normalise_hyphen_matches_space() {
        let result = build_suggestions(&[ai("well-known", 0.9)], &[user(1, "well known")], 10);
        assert_eq!(result.matched_tags.len(), 1);
    }

    #[test]
    fn normalise_case_insensitive() {
        let result = build_suggestions(&[ai("Dragon", 0.9)], &[user(1, "DRAGON")], 10);
        assert_eq!(result.matched_tags.len(), 1);
    }
}
