export interface Video {
  id: number;
  path: string;
  title: string | null;
  duration: number | null;
  thumbnail: string | null;
  watched_at: string | null;
  progress: number;
  rating: number;
  created_at: string;
}

export interface ScannedFile {
  path: string;
  title: string;
}
