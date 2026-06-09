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
  media_type: 'video' | 'audio' | 'image' | null;
  source_url: string | null;
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
