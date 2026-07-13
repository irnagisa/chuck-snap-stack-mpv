export interface Video {
  id: number;
  path: string;
  title: string | null;
  duration: number | null;
  thumbnail: string | null;
  watched_at: string | null;
  progress: number;
  rating: number;
  category_id: number | null;
  has_audio: number | null;
  watch_count: number;
  created_at: string;
  media_type: 'video' | 'audio' | 'image' | 'link' | null;
  source_url: string | null;
  status: 'inbox' | null;
  source_type: 'import' | 'download' | 'dragdrop' | 'watcher' | 'link' | null;
}

export interface Chapter {
  title: string;
  startTime: number;
  endTime: number;
}

export interface SubtitleFile {
  path: string;
  name: string;
  ext: string;
}

export interface AiMatchedTag {
  tag_id: number;
  score: number;
}

export interface AiNewSuggestion {
  name: string;
  score: number;
}

export interface AiSuggestionResult {
  matched_tags: AiMatchedTag[];
  new_suggestions: AiNewSuggestion[];
}

export interface SmartPlaylist {
  id: number;
  name: string;
  filter_json: string;
  created_at: string;
}

export interface ScannedFile {
  path: string;
  title: string;
  parent_dir_name: string | null;
  media_type: string;
}

export interface ScanResult {
  files: ScannedFile[];
  errors: string[];
  truncated: boolean;
  skipped_count: number;
}

export interface Tag {
  id: number;
  name: string;
  color: string;
  icon: string | null;
  tag_category_id: number | null;
  created_at: string;
}

export interface TagCategory {
  id: number;
  name: string;
  created_at: string;
}

export interface Category {
  id: number;
  name: string;
  color: string;
  icon: string | null;
  parent_id: number | null;
  created_at: string;
}

export interface Playlist {
  id: number;
  name: string;
  created_at: string;
}
