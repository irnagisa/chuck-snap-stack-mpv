import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

// ── モック (import より前に宣言する必要がある) ───────────────────────────────
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/path', () => ({
  appCacheDir: vi.fn(() => Promise.resolve('/cache')),
  join: vi.fn((...parts: string[]) => Promise.resolve(parts.join('/'))),
}));
vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(() => Promise.resolve(() => {})),
}));
vi.mock('./useSettingsStore', () => ({
  useSettingsStore: {
    getState: vi.fn(() => ({
      loadSettings: vi.fn(() => Promise.resolve()),
      downloadDir: null,
      categoryMode: 'manual',
    })),
  },
}));
vi.mock('./useTagStore', () => ({
  useTagStore: {
    getState: vi.fn(() => ({
      init: vi.fn(() => Promise.resolve()),
      fetchCategories: vi.fn(() => Promise.resolve()),
      videoTags: {},
    })),
    setState: vi.fn(),
  },
}));
vi.mock('./usePlaylistStore', () => ({
  usePlaylistStore: {
    getState: vi.fn(() => ({
      init: vi.fn(() => Promise.resolve()),
    })),
  },
}));
vi.mock('./useToastStore', () => ({
  useToastStore: {
    getState: vi.fn(() => ({
      addToast: vi.fn(() => 'toast-1'),
      removeToast: vi.fn(),
    })),
  },
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));
vi.mock('./thumbnailUtils', () => ({
  generateThumbnailsWorker: vi.fn(() => Promise.resolve()),
  rescanVideoWorker: vi.fn(() => Promise.resolve()),
  rescanMultipleWorker: vi.fn(() => Promise.resolve()),
}));

import { invoke } from '@tauri-apps/api/core';
import { useLibraryStore } from './useLibraryStore';

const mockInvoke = vi.mocked(invoke);

// fetchVideos が返すデフォルトレスポンス
const emptyVideosResult = { videos: [], totalCount: 0, videoTags: [] };

// ── 初期状態スナップショット ─────────────────────────────────────────────────
const INITIAL = useLibraryStore.getState();

beforeEach(() => {
  useLibraryStore.setState(INITIAL);
  vi.clearAllMocks();
  // デフォルトで fetchVideos が成功するよう設定
  mockInvoke.mockResolvedValue(emptyVideosResult);
});

afterEach(() => {
  vi.clearAllMocks();
});

// ── initDb ───────────────────────────────────────────────────────────────────

describe('initDb', () => {
  it('sets isDbReady to true on success', async () => {
    mockInvoke
      .mockResolvedValueOnce(emptyVideosResult)  // db_fetch_videos
      .mockResolvedValueOnce([])                 // db_get_watch_dirs
      .mockResolvedValue([]);                    // db_get_pending_thumbnails etc.

    await useLibraryStore.getState().initDb();

    expect(useLibraryStore.getState().isDbReady).toBe(true);
  });

  it('sets dbError on failure', async () => {
    const { useSettingsStore } = await import('./useSettingsStore');
    vi.mocked(useSettingsStore.getState).mockImplementationOnce(() => ({
      loadSettings: vi.fn(() => Promise.reject(new Error('設定読み込み失敗'))),
      downloadDir: null,
      categoryMode: 'manual',
    } as unknown as ReturnType<typeof useSettingsStore.getState>));

    await useLibraryStore.getState().initDb();

    expect(useLibraryStore.getState().dbError).toBe('設定読み込み失敗');
  });

  it('populates watchDirs from db_get_watch_dirs', async () => {
    mockInvoke
      .mockResolvedValueOnce(emptyVideosResult)                           // db_fetch_videos
      .mockResolvedValueOnce([{ path: '/videos', useDirAsCategory: 0 }]) // db_get_watch_dirs
      .mockResolvedValueOnce('/videos')                                   // canonicalize_path
      .mockResolvedValue(undefined);                                      // start_watching + others

    await useLibraryStore.getState().initDb();

    expect(useLibraryStore.getState().watchDirs).toContain('/videos');
  });
});

// ── fetchVideos ───────────────────────────────────────────────────────────────

describe('fetchVideos', () => {
  it('calls db_fetch_videos with current filter state', async () => {
    useLibraryStore.setState({ filterSearch: 'cat', filterMinRating: 3, currentPage: 2 });

    await useLibraryStore.getState().fetchVideos();

    expect(mockInvoke).toHaveBeenCalledWith('db_fetch_videos', expect.objectContaining({
      filter: expect.objectContaining({
        filterSearch: 'cat',
        filterMinRating: 3,
        currentPage: 2,
      }),
    }));
  });

  it('updates videos and totalCount from the result', async () => {
    const video = { id: 1, path: '/a.mp4', title: 'A', duration: 60, thumbnail: null,
      watched_at: null, progress: 0, rating: 0, category_id: null, has_audio: null,
      watch_count: 0, created_at: '2024-01-01', media_type: 'video', source_url: null,
      status: null, source_type: null };
    mockInvoke.mockResolvedValueOnce({ videos: [video], totalCount: 1, videoTags: [] });

    await useLibraryStore.getState().fetchVideos();

    expect(useLibraryStore.getState().videos).toHaveLength(1);
    expect(useLibraryStore.getState().totalCount).toBe(1);
  });

  it('clamps currentPage when it exceeds total pages', async () => {
    useLibraryStore.setState({ currentPage: 5, pageSize: 100 });
    mockInvoke.mockResolvedValueOnce({ videos: [], totalCount: 50, videoTags: [] });

    await useLibraryStore.getState().fetchVideos();

    // totalCount=50, pageSize=100 → maxPage=1 → clamps to 1
    expect(useLibraryStore.getState().currentPage).toBe(1);
  });

  it('passes filterMaxDuration as null when it is 0', async () => {
    useLibraryStore.setState({ filterMaxDuration: 0 });

    await useLibraryStore.getState().fetchVideos();

    expect(mockInvoke).toHaveBeenCalledWith('db_fetch_videos', expect.objectContaining({
      filter: expect.objectContaining({ filterMaxDuration: null }),
    }));
  });
});

// ── フィルターセッター (共通パターン) ─────────────────────────────────────────

describe('setSearch', () => {
  it('updates filterSearch, resets page to 1, calls fetchVideos', async () => {
    useLibraryStore.setState({ currentPage: 3 });

    await useLibraryStore.getState().setSearch('dog');

    const s = useLibraryStore.getState();
    expect(s.filterSearch).toBe('dog');
    expect(s.currentPage).toBe(1);
    expect(mockInvoke).toHaveBeenCalledWith('db_fetch_videos', expect.anything());
  });
});

describe('setCategoryFilter', () => {
  it('updates filterCategoryId and resets page', async () => {
    useLibraryStore.setState({ currentPage: 2 });

    await useLibraryStore.getState().setCategoryFilter(5);

    expect(useLibraryStore.getState().filterCategoryId).toBe(5);
    expect(useLibraryStore.getState().currentPage).toBe(1);
  });

  it('accepts null to clear the category filter', async () => {
    useLibraryStore.setState({ filterCategoryId: 5 });

    await useLibraryStore.getState().setCategoryFilter(null);

    expect(useLibraryStore.getState().filterCategoryId).toBeNull();
  });
});

describe('toggleTagFilter', () => {
  it('adds a tag when not currently filtered', async () => {
    useLibraryStore.setState({ filterTagIds: [1] });

    await useLibraryStore.getState().toggleTagFilter(2);

    expect(useLibraryStore.getState().filterTagIds).toEqual([1, 2]);
  });

  it('removes a tag that is already filtered', async () => {
    useLibraryStore.setState({ filterTagIds: [1, 2] });

    await useLibraryStore.getState().toggleTagFilter(1);

    expect(useLibraryStore.getState().filterTagIds).toEqual([2]);
  });
});

describe('clearTagFilters', () => {
  it('empties filterTagIds and resets page', async () => {
    useLibraryStore.setState({ filterTagIds: [1, 2, 3], currentPage: 4 });

    await useLibraryStore.getState().clearTagFilters();

    expect(useLibraryStore.getState().filterTagIds).toEqual([]);
    expect(useLibraryStore.getState().currentPage).toBe(1);
  });
});

describe('setTagMode', () => {
  it('switches to "or"', async () => {
    useLibraryStore.setState({ filterTagMode: 'and' });

    await useLibraryStore.getState().setTagMode('or');

    expect(useLibraryStore.getState().filterTagMode).toBe('or');
  });
});

describe('setSort', () => {
  it('updates both sortBy and sortOrder', async () => {
    await useLibraryStore.getState().setSort('rating', 'asc');

    const s = useLibraryStore.getState();
    expect(s.filterSortBy).toBe('rating');
    expect(s.filterSortOrder).toBe('asc');
    expect(s.currentPage).toBe(1);
  });
});

describe('setPage', () => {
  it('updates currentPage and fetches videos', async () => {
    // totalCount=300, pageSize=100 → maxPage=3 → page 3 is valid
    mockInvoke.mockResolvedValueOnce({ videos: [], totalCount: 300, videoTags: [] });

    await useLibraryStore.getState().setPage(3);

    expect(useLibraryStore.getState().currentPage).toBe(3);
    expect(mockInvoke).toHaveBeenCalledWith('db_fetch_videos', expect.anything());
  });
});

describe('setMinRating', () => {
  it('updates filterMinRating', async () => {
    await useLibraryStore.getState().setMinRating(4);
    expect(useLibraryStore.getState().filterMinRating).toBe(4);
  });
});

describe('setHasAudio', () => {
  it('sets filterHasAudio to 1', async () => {
    await useLibraryStore.getState().setHasAudio(1);
    expect(useLibraryStore.getState().filterHasAudio).toBe(1);
  });

  it('accepts null to clear the filter', async () => {
    useLibraryStore.setState({ filterHasAudio: 1 });
    await useLibraryStore.getState().setHasAudio(null);
    expect(useLibraryStore.getState().filterHasAudio).toBeNull();
  });
});

describe('setMinDuration / setMaxDuration', () => {
  it('updates filterMinDuration', async () => {
    await useLibraryStore.getState().setMinDuration(30);
    expect(useLibraryStore.getState().filterMinDuration).toBe(30);
  });

  it('updates filterMaxDuration', async () => {
    await useLibraryStore.getState().setMaxDuration(300);
    expect(useLibraryStore.getState().filterMaxDuration).toBe(300);
  });
});

describe('setWatchedStatus', () => {
  it('updates filterWatchedStatus', async () => {
    await useLibraryStore.getState().setWatchedStatus('watched');
    expect(useLibraryStore.getState().filterWatchedStatus).toBe('watched');
  });
});

describe('setWatchDirFilter', () => {
  it('updates filterWatchDir', async () => {
    await useLibraryStore.getState().setWatchDirFilter('/mnt/data');
    expect(useLibraryStore.getState().filterWatchDir).toBe('/mnt/data');
  });
});

describe('setMediaType', () => {
  it('updates filterMediaType', async () => {
    await useLibraryStore.getState().setMediaType('audio');
    expect(useLibraryStore.getState().filterMediaType).toBe('audio');
  });
});

// ── CRUD 操作 ──────────────────────────────────────────────────────────────────

describe('updateProgress', () => {
  it('calls db_update_progress and updates local state', async () => {
    const video = { id: 1, path: '/a.mp4', title: 'A', duration: 60, thumbnail: null,
      watched_at: null, progress: 0, rating: 0, category_id: null, has_audio: null,
      watch_count: 0, created_at: '2024-01-01', media_type: 'video' as const, source_url: null,
      status: null, source_type: null };
    useLibraryStore.setState({ videos: [video] });
    mockInvoke.mockResolvedValueOnce(undefined); // db_update_progress

    await useLibraryStore.getState().updateProgress(1, 42.5);

    expect(mockInvoke).toHaveBeenCalledWith('db_update_progress', { videoId: 1, progress: 42.5 });
    expect(useLibraryStore.getState().videos[0].progress).toBe(42.5);
  });
});

describe('incrementWatchCount', () => {
  it('calls db_increment_watch_count and increments local watch_count', async () => {
    const video = { id: 1, path: '/a.mp4', title: 'A', duration: 60, thumbnail: null,
      watched_at: null, progress: 0, rating: 0, category_id: null, has_audio: null,
      watch_count: 2, created_at: '2024-01-01', media_type: 'video' as const, source_url: null,
      status: null, source_type: null };
    useLibraryStore.setState({ videos: [video] });
    mockInvoke.mockResolvedValueOnce(undefined);

    await useLibraryStore.getState().incrementWatchCount(1);

    expect(mockInvoke).toHaveBeenCalledWith('db_increment_watch_count', { videoId: 1 });
    expect(useLibraryStore.getState().videos[0].watch_count).toBe(3);
  });
});

describe('updateVideo', () => {
  it('calls db_update_video and updates local state', async () => {
    const video = { id: 1, path: '/a.mp4', title: 'Old', duration: 60, thumbnail: null,
      watched_at: null, progress: 0, rating: 0, category_id: null, has_audio: null,
      watch_count: 0, created_at: '2024-01-01', media_type: 'video' as const, source_url: null,
      status: null, source_type: null };
    useLibraryStore.setState({ videos: [video] });
    mockInvoke.mockResolvedValueOnce(undefined);

    await useLibraryStore.getState().updateVideo(1, { title: 'New', rating: 5 });

    expect(mockInvoke).toHaveBeenCalledWith('db_update_video', expect.objectContaining({ videoId: 1, title: 'New', rating: 5 }));
    const updated = useLibraryStore.getState().videos[0];
    expect(updated.title).toBe('New');
    expect(updated.rating).toBe(5);
  });
});

describe('removeVideo', () => {
  it('calls db_remove_video and re-fetches videos', async () => {
    mockInvoke
      .mockResolvedValueOnce(undefined)       // db_remove_video
      .mockResolvedValueOnce(emptyVideosResult); // fetchVideos

    await useLibraryStore.getState().removeVideo(1);

    expect(mockInvoke).toHaveBeenCalledWith('db_remove_video', { videoId: 1 });
    expect(mockInvoke).toHaveBeenCalledWith('db_fetch_videos', expect.anything());
  });
});

describe('removeMultiple', () => {
  it('does nothing when given an empty array', async () => {
    await useLibraryStore.getState().removeMultiple([]);
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it('calls db_remove_multiple and re-fetches', async () => {
    mockInvoke
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(emptyVideosResult);

    await useLibraryStore.getState().removeMultiple([1, 2]);

    expect(mockInvoke).toHaveBeenCalledWith('db_remove_multiple', { videoIds: [1, 2] });
  });
});

// ── scanAndImport ─────────────────────────────────────────────────────────────

describe('scanAndImport', () => {
  it('sets isScanning to true during scan, false when done', async () => {
    let scanningDuring = false;
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'db_scan_and_import') {
        scanningDuring = useLibraryStore.getState().isScanning;
        return { newCount: 0, scannedCount: 0, errors: [], truncated: false, skippedCount: 0 };
      }
      if (cmd === 'canonicalize_path') return '/videos';
      if (cmd === 'db_fetch_videos') return emptyVideosResult;
      return undefined;
    });

    await useLibraryStore.getState().scanAndImport('/videos', false);

    expect(scanningDuring).toBe(true);
    expect(useLibraryStore.getState().isScanning).toBe(false);
  });

  it('adds canonicalized path to watchDirs', async () => {
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'canonicalize_path') return '/canonical/videos';
      if (cmd === 'db_scan_and_import') return { newCount: 1, scannedCount: 1, errors: [], truncated: false, skippedCount: 0 };
      if (cmd === 'db_fetch_videos') return emptyVideosResult;
      return undefined;
    });

    await useLibraryStore.getState().scanAndImport('/videos', false);

    expect(useLibraryStore.getState().watchDirs).toContain('/canonical/videos');
  });
});

// ── removeWatchDir ────────────────────────────────────────────────────────────

describe('removeWatchDir', () => {
  it('removes the path from watchDirs', async () => {
    useLibraryStore.setState({ watchDirs: ['/a', '/b'] });

    await useLibraryStore.getState().removeWatchDir('/a');

    expect(useLibraryStore.getState().watchDirs).toEqual(['/b']);
  });

  it('clears filterWatchDir if the removed dir was the active filter', async () => {
    useLibraryStore.setState({ watchDirs: ['/a'], filterWatchDir: '/a' });

    await useLibraryStore.getState().removeWatchDir('/a');

    expect(useLibraryStore.getState().filterWatchDir).toBeNull();
  });

  it('keeps filterWatchDir if a different dir is removed', async () => {
    useLibraryStore.setState({ watchDirs: ['/a', '/b'], filterWatchDir: '/b' });

    await useLibraryStore.getState().removeWatchDir('/a');

    expect(useLibraryStore.getState().filterWatchDir).toBe('/b');
  });
});

// ── pauseThumbnails / resumeThumbnails ─────────────────────────────────────────

describe('pauseThumbnails / resumeThumbnails', () => {
  it('sets isThumbnailPaused to true', () => {
    useLibraryStore.getState().pauseThumbnails();
    expect(useLibraryStore.getState().isThumbnailPaused).toBe(true);
  });

  it('sets isThumbnailPaused to false', () => {
    useLibraryStore.setState({ isThumbnailPaused: true });
    useLibraryStore.getState().resumeThumbnails();
    expect(useLibraryStore.getState().isThumbnailPaused).toBe(false);
  });
});

// ── updateVideoPath ───────────────────────────────────────────────────────────

describe('updateVideoPath', () => {
  it('calls db_update_video_path and re-fetches', async () => {
    mockInvoke
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(emptyVideosResult);

    await useLibraryStore.getState().updateVideoPath('/old.mp4', '/new.mp4');

    expect(mockInvoke).toHaveBeenCalledWith('db_update_video_path', { oldPath: '/old.mp4', newPath: '/new.mp4' });
  });
});
