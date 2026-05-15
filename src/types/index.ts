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
  created_at: string;
}

export interface ScannedFile {
  path: string;
  title: string;
}

export interface Tag {
  id: number;
  name: string;
  color: string;
  created_at: string;
}

export interface Category {
  id: number;
  name: string;
  color: string;
  created_at: string;
}
