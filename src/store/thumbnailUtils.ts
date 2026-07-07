/**
 * サムネイル生成・リスキャン処理のヘルパー。
 * useLibraryStore から呼び出されるが、ストア本体とは独立して実装されている。
 */
import { invoke } from '@tauri-apps/api/core';
import { appCacheDir, join } from '@tauri-apps/api/path';
import type { Video } from '../types';

export const THUMBNAIL_CONCURRENCY = 3;

const AUDIO_EXTS = new Set(['mp3', 'flac', 'aac', 'wav', 'ogg', 'opus', 'm4a', 'wma']);
const IMAGE_EXTS = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'tiff', 'heic', 'avif']);

function ext(path: string): string {
  return path.split('.').pop()?.toLowerCase() ?? '';
}

async function thumbOutputPath(videoPath: string): Promise<string> {
  const cacheDir = await appCacheDir();
  const thumbDir = await join(cacheDir, 'thumbnails');
  const hashBuffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(videoPath));
  const hash = Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return join(thumbDir, hash.slice(0, 2), `${hash}.webp`);
}

type ThumbResult = {
  id: number;
  thumbnail?: string | null;
  duration?: number | null;
  hasAudio: number;
};

type TauriThumbResult = { thumbnail_path: string; duration: number | null; has_audio: boolean };

async function processOne(
  video: { id: number; path: string; thumbnail: string | null }
): Promise<ThumbResult | null> {
  try {
    const e = ext(video.path);
    const isImage = IMAGE_EXTS.has(e);
    const isAudio = AUDIO_EXTS.has(e);

    if (isImage) {
      if (video.thumbnail) return { id: video.id, hasAudio: 0 };
      const outputPath = await thumbOutputPath(video.path);
      try {
        const r = await invoke<TauriThumbResult>('generate_thumbnail', {
          videoPath: video.path,
          outputPath,
        });
        return { id: video.id, thumbnail: r.thumbnail_path, duration: null, hasAudio: 0 };
      } catch {
        return { id: video.id, thumbnail: '', duration: null, hasAudio: 0 };
      }
    }

    if (!video.thumbnail) {
      const outputPath = await thumbOutputPath(video.path);
      if (isAudio) {
        try {
          const r = await invoke<TauriThumbResult>('generate_thumbnail', {
            videoPath: video.path,
            outputPath,
          });
          return { id: video.id, thumbnail: r.thumbnail_path, duration: r.duration, hasAudio: 1 };
        } catch {
          return { id: video.id, thumbnail: '', duration: null, hasAudio: 1 };
        }
      }
      const r = await invoke<TauriThumbResult>('generate_thumbnail', {
        videoPath: video.path,
        outputPath,
      });
      return {
        id: video.id,
        thumbnail: r.thumbnail_path,
        duration: r.duration,
        hasAudio: r.has_audio ? 1 : 0,
      };
    } else {
      if (isAudio) return { id: video.id, hasAudio: 1 };
      const hasAudioRaw = await invoke<boolean>('check_has_audio', { videoPath: video.path });
      return { id: video.id, hasAudio: hasAudioRaw ? 1 : 0 };
    }
  } catch (e) {
    console.warn(`[thumbnailUtils] processing failed: ${video.path}`, e);
    return null;
  }
}

async function flushBatchToDb(
  withThumb: ThumbResult[],
  withoutThumb: ThumbResult[]
): Promise<void> {
  if (withThumb.length > 0) {
    await invoke('db_update_thumbnails_batch', {
      updates: withThumb.map((r) => ({
        id: r.id,
        thumbnail: r.thumbnail ?? null,
        duration: r.duration ?? null,
        hasAudio: r.hasAudio,
      })),
    }).catch((e) => console.error('[thumbnailUtils] batch DB update failed:', e));
  }
  if (withoutThumb.length > 0) {
    await invoke('db_update_audio_only_batch', {
      updates: withoutThumb.map((r) => ({ id: r.id, hasAudio: r.hasAudio })),
    }).catch((e) => console.error('[thumbnailUtils] audio batch DB update failed:', e));
  }
}

// ── generateThumbnails ─────────────────────────────────────────────────────

export type ThumbnailStoreSlice = {
  isThumbnailGenerating: boolean;
  isThumbnailPaused: boolean;
  isScanning: boolean;
  thumbnailProgress: { done: number; total: number } | null;
  videos: Video[];
};

type SetThumbnailState = (
  updater: Partial<ThumbnailStoreSlice> | ((s: ThumbnailStoreSlice) => Partial<ThumbnailStoreSlice>)
) => void;

type GetThumbnailState = () => ThumbnailStoreSlice;

export async function generateThumbnailsWorker(
  get: GetThumbnailState,
  set: SetThumbnailState,
  onDone: () => Promise<void>
): Promise<void> {
  if (get().isThumbnailGenerating) return;

  set({ isThumbnailGenerating: true, isThumbnailPaused: false, thumbnailProgress: null });

  const processedIds = new Set<number>();
  const PENDING_BATCH_SIZE = 500;
  let cumulativeDone = 0;
  let cumulativeTotal = 0;

  try {
    while (true) {
      const pending = await invoke<{ id: number; path: string; thumbnail: string | null }[]>(
        'db_get_pending_thumbnails',
        { limit: PENDING_BATCH_SIZE }
      );
      const toProcess = pending.filter((v) => !processedIds.has(v.id));
      if (toProcess.length === 0) break;

      cumulativeTotal += toProcess.length;
      set({ thumbnailProgress: { done: cumulativeDone, total: cumulativeTotal } });

      for (let i = 0; i < toProcess.length; i += THUMBNAIL_CONCURRENCY) {
        while (get().isThumbnailPaused || get().isScanning) {
          await new Promise<void>((r) => setTimeout(r, 200));
        }

        const batch = toProcess.slice(i, i + THUMBNAIL_CONCURRENCY);
        const results = await Promise.all(batch.map(processOne));
        cumulativeDone += batch.length;
        for (const v of batch) processedIds.add(v.id);

        while (get().isThumbnailPaused || get().isScanning) {
          await new Promise<void>((r) => setTimeout(r, 200));
        }

        const withThumb = results.filter((r): r is ThumbResult => r !== null && r.thumbnail !== undefined);
        const withoutThumb = results.filter((r): r is ThumbResult => r !== null && r.thumbnail === undefined);
        await flushBatchToDb(withThumb, withoutThumb);

        // null 結果 (処理失敗) を「試行済み」としてDBに記録し無限リトライを防ぐ
        const failedBatch = batch.filter((_, idx) => results[idx] === null);
        if (failedBatch.length > 0) {
          const currentVideos = get().videos;
          const failedNoThumb = failedBatch.filter((v) => {
            if (!v.thumbnail) {
              const current = currentVideos.find((cv) => cv.id === v.id);
              if (current && current.path !== v.path) return false;
              return true;
            }
            return false;
          });
          const failedHasThumb = failedBatch.filter((v) => !!v.thumbnail);
          if (failedNoThumb.length > 0) {
            await invoke('db_update_thumbnails_batch', {
              updates: failedNoThumb.map((v) => ({ id: v.id, thumbnail: '', duration: null, hasAudio: 0 })),
            }).catch((e) => console.error('[thumbnailUtils] failed record DB update:', e));
          }
          if (failedHasThumb.length > 0) {
            await invoke('db_update_audio_only_batch', {
              updates: failedHasThumb.map((v) => ({ id: v.id, hasAudio: 0 })),
            }).catch((e) => console.error('[thumbnailUtils] failed audio DB update:', e));
          }
        }

        const updateMap = new Map(
          results
            .filter((r): r is ThumbResult => r !== null)
            .map((r) => [r.id, r])
        );
        set((state) => ({
          videos: updateMap.size > 0
            ? state.videos.map((v) => {
                const upd = updateMap.get(v.id);
                return upd ? { ...v, ...upd } : v;
              })
            : state.videos,
          thumbnailProgress: { done: cumulativeDone, total: cumulativeTotal },
        }));
      }
    }
  } finally {
    set({ isThumbnailGenerating: false, isThumbnailPaused: false, thumbnailProgress: null });
    await onDone();
  }
}

// ── rescanVideo ────────────────────────────────────────────────────────────

export async function rescanVideoWorker(
  video: Video,
  onDone: () => Promise<void>
): Promise<void> {
  const e = ext(video.path);
  const isImage = IMAGE_EXTS.has(e);
  const isAudio = AUDIO_EXTS.has(e);
  const mediaType = isImage ? 'image' : isAudio ? 'audio' : 'video';
  const outputPath = await thumbOutputPath(video.path);

  try {
    let thumbnail: string | null = null;
    let duration: number | null = null;
    let hasAudio = 0;

    if (isImage) {
      try {
        const r = await invoke<TauriThumbResult>('generate_thumbnail', {
          videoPath: video.path,
          outputPath,
        });
        thumbnail = r.thumbnail_path;
      } catch { /* leave null */ }
    } else if (isAudio) {
      try {
        const r = await invoke<TauriThumbResult>('generate_thumbnail', {
          videoPath: video.path,
          outputPath,
        });
        thumbnail = r.thumbnail_path;
        duration = r.duration;
        hasAudio = 1;
      } catch {
        hasAudio = 1;
      }
    } else {
      const r = await invoke<TauriThumbResult>('generate_thumbnail', {
        videoPath: video.path,
        outputPath,
      });
      thumbnail = r.thumbnail_path;
      duration = r.duration;
      hasAudio = r.has_audio ? 1 : 0;
    }

    await invoke('db_update_video', { videoId: video.id, mediaType });
    await invoke('db_update_thumbnails_batch', {
      updates: [{ id: video.id, thumbnail, duration, hasAudio }],
    });
  } catch (e) {
    console.warn('[rescanVideoWorker] failed:', e);
  }

  await onDone();
}

// ── rescanMultiple ─────────────────────────────────────────────────────────

type RescanUpdate = {
  id: number;
  mediaType: string;
  thumbnail: string | null;
  duration: number | null;
  hasAudio: number;
};

async function rescanOne(video: Video): Promise<RescanUpdate | null> {
  const e = ext(video.path);
  const isImage = IMAGE_EXTS.has(e);
  const isAudio = AUDIO_EXTS.has(e);
  const mediaType = isImage ? 'image' : isAudio ? 'audio' : 'video';
  const outputPath = await thumbOutputPath(video.path);
  try {
    if (isImage) {
      try {
        const r = await invoke<TauriThumbResult>('generate_thumbnail', {
          videoPath: video.path,
          outputPath,
        });
        return { id: video.id, mediaType, thumbnail: r.thumbnail_path, duration: null, hasAudio: 0 };
      } catch {
        return { id: video.id, mediaType, thumbnail: null, duration: null, hasAudio: 0 };
      }
    } else if (isAudio) {
      try {
        const r = await invoke<TauriThumbResult>('generate_thumbnail', {
          videoPath: video.path,
          outputPath,
        });
        return { id: video.id, mediaType, thumbnail: r.thumbnail_path, duration: r.duration, hasAudio: 1 };
      } catch {
        return { id: video.id, mediaType, thumbnail: null, duration: null, hasAudio: 1 };
      }
    } else {
      const r = await invoke<TauriThumbResult>('generate_thumbnail', {
        videoPath: video.path,
        outputPath,
      });
      return {
        id: video.id,
        mediaType,
        thumbnail: r.thumbnail_path,
        duration: r.duration,
        hasAudio: r.has_audio ? 1 : 0,
      };
    }
  } catch (e) {
    console.warn('[rescanMultiple] failed for:', video.path, e);
    return null;
  }
}

export async function rescanMultipleWorker(
  rows: Video[],
  setProgress: (done: number, total: number) => void,
  onDone: () => Promise<void>
): Promise<void> {
  let done = 0;
  try {
    for (let i = 0; i < rows.length; i += THUMBNAIL_CONCURRENCY) {
      const batch = rows.slice(i, i + THUMBNAIL_CONCURRENCY);
      const results = await Promise.all(batch.map(rescanOne));
      done += batch.length;
      const valid = results.filter((r): r is RescanUpdate => r !== null);
      if (valid.length > 0) {
        for (const r of valid) {
          await invoke('db_update_video', { videoId: r.id, mediaType: r.mediaType });
        }
        await invoke('db_update_thumbnails_batch', {
          updates: valid.map((r) => ({
            id: r.id,
            thumbnail: r.thumbnail,
            duration: r.duration,
            hasAudio: r.hasAudio,
          })),
        });
      }
      setProgress(done, rows.length);
    }
  } finally {
    await onDone();
  }
}
