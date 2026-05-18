import { create } from 'zustand';
import Database from '@tauri-apps/plugin-sql';
import { invoke } from '@tauri-apps/api/core';
import { appCacheDir, join } from '@tauri-apps/api/path';
import type { Video, ScannedFile } from '../types';
import { useSettingsStore } from './useSettingsStore';
import { useTagStore } from './useTagStore';
import { usePlaylistStore } from './usePlaylistStore';

export type SortBy = 'created_at' | 'duration' | 'rating';
export type SortOrder = 'desc' | 'asc';

interface LibraryState {
  videos: Video[];
  totalCount: number;
  currentPage: number;
  pageSize: number;
  filterSearch: string;
  filterCategoryId: number | null;
  filterTagIds: number[];
  filterSortBy: SortBy;
  filterSortOrder: SortOrder;
  watchDirs: string[];
  isScanning: boolean;
  isThumbnailGenerating: boolean;
  isThumbnailPaused: boolean;
  thumbnailProgress: { done: number; total: number } | null;
  isDbReady: boolean;
  dbError: string | null;
  db: Database | null;
}

interface LibraryActions {
  initDb: () => Promise<void>;
  fetchVideos: () => Promise<void>;
  setSearch: (search: string) => Promise<void>;
  setCategoryFilter: (id: number | null) => Promise<void>;
  toggleTagFilter: (tagId: number) => Promise<void>;
  clearTagFilters: () => Promise<void>;
  setSort: (sortBy: SortBy, sortOrder: SortOrder) => Promise<void>;
  setPage: (page: number) => Promise<void>;
  scanAndImport: (path: string) => Promise<void>;
  removeWatchDir: (path: string) => Promise<void>;
  generateThumbnails: () => Promise<void>;
  pauseThumbnails: () => void;
  resumeThumbnails: () => void;
  updateProgress: (videoId: number, progress: number) => Promise<void>;
  updateVideo: (videoId: number, updates: Partial<Pick<Video, 'title' | 'rating'>>) => Promise<void>;
  deleteVideo: (videoId: number) => Promise<void>;
  removeVideo: (videoId: number) => Promise<void>;
  removeMultiple: (videoIds: number[]) => Promise<void>;
  addVideoFromPath: (path: string, title: string) => Promise<number | null>;
  removeVideoByPath: (path: string) => Promise<void>;
}

const CREATE_VIDEOS_TABLE = `
  CREATE TABLE IF NOT EXISTS videos (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    path        TEXT NOT NULL UNIQUE,
    title       TEXT,
    duration    REAL,
    thumbnail   TEXT,
    watched_at  TEXT,
    progress    REAL DEFAULT 0,
    rating      INTEGER DEFAULT 0,
    created_at  TEXT DEFAULT CURRENT_TIMESTAMP
  )
`;

const CREATE_PLAYLISTS_TABLE = `
  CREATE TABLE IF NOT EXISTS playlists (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  )
`;

const CREATE_PLAYLIST_ITEMS_TABLE = `
  CREATE TABLE IF NOT EXISTS playlist_items (
    playlist_id INTEGER REFERENCES playlists(id),
    video_id    INTEGER REFERENCES videos(id),
    position    INTEGER,
    PRIMARY KEY (playlist_id, video_id)
  )
`;

const CREATE_TAGS_TABLE = `
  CREATE TABLE IF NOT EXISTS tags (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT NOT NULL UNIQUE,
    color      TEXT NOT NULL DEFAULT '#6366f1',
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  )
`;

const CREATE_VIDEO_TAGS_TABLE = `
  CREATE TABLE IF NOT EXISTS video_tags (
    video_id INTEGER NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
    tag_id   INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
    PRIMARY KEY (video_id, tag_id)
  )
`;

const CREATE_CATEGORIES_TABLE = `
  CREATE TABLE IF NOT EXISTS categories (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT NOT NULL UNIQUE,
    color      TEXT NOT NULL DEFAULT '#6366f1',
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  )
`;

const CREATE_TAG_CATEGORIES_TABLE = `
  CREATE TABLE IF NOT EXISTS tag_categories (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT NOT NULL UNIQUE,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  )
`;

const CREATE_WATCH_DIRS_TABLE = `
  CREATE TABLE IF NOT EXISTS watch_dirs (
    path       TEXT PRIMARY KEY,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  )
`;

let _thumbnailPaused = false;

const THUMBNAIL_CONCURRENCY = 3;

export const useLibraryStore = create<LibraryState & LibraryActions>((set, get) => ({
  videos: [],
  totalCount: 0,
  currentPage: 1,
  pageSize: 100,
  filterSearch: '',
  filterCategoryId: null,
  filterTagIds: [],
  filterSortBy: 'created_at',
  filterSortOrder: 'desc',
  watchDirs: [],
  isScanning: false,
  isThumbnailGenerating: false,
  isThumbnailPaused: false,
  thumbnailProgress: null,
  isDbReady: false,
  dbError: null,
  db: null,

  initDb: async () => {
    try {
      const db = await Database.load('sqlite:videos.db');
      await db.execute(CREATE_VIDEOS_TABLE);
      await db.execute(CREATE_PLAYLISTS_TABLE);
      await db.execute(CREATE_PLAYLIST_ITEMS_TABLE);
      await db.execute(CREATE_TAGS_TABLE);
      await db.execute(CREATE_VIDEO_TAGS_TABLE);
      await db.execute(CREATE_CATEGORIES_TABLE);
      await db.execute(CREATE_TAG_CATEGORIES_TABLE);
      try {
        await db.execute('ALTER TABLE videos ADD COLUMN category_id INTEGER REFERENCES categories(id)');
      } catch { /* already exists */ }
      try {
        await db.execute('ALTER TABLE tags ADD COLUMN tag_category_id INTEGER REFERENCES tag_categories(id)');
      } catch { /* already exists */ }
      set({ db, isDbReady: true });
      await useSettingsStore.getState().loadSettings(db);
      await get().fetchVideos();
      await useTagStore.getState().init(db);
      await usePlaylistStore.getState().init(db);
      await db.execute(CREATE_WATCH_DIRS_TABLE);
      const savedDirs = await db.select<{ path: string }[]>('SELECT path FROM watch_dirs');
      set({ watchDirs: savedDirs.map((d) => d.path) });
      for (const dir of savedDirs) {
        invoke('start_watching', { path: dir.path }).catch(() => {});
      }
      get().generateThumbnails().catch(() => {});
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error('initDb failed:', msg);
      set({ dbError: msg });
    }
  },

  fetchVideos: async () => {
    const { db, currentPage, pageSize, filterSearch, filterCategoryId, filterTagIds, filterSortBy, filterSortOrder } = get();
    if (!db) return;

    const conditions: string[] = [];
    const baseParams: unknown[] = [];

    if (filterSearch.trim()) {
      conditions.push('(v.title LIKE ? OR v.path LIKE ?)');
      const s = `%${filterSearch.trim()}%`;
      baseParams.push(s, s);
    }
    if (filterCategoryId !== null) {
      conditions.push('v.category_id = ?');
      baseParams.push(filterCategoryId);
    }
    if (filterTagIds.length > 0) {
      const ph = filterTagIds.map(() => '?').join(', ');
      conditions.push(`EXISTS (SELECT 1 FROM video_tags vt WHERE vt.video_id = v.id AND vt.tag_id IN (${ph}))`);
      baseParams.push(...filterTagIds);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const sortCol =
      filterSortBy === 'duration' ? 'COALESCE(v.duration, -1)' :
      filterSortBy === 'rating' ? 'v.rating' : 'v.created_at';
    const dir = filterSortOrder === 'desc' ? 'DESC' : 'ASC';

    const countResult = await db.select<{ total: number }[]>(
      `SELECT COUNT(*) as total FROM videos v ${where}`,
      baseParams
    );
    const totalCount = countResult[0]?.total ?? 0;

    const maxPage = Math.max(1, Math.ceil(totalCount / pageSize));
    const page = Math.min(currentPage, maxPage);

    const videos = await db.select<Video[]>(
      `SELECT v.* FROM videos v ${where} ORDER BY ${sortCol} ${dir} LIMIT ? OFFSET ?`,
      [...baseParams, pageSize, (page - 1) * pageSize]
    );

    set({ videos, totalCount, currentPage: page });

    const videoIds = videos.map((v) => v.id);
    await useTagStore.getState().fetchVideoTagsForIds(db, videoIds);
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

  setSort: async (sortBy: SortBy, sortOrder: SortOrder) => {
    set({ filterSortBy: sortBy, filterSortOrder: sortOrder, currentPage: 1 });
    await get().fetchVideos();
  },

  setPage: async (page: number) => {
    set({ currentPage: page });
    await get().fetchVideos();
  },

  scanAndImport: async (path: string) => {
    const { db } = get();
    if (!db) return;
    set({ isScanning: true });
    try {
      await db.execute('INSERT OR IGNORE INTO watch_dirs (path) VALUES (?)', [path]);
      set((state) => ({
        watchDirs: state.watchDirs.includes(path) ? state.watchDirs : [...state.watchDirs, path],
      }));
      invoke('start_watching', { path }).catch(() => {});
      const files = await invoke<ScannedFile[]>('scan_directory', { path });
      for (const file of files) {
        await db.execute(
          'INSERT OR IGNORE INTO videos (path, title) VALUES (?, ?)',
          [file.path, file.title]
        );
      }
      set({ currentPage: 1, isScanning: false });
      await get().fetchVideos();
    } finally {
      set({ isScanning: false });
    }
    get().generateThumbnails().catch(() => {});
  },

  removeWatchDir: async (path: string) => {
    const { db } = get();
    if (!db) return;
    await db.execute('DELETE FROM watch_dirs WHERE path = ?', [path]);
    await invoke('stop_watching', { path }).catch(() => {});
    set((state) => ({ watchDirs: state.watchDirs.filter((d) => d !== path) }));
  },

  pauseThumbnails: () => {
    _thumbnailPaused = true;
    set({ isThumbnailPaused: true });
  },

  resumeThumbnails: () => {
    _thumbnailPaused = false;
    set({ isThumbnailPaused: false });
  },

  generateThumbnails: async () => {
    if (get().isThumbnailGenerating) return;

    const { db } = get();
    if (!db) return;

    const cacheDir = await appCacheDir();
    const thumbDir = await join(cacheDir, 'thumbnails');

    // Query DB directly so all pages are covered, not just the current page
    const withoutThumb = await db.select<{ id: number; path: string }[]>(
      'SELECT id, path FROM videos WHERE thumbnail IS NULL'
    );
    if (withoutThumb.length === 0) return;

    _thumbnailPaused = false;
    set({ isThumbnailGenerating: true, isThumbnailPaused: false, thumbnailProgress: { done: 0, total: withoutThumb.length } });

    const processVideo = async (video: { id: number; path: string }) => {
      try {
        const hashBuffer = await crypto.subtle.digest(
          'SHA-256',
          new TextEncoder().encode(video.path)
        );
        const hash = Array.from(new Uint8Array(hashBuffer))
          .map((b) => b.toString(16).padStart(2, '0'))
          .join('');
        const outputPath = await join(thumbDir, hash.slice(0, 2), `${hash}.jpg`);

        const result = await invoke<{ thumbnail_path: string; duration: number | null }>(
          'generate_thumbnail',
          { videoPath: video.path, outputPath }
        );
        await db.execute(
          'UPDATE videos SET thumbnail = ?, duration = ? WHERE id = ?',
          [result.thumbnail_path, result.duration, video.id]
        );
        // Patch in-memory if the video is on the current page
        set((state) => ({
          videos: state.videos.map((v) =>
            v.id === video.id
              ? { ...v, thumbnail: result.thumbnail_path, duration: result.duration ?? v.duration }
              : v
          ),
        }));
      } catch (e) {
        console.warn(`Thumbnail generation failed for ${video.path}:`, e);
      }
      set((state) => ({
        thumbnailProgress: state.thumbnailProgress
          ? { ...state.thumbnailProgress, done: state.thumbnailProgress.done + 1 }
          : null,
      }));
    };

    try {
      for (let i = 0; i < withoutThumb.length; i += THUMBNAIL_CONCURRENCY) {
        while (_thumbnailPaused) {
          await new Promise<void>((resolve) => setTimeout(resolve, 200));
        }
        const batch = withoutThumb.slice(i, i + THUMBNAIL_CONCURRENCY);
        await Promise.all(batch.map(processVideo));
      }
    } finally {
      _thumbnailPaused = false;
      set({ isThumbnailGenerating: false, isThumbnailPaused: false, thumbnailProgress: null });
      await get().fetchVideos();
    }
  },

  updateProgress: async (videoId: number, progress: number) => {
    const { db } = get();
    if (!db) return;
    await db.execute(
      'UPDATE videos SET progress = ?, watched_at = CURRENT_TIMESTAMP WHERE id = ?',
      [progress, videoId]
    );
    set((state) => ({
      videos: state.videos.map((v) =>
        v.id === videoId ? { ...v, progress } : v
      ),
    }));
  },

  updateVideo: async (videoId: number, updates: Partial<Pick<Video, 'title' | 'rating'>>) => {
    const { db } = get();
    if (!db) return;
    const fields = Object.keys(updates) as (keyof typeof updates)[];
    if (fields.length === 0) return;
    const setClauses = fields.map((f) => `${f} = ?`).join(', ');
    await db.execute(
      `UPDATE videos SET ${setClauses} WHERE id = ?`,
      [...fields.map((f) => updates[f]), videoId]
    );
    set((state) => ({
      videos: state.videos.map((v) => v.id === videoId ? { ...v, ...updates } : v),
    }));
  },

  deleteVideo: async (videoId: number) => {
    const { db } = get();
    if (!db) return;
    await db.execute('DELETE FROM videos WHERE id = ?', [videoId]);
    await get().fetchVideos();
  },

  addVideoFromPath: async (path: string, title: string) => {
    const { db } = get();
    if (!db) return null;
    await db.execute(
      'INSERT OR IGNORE INTO videos (path, title) VALUES (?, ?)',
      [path, title]
    );
    const rows = await db.select<{ id: number }[]>('SELECT id FROM videos WHERE path = ?', [path]);
    const newId = rows[0]?.id ?? null;
    await get().fetchVideos();
    get().generateThumbnails().catch(() => {});
    return newId;
  },

  removeVideoByPath: async (path: string) => {
    const { db } = get();
    if (!db) return;
    const rows = await db.select<{ id: number }[]>('SELECT id FROM videos WHERE path = ?', [path]);
    if (rows.length === 0) return;
    await get().removeVideo(rows[0].id);
  },

  removeVideo: async (videoId: number) => {
    const { db } = get();
    if (!db) return;
    await db.execute('DELETE FROM playlist_items WHERE video_id = ?', [videoId]);
    await db.execute('DELETE FROM video_tags WHERE video_id = ?', [videoId]);
    await db.execute('DELETE FROM videos WHERE id = ?', [videoId]);
    await get().fetchVideos();
  },

  removeMultiple: async (videoIds: number[]) => {
    const { db } = get();
    if (!db || videoIds.length === 0) return;
    for (const videoId of videoIds) {
      await db.execute('DELETE FROM playlist_items WHERE video_id = ?', [videoId]);
      await db.execute('DELETE FROM video_tags WHERE video_id = ?', [videoId]);
      await db.execute('DELETE FROM videos WHERE id = ?', [videoId]);
    }
    await get().fetchVideos();
  },
}));
