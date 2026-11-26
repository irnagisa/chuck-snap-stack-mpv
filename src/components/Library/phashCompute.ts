import { invoke } from "@tauri-apps/api/core";

/** db_get_videos_without_phash の戻り値 */
export interface VideoForPhash {
  id: number;
  path: string;
  thumbnail: string | null;
}

/** 同時に計算する本数。たいていはサムネイルから計算するので軽く、サムネイルがないものだけ ffmpeg を使う */
export const PHASH_CONCURRENCY = 4;

/** 1 本の pHash を計算して保存する。読めなければ false (次回また試す) */
export async function computePhash(v: VideoForPhash): Promise<boolean> {
  try {
    await invoke<string>("db_compute_video_phash", {
      videoId: v.id,
      videoPath: v.path,
      thumbnailPath: v.thumbnail ?? null,
    });
    return true;
  } catch {
    return false;
  }
}
