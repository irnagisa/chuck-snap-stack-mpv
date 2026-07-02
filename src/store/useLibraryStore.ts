import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';
import { appCacheDir, join } from '@tauri-apps/api/path';
import type { Video, Tag } from '../types';
import { useSettingsStore } from './useSettingsStore';
import { useTagStore } from './useTagStore';
import { usePlaylistStore } from './usePlaylistStore';
import { useToastStore, toast } from './useToastStore';

export type SortBy = 'created_at' | 'duration' | 'rating';
export type SortOrder = 'desc' | 'asc';
export type WatchedStatus = 'all' | 'watched' | 'unwatched';
export type TagFilterMode = 'and' | 'or';
export type MediaTypeFilter = 'all' | 'video' | 'audio' | 'image';

interface ScanResult {
  newCount: number;
  scannedCount: number;
  errors: string[];
  truncated: boolean;
  skippedCount: number;
}

interface LibraryState {
  videos: Video[];
  totalCount: number;
  currentPage: number;
  pageSize: number;
  filterSearch: string;
  filterCategoryId: number | null;
  filterTagIds: number[];
  filterTagMode: TagFilterMode;
  filterMinRating: number;
  filterHasAudio: number | null;
  filterMinDuration: number;
  filterMaxDuration: number;
  filterWatchedStatus: WatchedStatus;
  filterWatchDir: string | null;
  filterMediaType: MediaTypeFilter;
  filterSortBy: SortBy;
  filterSortOrder: SortOrder;
  watchDirs: string[];
  isScanning: boolean;
  isThumbnailGenerating: boolean;
  isThumbnailPaused: boolean;
  thumbnailProgress: { done: number; total: number } | null;
  isDbReady: boolean;
  dbError: string | null;
}

interface LibraryActions {
  initDb: () => Promise<void>;
  incrementWatchCount: (videoId: number) => Promise<void>;
  fetchVideos: () => Promise<void>;
  fetchAllForShuffle: () => Promise<Video[]>;
  setSearch: (search: string) => Promise<void>;
  setCategoryFilter: (id: number | null) => Promise<void>;
  toggleTagFilter: (tagId: number) => Promise<void>;
  clearTagFilters: () => Promise<void>;
  setTagMode: (mode: TagFilterMode) => Promise<void>;
  setMinRating: (rating: number) => Promise<void>;
  setHasAudio: (hasAudio: number | null) => Promise<void>;
  setMinDuration: (seconds: number) => Promise<void>;
  setMaxDuration: (seconds: number) => Promise<void>;
  setWatchedStatus: (status: WatchedStatus) => Promise<void>;
  setWatchDirFilter: (dir: string | null) => Promise<void>;
  setMediaType: (mediaType: MediaTypeFilter) => Promise<void>;
  setSort: (sortBy: SortBy, sortOrder: SortOrder) => Promise<void>;
  setPage: (page: number) => Promise<void>;
  scanAndImport: (path: string, useDirectoryAsCategory?: boolean) => Promise<void>;
  rescanAllDirs: (targetDir?: string) => Promise<void>;
  removeWatchDir: (path: string) => Promise<void>;
  generateThumbnails: () => Promise<void>;
  rescanVideo: (videoId: number) => Promise<void>;
  rescanMultiple: (videoIds: number[]) => Promise<void>;
  pauseThumbnails: () => void;
  resumeThumbnails: () => void;
  updateProgress: (videoId: number, progress: number) => Promise<void>;
  updateVideo: (videoId: number, updates: Partial<Pick<Video, 'title' | 'rating' | 'path' | 'media_type' | 'source_url'>>) => Promise<void>;
  deleteVideo: (videoId: number) => Promise<void>;
  removeVideo: (videoId: number) => Promise<void>;
  removeMultiple: (videoIds: number[]) => Promise<void>;
  assignCategoryFromPath: (videoIds: number[]) => Promise<void>;
  addVideoFromPath: (path: string, title: string, sourceUrl?: string, sourceType?: string) => Promise<number | null>;
  removeVideoByPath: (path: string) => Promise<void>;
  batchWatcherUpdate: (batch: { creates: { path: string; title: string }[]; removes: string[]; renames: { old_path: string; new_path: string; title: string }[] }) => Promise<void>;
  moveVideoFile: (videoId: number, destDir: string) => Promise<string | null>;
  renameVideoFile: (videoId: number, newPath: string) => Promise<void>;
  updateVideoPath: (oldPath: string, newPath: string) => Promise<void>;
}

const THUMBNAIL_CONCURRENCY = 3;

// Tag 配列の内容が同一かどうかを比較する (fetchVideos での参照正規化用)
function tagsEqual(a: Tag[], b: Tag[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const ta = a[i], tb = b[i];
    if (ta.id !== tb.id || ta.name !== tb.name || ta.color !== tb.color ||
        ta.icon !== tb.icon || ta.tag_category_id !== tb.tag_category_id) return false;
  }
  return true;
}

function notifyScanResult(result: ScanResult): void {
  if (result.errors.length > 0) {
    const count = result.errors.length;
    toast.error(
      `スキャンエラー ${count}件: ${result.errors[0]}${count > 1 ? ` 他${count - 1}件` : ''}`,
      8000
    );
  }
  if (result.truncated) {
    toast.info('50,000件の上限に達しました。一部ファイルが取り込まれていない可能性があります。', 8000);
  }
  if (result.scannedCount === 0 && result.skippedCount > 0) {
    toast.info(`対応するメディアファイルが見つかりませんでした（${result.skippedCount}件は非対応形式）`, 8000);
  }
  if (result.newCount > 0) {
    toast.success(`${result.newCount}件の新しいファイルを追加しました (スキャン: ${result.scannedCount}件)`, 5000);
  } else if (result.scannedCount > 0) {
    toast.info(`スキャン完了 (${result.scannedCount}件はすでにライブラリに登録済み)`, 5000);
  }
}

export const useLibraryStore = create<LibraryState & LibraryActions>((set, get) => ({
  videos: [],
  totalCount: 0,
  currentPage: 1,
  pageSize: 100,
  filterSearch: '',
  filterCategoryId: null,
  filterTagIds: [],
  filterTagMode: 'and',
  filterMinRating: 0,
  filterHasAudio: null,
  filterMinDuration: 0,
  filterMaxDuration: 0,
  filterWatchedStatus: 'all',
  filterWatchDir: null,
  filterMediaType: 'all',
  filterSortBy: 'created_at',
  filterSortOrder: 'desc',
  watchDirs: [],
  isScanning: false,
  isThumbnailGenerating: false,
  isThumbnailPaused: false,
  thumbnailProgress: null,
  isDbReady: false,
  dbError: null,

  initDb: async () => {
    try {
      set({ isDbReady: true });
      await useSettingsStore.getState().loadSettings();
      await get().fetchVideos();
      await useTagStore.getState().init();
      await usePlaylistStore.getState().init();
      const watchDirRows = await invoke<{ path: string; useDirAsCategory: number }[]>('db_get_watch_dirs');
      const canonicalDirs: string[] = [];
      for (const d of watchDirRows) {
        const canonical = await invoke<string>('canonicalize_path', { path: d.path }).catch(() => d.path);
        canonicalDirs.push(canonical);
      }
      set({ watchDirs: canonicalDirs });
      for (const dir of canonicalDirs) {
        invoke('start_watching', { path: dir }).catch((e: unknown) => {
          console.error(`[initDb] フォルダ監視の開始に失敗しました (${dir}):`, e);
          toast.error(`フォルダ監視の開始に失敗しました: ${e instanceof Error ? e.message : String(e)}`);
        });
      }
      get().generateThumbnails().catch((e: unknown) => {
        console.error('[initDb] サムネイル生成エラー:', e);
        toast.error(`サムネイル生成でエラーが発生しました: ${String(e)}`);
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error('initDb failed:', msg);
      set({ dbError: msg });
    }
  },

  fetchVideos: async () => {
    const {
      currentPage, pageSize, filterSortBy, filterSortOrder,
      filterSearch, filterCategoryId, filterTagIds, filterTagMode,
      filterMinRating, filterHasAudio, filterMinDuration, filterMaxDuration,
      filterWatchedStatus, filterWatchDir, filterMediaType,
    } = get();

    const result = await invoke<{
      videos: Video[];
      totalCount: number;
      videoTags: { videoId: number; id: number; name: string; color: string; icon: string | null; tagCategoryId: number | null; createdAt: string }[];
    }>('db_fetch_videos', {
      filter: {
        filterSearch,
        filterCategoryId,
        filterTagIds,
        filterTagMode,
        filterMinRating,
        filterHasAudio,
        filterMinDuration,
        filterMaxDuration: filterMaxDuration > 0 ? filterMaxDuration : null,
        filterWatchedStatus,
        filterWatchDir,
        filterMediaType,
        filterSortBy,
        filterSortOrder,
        currentPage,
        pageSize,
      },
    });

    const { videos, totalCount, videoTags: videoTagRows } = result;
    const maxPage = Math.max(1, Math.ceil(totalCount / pageSize));
    const page = Math.min(currentPage, maxPage);
    set({ videos, totalCount, currentPage: page });

    const prevVideoTags = useTagStore.getState().videoTags;
    const videoTagsMap: Record<number, Tag[]> = {};
    for (const row of videoTagRows) {
      if (!videoTagsMap[row.videoId]) videoTagsMap[row.videoId] = [];
      videoTagsMap[row.videoId].push({
        id: row.id,
        name: row.name,
        color: row.color,
        icon: row.icon,
        tag_category_id: row.tagCategoryId,
        created_at: row.createdAt,
      });
    }
    // 内容が変わっていない動画のタグ配列は既存の参照を維持する。
    // これにより useShallow が差分なしと判定し、LibraryGrid の不要な再レンダリングを防ぐ。
    const normalizedVideoTags: Record<number, Tag[]> = {};
    for (const [key, newTags] of Object.entries(videoTagsMap)) {
      const videoId = Number(key);
      const prev = prevVideoTags[videoId];
      normalizedVideoTags[videoId] = prev && tagsEqual(prev, newTags) ? prev : newTags;
    }
    useTagStore.setState({ videoTags: normalizedVideoTags });
  },

  fetchAllForShuffle: async () => {
    const { filterSortBy, filterSortOrder } = get();
    return invoke<Video[]>('db_fetch_all_for_shuffle', {
      filter: {
        filterSearch: get().filterSearch,
        filterCategoryId: get().filterCategoryId,
        filterTagIds: get().filterTagIds,
        filterTagMode: get().filterTagMode,
        filterMinRating: get().filterMinRating,
        filterHasAudio: get().filterHasAudio,
        filterMinDuration: get().filterMinDuration,
        filterMaxDuration: get().filterMaxDuration > 0 ? get().filterMaxDuration : null,
        filterWatchedStatus: get().filterWatchedStatus,
        filterWatchDir: get().filterWatchDir,
        filterMediaType: get().filterMediaType,
        filterSortBy,
        filterSortOrder,
        currentPage: 1,
        pageSize: 999999,
      },
    });
  },

  setSearch: async (search: string) => {
    set({ filterSearch: search, currentPage: 1 });
    await get().fetchVideos();
  },

  setCategoryFilter: async (id: number | null) => {
    set({ filterCategoryId: id, currentPage: 1 });
    await get().fetchVideos();
  },

  toggleTagFilter: async (tagId: number) => {
    const { filterTagIds } = get();
    const next = filterTagIds.includes(tagId)
      ? filterTagIds.filter((id) => id !== tagId)
      : [...filterTagIds, tagId];
    set({ filterTagIds: next, currentPage: 1 });
    await get().fetchVideos();
  },

  clearTagFilters: async () => {
    set({ filterTagIds: [], currentPage: 1 });
    await get().fetchVideos();
  },

  setTagMode: async (mode: TagFilterMode) => {
    set({ filterTagMode: mode, currentPage: 1 });
    await get().fetchVideos();
  },

  setMinRating: async (rating: number) => {
    set({ filterMinRating: rating, currentPage: 1 });
    await get().fetchVideos();
  },

  setHasAudio: async (hasAudio: number | null) => {
    set({ filterHasAudio: hasAudio, currentPage: 1 });
    await get().fetchVideos();
  },

  setMinDuration: async (seconds: number) => {
    set({ filterMinDuration: seconds, currentPage: 1 });
    await get().fetchVideos();
  },

  setMaxDuration: async (seconds: number) => {
    set({ filterMaxDuration: seconds, currentPage: 1 });
    await get().fetchVideos();
  },

  setWatchedStatus: async (status: WatchedStatus) => {
    set({ filterWatchedStatus: status, currentPage: 1 });
    await get().fetchVideos();
  },

  setWatchDirFilter: async (dir: string | null) => {
    set({ filterWatchDir: dir, currentPage: 1 });
    await get().fetchVideos();
  },

  setMediaType: async (mediaType: MediaTypeFilter) => {
    set({ filterMediaType: mediaType, currentPage: 1 });
    await get().fetchVideos();
  },

  setSort: async (sortBy: SortBy, sortOrder: SortOrder) => {
    set({ filterSortBy: sortBy, filterSortOrder: sortOrder, currentPage: 1 });
    await get().fetchVideos();
  },

  setPage: async (page: number) => {
    set({ currentPage: page });
    await get().fetchVideos();
  },

  scanAndImport: async (path: string, useDirectoryAsCategory = false) => {
    set({ isScanning: true });
    try {
      const canonicalPath = await invoke<string>('canonicalize_path', { path }).catch(() => path);
      // Register as watch dir
      await invoke('db_add_watch_dir', { path: canonicalPath, useDirAsCategory: useDirectoryAsCategory });
      set((state) => ({
        watchDirs: state.watchDirs.includes(canonicalPath)
          ? state.watchDirs
          : [...state.watchDirs, canonicalPath],
      }));
      invoke('start_watching', { path: canonicalPath }).catch((e: unknown) => {
        console.error(`[scanAndImport] フォルダ監視の開始に失敗しました (${canonicalPath}):`, e);
        toast.error(`フォルダ監視の開始に失敗しました: ${e instanceof Error ? e.message : String(e)}`);
      });

      const result = await invoke<ScanResult>('db_scan_and_import', {
        path: canonicalPath,
        useDirAsCategory: useDirectoryAsCategory,
      });

      notifyScanResult(result);

      set({ currentPage: 1 });
      await get().fetchVideos();
      await useTagStore.getState().fetchCategories();
      get().generateThumbnails().catch((e: unknown) => {
        console.error('[scanAndImport] サムネイル生成エラー:', e);
        toast.error(`サムネイル生成でエラーが発生しました: ${String(e)}`);
      });
    } finally {
      set({ isScanning: false });
    }
  },

  rescanAllDirs: async (targetDir?: string) => {
    set({ isScanning: true });
    try {
      const { downloadDir, categoryMode } = useSettingsStore.getState();

      // Sync モード: ルート直下ファイルを Inbox サブフォルダへ移行
      if (categoryMode === 'sync') {
        const dirsToMigrate = targetDir ? [targetDir] : get().watchDirs;
        for (const dir of dirsToMigrate) {
          try {
            const migrateResult = await invoke<{ moved: number; skipped: number; errors: string[] }>(
              'migrate_root_files_to_inbox',
              { watchDir: dir }
            );
            if (migrateResult.moved > 0) {
              toast.success(`${migrateResult.moved}件のファイルを Inbox に移動しました`);
            }
            for (const err of migrateResult.errors) {
              console.error('[migrateRootToInbox]', err);
              toast.error(`Inbox 移行エラー: ${err}`, 8000);
            }
          } catch (migrateErr) {
            console.error('[migrateRootToInbox] 失敗:', migrateErr);
            toast.error(`Inbox 移行に失敗しました: ${String(migrateErr)}`, 8000);
          }
        }
      }

      const result = await invoke<ScanResult>('db_rescan_all_dirs', {
        targetDir: targetDir ?? null,
        downloadDir: downloadDir || null,
      });

      notifyScanResult(result);

      set({ currentPage: 1 });
      await get().fetchVideos();
      get().generateThumbnails().catch((e: unknown) => {
        console.error('[rescanAllDirs] サムネイル生成エラー:', e);
        toast.error(`サムネイル生成でエラーが発生しました: ${String(e)}`);
      });
    } catch (e) {
      console.error('rescanAllDirs failed:', e);
      toast.error(`スキャン中にエラーが発生しました: ${String(e)}`, 8000);
    } finally {
      set({ isScanning: false });
    }
  },

  removeWatchDir: async (path: string) => {
    await invoke('db_remove_watch_dir', { path });
    await invoke('stop_watching', { path }).catch((e: unknown) => {
      console.error(`[removeWatchDir] ウォッチャー停止に失敗しました (${path}):`, e);
      toast.error(`フォルダ監視の停止に失敗しました: ${e instanceof Error ? e.message : String(e)}`);
    });
    set((state) => ({
      watchDirs: state.watchDirs.filter((d) => d !== path),
      filterWatchDir: state.filterWatchDir === path ? null : state.filterWatchDir,
    }));
    await get().fetchVideos();
  },

  pauseThumbnails: () => {
    set({ isThumbnailPaused: true });
  },

  resumeThumbnails: () => {
    set({ isThumbnailPaused: false });
  },

  generateThumbnails: async () => {
    if (get().isThumbnailGenerating) return;

    const cacheDir = await appCacheDir();
    const thumbDir = await join(cacheDir, 'thumbnails');

    set({ isThumbnailGenerating: true, isThumbnailPaused: false, thumbnailProgress: null });

    type VideoUpdate = { id: number; thumbnail?: string | null; duration?: number | null; hasAudio: number };

    const audioExts = ['mp3', 'flac', 'aac', 'wav', 'ogg', 'opus', 'm4a', 'wma'];
    const imageExts = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'tiff', 'heic', 'avif'];

    const processVideoData = async (video: { id: number; path: string; thumbnail: string | null }): Promise<VideoUpdate | null> => {
      try {
        const ext = video.path.split('.').pop()?.toLowerCase() ?? '';
        const isImage = imageExts.includes(ext);
        const isAudio = audioExts.includes(ext);

        if (isImage) {
          if (video.thumbnail) {
            return { id: video.id, hasAudio: 0 };
          }
          const hashBuffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(video.path));
          const hash = Array.from(new Uint8Array(hashBuffer)).map((b) => b.toString(16).padStart(2, '0')).join('');
          const outputPath = await join(thumbDir, hash.slice(0, 2), `${hash}.webp`);
          try {
            const result = await invoke<{ thumbnail_path: string; duration: number | null; has_audio: boolean }>(
              'generate_thumbnail',
              { videoPath: video.path, outputPath }
            );
            return { id: video.id, thumbnail: result.thumbnail_path, duration: null, hasAudio: 0 };
          } catch {
            return { id: video.id, thumbnail: '', duration: null, hasAudio: 0 };
          }
        }

        if (!video.thumbnail) {
          const hashBuffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(video.path));
          const hash = Array.from(new Uint8Array(hashBuffer)).map((b) => b.toString(16).padStart(2, '0')).join('');
          const outputPath = await join(thumbDir, hash.slice(0, 2), `${hash}.webp`);

          if (isAudio) {
            try {
              const result = await invoke<{ thumbnail_path: string; duration: number | null; has_audio: boolean }>(
                'generate_thumbnail', { videoPath: video.path, outputPath }
              );
              return { id: video.id, thumbnail: result.thumbnail_path, duration: result.duration, hasAudio: 1 };
            } catch {
              return { id: video.id, thumbnail: '', duration: null, hasAudio: 1 };
            }
          }

          const result = await invoke<{ thumbnail_path: string; duration: number | null; has_audio: boolean }>(
            'generate_thumbnail', { videoPath: video.path, outputPath }
          );
          return { id: video.id, thumbnail: result.thumbnail_path, duration: result.duration, hasAudio: result.has_audio ? 1 : 0 };
        } else {
          if (isAudio) return { id: video.id, hasAudio: 1 };
          const hasAudioRaw = await invoke<boolean>('check_has_audio', { videoPath: video.path });
          return { id: video.id, hasAudio: hasAudioRaw ? 1 : 0 };
        }
      } catch (e) {
        console.warn(`Audio/thumbnail processing failed for ${video.path}:`, e);
        return null;
      }
    };

    const processedIds = new Set<number>();
    const PENDING_BATCH_SIZE = 500;
    let cumulativeDone = 0;
    let cumulativeTotal = 0;

    try {
      while (true) {
        const pending = await invoke<{ id: number; path: string; thumbnail: string | null }[]>(
          'db_get_pending_thumbnails', { limit: PENDING_BATCH_SIZE }
        );
        const toProcess = pending.filter((v) => !processedIds.has(v.id));
        if (toProcess.length === 0) break;

        cumulativeTotal += toProcess.length;
        set({ thumbnailProgress: { done: cumulativeDone, total: cumulativeTotal } });

        for (let i = 0; i < toProcess.length; i += THUMBNAIL_CONCURRENCY) {
          while (get().isThumbnailPaused || get().isScanning) {
            await new Promise<void>((resolve) => setTimeout(resolve, 200));
          }
          const batch = toProcess.slice(i, i + THUMBNAIL_CONCURRENCY);
          const results = await Promise.all(batch.map(processVideoData));
          cumulativeDone += batch.length;
          for (const v of batch) processedIds.add(v.id);

          while (get().isThumbnailPaused || get().isScanning) {
            await new Promise<void>((resolve) => setTimeout(resolve, 200));
          }

          const withThumb = results.filter((r): r is VideoUpdate => r !== null && r.thumbnail !== undefined);
          const withoutThumb = results.filter((r): r is VideoUpdate => r !== null && r.thumbnail === undefined);

          if (withThumb.length > 0) {
            try {
              await invoke('db_update_thumbnails_batch', {
                updates: withThumb.map((r) => ({
                  id: r.id,
                  thumbnail: r.thumbnail ?? null,
                  duration: r.duration ?? null,
                  hasAudio: r.hasAudio,
                })),
              });
            } catch (e) {
              console.error('[generateThumbnails] サムネイルバッチDB更新失敗:', e);
            }
          }

          if (withoutThumb.length > 0) {
            try {
              await invoke('db_update_audio_only_batch', {
                updates: withoutThumb.map((r) => ({ id: r.id, hasAudio: r.hasAudio })),
              });
            } catch (e) {
              console.error('[generateThumbnails] 音声情報バッチDB更新失敗:', e);
            }
          }

          // processVideoData が null を返したアイテムを「処理試行済み」としてDBに記録し、
          // 次回 generateThumbnails 呼び出し時に無限リトライされるのを防ぐ
          const failedBatch = batch.filter((_, idx) => results[idx] === null);
          if (failedBatch.length > 0) {
            // リネーム/移動中にパスが変わった動画は永続失敗扱いにしない:
            // thumbnail='' をセットすると再試行されなくなるため、
            // ストアの現在パスとバッチ取得時のパスが異なる場合はスキップする
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
              try {
                await invoke('db_update_thumbnails_batch', {
                  updates: failedNoThumb.map((v) => ({ id: v.id, thumbnail: '', duration: null, hasAudio: 0 })),
                });
              } catch (e) {
                console.error('[generateThumbnails] 失敗レコードのDB記録に失敗:', e);
              }
            }
            if (failedHasThumb.length > 0) {
              try {
                await invoke('db_update_audio_only_batch', {
                  updates: failedHasThumb.map((v) => ({ id: v.id, hasAudio: 0 })),
                });
              } catch (e) {
                console.error('[generateThumbnails] 失敗レコードの音声情報DB記録に失敗:', e);
              }
            }
          }

          const updateMap = new Map(
            results
              .filter((r): r is VideoUpdate => r !== null)
              .map((r) => [r.id, r])
          );
          if (updateMap.size > 0) {
            set((state) => ({
              videos: state.videos.map((v) => {
                const upd = updateMap.get(v.id);
                return upd ? { ...v, ...upd } : v;
              }),
              thumbnailProgress: { done: cumulativeDone, total: cumulativeTotal },
            }));
          } else {
            set({ thumbnailProgress: { done: cumulativeDone, total: cumulativeTotal } });
          }
        }
      }
    } finally {
      set({ isThumbnailGenerating: false, isThumbnailPaused: false, thumbnailProgress: null });
      await get().fetchVideos();
    }
  },

  rescanVideo: async (videoId: number) => {
    const video = get().videos.find((v) => v.id === videoId);
    if (!video) return;

    const audioExts = ['mp3', 'flac', 'aac', 'wav', 'ogg', 'opus', 'm4a', 'wma'];
    const imageExts = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'tiff', 'heic', 'avif'];
    const ext = video.path.split('.').pop()?.toLowerCase() ?? '';
    const isImage = imageExts.includes(ext);
    const isAudio = audioExts.includes(ext);
    const mediaType = isImage ? 'image' : isAudio ? 'audio' : 'video';

    const cacheDir = await appCacheDir();
    const thumbDir = await join(cacheDir, 'thumbnails');
    const hashBuffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(video.path));
    const hash = Array.from(new Uint8Array(hashBuffer)).map((b) => b.toString(16).padStart(2, '0')).join('');
    const outputPath = await join(thumbDir, hash.slice(0, 2), `${hash}.webp`);

    try {
      let thumbnail: string | null = null;
      let duration: number | null = null;
      let hasAudio = 0;

      if (isImage) {
        try {
          const result = await invoke<{ thumbnail_path: string; duration: number | null; has_audio: boolean }>(
            'generate_thumbnail', { videoPath: video.path, outputPath }
          );
          thumbnail = result.thumbnail_path;
        } catch { /* leave null */ }
      } else if (isAudio) {
        try {
          const result = await invoke<{ thumbnail_path: string; duration: number | null; has_audio: boolean }>(
            'generate_thumbnail', { videoPath: video.path, outputPath }
          );
          thumbnail = result.thumbnail_path;
          duration = result.duration;
          hasAudio = 1;
        } catch {
          hasAudio = 1;
        }
      } else {
        const result = await invoke<{ thumbnail_path: string; duration: number | null; has_audio: boolean }>(
          'generate_thumbnail', { videoPath: video.path, outputPath }
        );
        thumbnail = result.thumbnail_path;
        duration = result.duration;
        hasAudio = result.has_audio ? 1 : 0;
      }

      await invoke('db_update_video', { videoId, mediaType });
      await invoke('db_update_thumbnails_batch', {
        updates: [{ id: videoId, thumbnail, duration, hasAudio }],
      });
    } catch (e) {
      console.warn('rescanVideo failed:', e);
    }

    await get().fetchVideos();
  },

  rescanMultiple: async (videoIds: number[]) => {
    if (videoIds.length === 0) return;

    const audioExts = ['mp3', 'flac', 'aac', 'wav', 'ogg', 'opus', 'm4a', 'wma'];
    const imageExts = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'tiff', 'heic', 'avif'];

    const rows = get().videos.filter((v) => videoIds.includes(v.id));

    const cacheDir = await appCacheDir();
    const thumbDir = await join(cacheDir, 'thumbnails');

    set({ isThumbnailGenerating: true, isThumbnailPaused: false, thumbnailProgress: { done: 0, total: rows.length } });

    type RescanUpdate = { id: number; mediaType: string; thumbnail: string | null; duration: number | null; hasAudio: number };

    const processOne = async (video: Video): Promise<RescanUpdate | null> => {
      const ext = video.path.split('.').pop()?.toLowerCase() ?? '';
      const isImage = imageExts.includes(ext);
      const isAudio = audioExts.includes(ext);
      const mediaType = isImage ? 'image' : isAudio ? 'audio' : 'video';
      const hashBuffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(video.path));
      const hash = Array.from(new Uint8Array(hashBuffer)).map((b) => b.toString(16).padStart(2, '0')).join('');
      const outputPath = await join(thumbDir, hash.slice(0, 2), `${hash}.webp`);
      try {
        if (isImage) {
          try {
            const result = await invoke<{ thumbnail_path: string; duration: number | null; has_audio: boolean }>(
              'generate_thumbnail', { videoPath: video.path, outputPath }
            );
            return { id: video.id, mediaType, thumbnail: result.thumbnail_path, duration: null, hasAudio: 0 };
          } catch {
            return { id: video.id, mediaType, thumbnail: null, duration: null, hasAudio: 0 };
          }
        } else if (isAudio) {
          try {
            const result = await invoke<{ thumbnail_path: string; duration: number | null; has_audio: boolean }>(
              'generate_thumbnail', { videoPath: video.path, outputPath }
            );
            return { id: video.id, mediaType, thumbnail: result.thumbnail_path, duration: result.duration, hasAudio: 1 };
          } catch {
            return { id: video.id, mediaType, thumbnail: null, duration: null, hasAudio: 1 };
          }
        } else {
          const result = await invoke<{ thumbnail_path: string; duration: number | null; has_audio: boolean }>(
            'generate_thumbnail', { videoPath: video.path, outputPath }
          );
          return { id: video.id, mediaType, thumbnail: result.thumbnail_path, duration: result.duration, hasAudio: result.has_audio ? 1 : 0 };
        }
      } catch (e) {
        console.warn('rescanMultiple failed for:', video.path, e);
        return null;
      }
    };

    let done = 0;
    try {
      for (let i = 0; i < rows.length; i += THUMBNAIL_CONCURRENCY) {
        const batch = rows.slice(i, i + THUMBNAIL_CONCURRENCY);
        const results = await Promise.all(batch.map(processOne));
        done += batch.length;
        const valid = results.filter((r): r is RescanUpdate => r !== null);
        if (valid.length > 0) {
          // Update media_type for each
          for (const r of valid) {
            await invoke('db_update_video', { videoId: r.id, mediaType: r.mediaType });
          }
          await invoke('db_update_thumbnails_batch', {
            updates: valid.map((r) => ({ id: r.id, thumbnail: r.thumbnail, duration: r.duration, hasAudio: r.hasAudio })),
          });
        }
        set({ thumbnailProgress: { done, total: rows.length } });
      }
    } finally {
      set({ isThumbnailGenerating: false, isThumbnailPaused: false, thumbnailProgress: null });
      await get().fetchVideos();
    }
  },

  updateProgress: async (videoId: number, progress: number) => {
    await invoke('db_update_progress', { videoId, progress });
    set((state) => ({
      videos: state.videos.map((v) => v.id === videoId ? { ...v, progress } : v),
    }));
  },

  updateVideo: async (videoId: number, updates: Partial<Pick<Video, 'title' | 'rating' | 'path' | 'media_type' | 'source_url'>>) => {
    await invoke('db_update_video', {
      videoId,
      title: updates.title ?? null,
      rating: updates.rating ?? null,
      path: updates.path ?? null,
      mediaType: updates.media_type ?? null,
      sourceUrl: updates.source_url ?? null,
    });
    set((state) => ({
      videos: state.videos.map((v) => v.id === videoId ? { ...v, ...updates } : v),
    }));
  },

  deleteVideo: async (videoId: number) => {
    await invoke('db_delete_video', { videoId });
    await get().fetchVideos();
  },

  removeVideo: async (videoId: number) => {
    await invoke('db_remove_video', { videoId });
    await get().fetchVideos();
  },

  removeMultiple: async (videoIds: number[]) => {
    if (videoIds.length === 0) return;
    await invoke('db_remove_multiple', { videoIds });
    await get().fetchVideos();
  },

  assignCategoryFromPath: async (videoIds: number[]) => {
    if (videoIds.length === 0) return;

    const total = videoIds.length;
    const { addToast, removeToast } = useToastStore.getState();
    const toastId = addToast(`カテゴリ割り当て中... 0 / ${total}`, 'info', 0);
    try {
      const assigned = await invoke<number>('db_assign_category_from_path', { videoIds });
      await useTagStore.getState().fetchCategories();
      await get().fetchVideos();
      removeToast(toastId);
      addToast(
        assigned > 0 ? `カテゴリを割り当てました（${assigned} 件）` : 'カテゴリ割り当て完了',
        'success'
      );
    } catch (e) {
      removeToast(toastId);
      throw e;
    }
  },

  addVideoFromPath: async (path: string, title: string, sourceUrl?: string, sourceType?: string) => {
    const newId = await invoke<number | null>('db_add_video_from_path', {
      path,
      title,
      sourceUrl: sourceUrl ?? null,
      sourceType: sourceType ?? null,
    });
    await get().fetchVideos();
    get().generateThumbnails().catch((e: unknown) => {
      console.error('[addVideoFromPath] サムネイル生成エラー:', e);
    });
    return newId;
  },

  removeVideoByPath: async (path: string) => {
    await invoke('db_remove_video_by_path', { path });
    await get().fetchVideos();
  },

  batchWatcherUpdate: async ({ creates, removes, renames }) => {
    await invoke('db_batch_watcher_update', {
      creates,
      removes,
      renames: renames.map((r) => ({ oldPath: r.old_path, newPath: r.new_path, title: r.title })),
    });
    await get().fetchVideos();
    get().generateThumbnails().catch((e: unknown) => {
      console.error('[batchWatcherUpdate] サムネイル生成エラー:', e);
    });
  },

  moveVideoFile: async (videoId: number, destDir: string) => {
    const video = get().videos.find((v) => v.id === videoId);
    if (!video) return null;
    try {
      const newPath = await invoke<string>('move_video_file', {
        sourcePath: video.path,
        destDir,
      });
      try {
        await invoke('db_move_video_file_db', { videoId, newPath });
      } catch (dbErr) {
        // ファイルは移動済みだがDB更新が失敗した場合: ユーザーに再スキャンを促す
        const dbMsg = dbErr instanceof Error ? dbErr.message : String(dbErr);
        console.error('[moveVideoFile] DB更新失敗 (ファイルは移動済み):', dbMsg);
        toast.error(
          `ファイルは移動しましたがデータベースの更新に失敗しました。\nライブラリを再スキャンしてください。\n詳細: ${dbMsg}`,
          8000
        );
        return null;
      }
      set((state) => ({
        videos: state.videos.map((v) => v.id === videoId ? { ...v, path: newPath } : v),
      }));
      // 移動後はサムネイル再生成をトリガーする (移動中に生成が失敗した場合に備えて)
      get().generateThumbnails().catch((e: unknown) => {
        console.error('[moveVideoFile] サムネイル再生成トリガー失敗:', e);
        toast.error(`サムネイル生成でエラーが発生しました: ${String(e)}`);
      });
      return newPath;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error('[moveVideoFile] ファイル移動に失敗しました:', msg);
      toast.error(`ファイルの移動に失敗しました: ${msg}`);
      return null;
    }
  },

  renameVideoFile: async (videoId: number, newPath: string) => {
    await invoke('db_rename_video_file', { videoId, newPath });
    await get().fetchVideos();
    // リネーム後はサムネイル再生成をトリガーする (リネーム中に生成が失敗した場合に備えて)
    get().generateThumbnails().catch((e: unknown) => {
      console.error('[renameVideoFile] サムネイル再生成トリガー失敗:', e);
    });
  },

  updateVideoPath: async (oldPath: string, newPath: string) => {
    await invoke('db_update_video_path', { oldPath, newPath });
    await get().fetchVideos();
  },

  incrementWatchCount: async (videoId: number) => {
    await invoke('db_increment_watch_count', { videoId });
    set((state) => ({
      videos: state.videos.map((v) =>
        v.id === videoId ? { ...v, watch_count: (v.watch_count ?? 0) + 1 } : v
      ),
    }));
  },
}));
