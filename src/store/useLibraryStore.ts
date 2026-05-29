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
export type WatchedStatus = 'all' | 'watched' | 'unwatched';

interface LibraryState {
  videos: Video[];
  totalCount: number;
  currentPage: number;
  pageSize: number;
  filterSearch: string;
  filterCategoryId: number | null;
  filterTagIds: number[];
  filterMinRating: number;
  filterHasAudio: number | null;
  filterMinDuration: number;
  filterWatchedStatus: WatchedStatus;
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
  incrementWatchCount: (videoId: number) => Promise<void>;
  fetchVideos: () => Promise<void>;
  fetchAllForShuffle: () => Promise<Video[]>;
  setSearch: (search: string) => Promise<void>;
  setCategoryFilter: (id: number | null) => Promise<void>;
  toggleTagFilter: (tagId: number) => Promise<void>;
  clearTagFilters: () => Promise<void>;
  setMinRating: (rating: number) => Promise<void>;
  setHasAudio: (hasAudio: number | null) => Promise<void>;
  setMinDuration: (seconds: number) => Promise<void>;
  setWatchedStatus: (status: WatchedStatus) => Promise<void>;
  setSort: (sortBy: SortBy, sortOrder: SortOrder) => Promise<void>;
  setPage: (page: number) => Promise<void>;
  scanAndImport: (path: string, useDirectoryAsCategory?: boolean) => Promise<void>;
  removeWatchDir: (path: string) => Promise<void>;
  generateThumbnails: () => Promise<void>;
  pauseThumbnails: () => void;
  resumeThumbnails: () => void;
  updateProgress: (videoId: number, progress: number) => Promise<void>;
  updateVideo: (videoId: number, updates: Partial<Pick<Video, 'title' | 'rating'>>) => Promise<void>;
  deleteVideo: (videoId: number) => Promise<void>;
  removeVideo: (videoId: number) => Promise<void>;
  removeMultiple: (videoIds: number[]) => Promise<void>;
  assignCategoryFromPath: (videoIds: number[]) => Promise<void>;
  addVideoFromPath: (path: string, title: string) => Promise<number | null>;
  removeVideoByPath: (path: string) => Promise<void>;
  moveVideoFile: (videoId: number, destDir: string) => Promise<string | null>;
  renameVideoFile: (videoId: number, newPath: string) => Promise<void>;
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

const CREATE_SMART_PLAYLISTS_TABLE = `
  CREATE TABLE IF NOT EXISTS smart_playlists (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT NOT NULL,
    filter_json TEXT NOT NULL,
    created_at  TEXT DEFAULT CURRENT_TIMESTAMP
  )
`;

type FilterState = Pick<LibraryState,
  'filterSearch' | 'filterCategoryId' | 'filterTagIds' |
  'filterMinRating' | 'filterHasAudio' | 'filterMinDuration' | 'filterWatchedStatus'
>;

function buildWhereClause(f: FilterState): { where: string; params: unknown[] } {
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (f.filterSearch.trim()) {
    conditions.push('(v.title LIKE ? OR v.path LIKE ?)');
    const s = `%${f.filterSearch.trim()}%`;
    params.push(s, s);
  }
  if (f.filterCategoryId !== null) {
    if (f.filterCategoryId === -1) {
      conditions.push('v.category_id IS NULL');
    } else {
      conditions.push('v.category_id = ?');
      params.push(f.filterCategoryId);
    }
  }
  if (f.filterTagIds.length > 0) {
    const ph = f.filterTagIds.map(() => '?').join(', ');
    // 相関サブクエリを非相関サブクエリ (GROUP BY + HAVING) に変更
    conditions.push(
      `v.id IN (SELECT vt.video_id FROM video_tags vt WHERE vt.tag_id IN (${ph}) GROUP BY vt.video_id HAVING COUNT(*) = ?)`
    );
    params.push(...f.filterTagIds);
    params.push(f.filterTagIds.length);
  }
  if (f.filterMinRating > 0) {
    conditions.push('v.rating >= ?');
    params.push(f.filterMinRating);
  }
  if (f.filterHasAudio !== null) {
    conditions.push('v.has_audio = ?');
    params.push(f.filterHasAudio);
  }
  if (f.filterMinDuration > 0) {
    conditions.push('v.duration >= ?');
    params.push(f.filterMinDuration);
  }
  if (f.filterWatchedStatus === 'unwatched') {
    conditions.push('v.watched_at IS NULL');
  } else if (f.filterWatchedStatus === 'watched') {
    conditions.push('v.watched_at IS NOT NULL');
  }

  return {
    where: conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '',
    params,
  };
}

// デバウンスタイマー: setSearch が連続呼び出しされたとき最後の呼び出しだけ fetchVideos を実行する


const THUMBNAIL_CONCURRENCY = 3;

export const useLibraryStore = create<LibraryState & LibraryActions>((set, get) => ({
  videos: [],
  totalCount: 0,
  currentPage: 1,
  pageSize: 100,
  filterSearch: '',
  filterCategoryId: null,
  filterTagIds: [],
  filterMinRating: 0,
  filterHasAudio: null,
  filterMinDuration: 0,
  filterWatchedStatus: 'all',
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
      try {
        await db.execute('ALTER TABLE videos ADD COLUMN has_audio INTEGER');
      } catch { /* already exists */ }
      try {
        await db.execute('ALTER TABLE videos ADD COLUMN watch_count INTEGER DEFAULT 0');
      } catch { /* already exists */ }
      // パフォーマンス最適化: よく使うフィルター/ソートカラムにインデックスを作成
      await db.execute('CREATE INDEX IF NOT EXISTS idx_videos_created_at ON videos(created_at)');
      await db.execute('CREATE INDEX IF NOT EXISTS idx_videos_rating ON videos(rating)');
      await db.execute('CREATE INDEX IF NOT EXISTS idx_videos_duration ON videos(duration)');
      await db.execute('CREATE INDEX IF NOT EXISTS idx_videos_category_id ON videos(category_id)');
      await db.execute('CREATE INDEX IF NOT EXISTS idx_videos_watched_at ON videos(watched_at)');
      await db.execute('CREATE INDEX IF NOT EXISTS idx_video_tags_tag_id ON video_tags(tag_id)');
      await db.execute('CREATE INDEX IF NOT EXISTS idx_video_tags_video_id ON video_tags(video_id)');
      set({ db, isDbReady: true });
      await useSettingsStore.getState().loadSettings(db);
      await get().fetchVideos();
      await useTagStore.getState().init(db);
      await usePlaylistStore.getState().init(db);
      await db.execute(CREATE_WATCH_DIRS_TABLE);
      await db.execute(CREATE_SMART_PLAYLISTS_TABLE);
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
    const { db, currentPage, pageSize, filterSortBy, filterSortOrder } = get();
    if (!db) return;

    const { where, params: baseParams } = buildWhereClause(get());
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

  fetchAllForShuffle: async () => {
    const { db, filterSortBy, filterSortOrder } = get();
    if (!db) return [];

    const { where, params: baseParams } = buildWhereClause(get());
    const sortCol =
      filterSortBy === 'duration' ? 'COALESCE(v.duration, -1)' :
      filterSortBy === 'rating' ? 'v.rating' : 'v.created_at';
    const dir = filterSortOrder === 'desc' ? 'DESC' : 'ASC';

    return db.select<Video[]>(
      `SELECT v.* FROM videos v ${where} ORDER BY ${sortCol} ${dir}`,
      baseParams
    );
  },

  setSearch: async (search: string) => {
    set({ filterSearch: search, currentPage: 1 });
    // App.tsx 側で 500ms デバウンス済みのため、ストアでは即座に DB クエリを実行する
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

  setWatchedStatus: async (status: WatchedStatus) => {
    set({ filterWatchedStatus: status, currentPage: 1 });
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

      const categoryIdMap: Record<string, number> = {};
      if (useDirectoryAsCategory) {
        const uniqueDirNames = [...new Set(files.map((f) => f.parent_dir_name).filter((n): n is string => n != null))];
        await db.execute('BEGIN');
        try {
          for (const name of uniqueDirNames) {
            await db.execute('INSERT OR IGNORE INTO categories (name, color) VALUES (?, ?)', [name, '#6366f1']);
          }
          await db.execute('COMMIT');
        } catch (e) {
          await db.execute('ROLLBACK');
          throw e;
        }
        for (const name of uniqueDirNames) {
          const rows = await db.select<{ id: number }[]>('SELECT id FROM categories WHERE name = ?', [name]);
          if (rows[0]) categoryIdMap[name] = rows[0].id;
        }
        if (uniqueDirNames.length > 0) {
          await useTagStore.getState().init(db);
        }
      }

      await db.execute('BEGIN');
      try {
        for (const file of files) {
          const categoryId = useDirectoryAsCategory && file.parent_dir_name != null
            ? (categoryIdMap[file.parent_dir_name] ?? null)
            : null;
          await db.execute(
            'INSERT OR IGNORE INTO videos (path, title, category_id) VALUES (?, ?, ?)',
            [file.path, file.title, categoryId]
          );
        }
        await db.execute('COMMIT');
      } catch (e) {
        await db.execute('ROLLBACK');
        throw e;
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
    set({ isThumbnailPaused: true });
  },

  resumeThumbnails: () => {
    set({ isThumbnailPaused: false });
  },

  generateThumbnails: async () => {
    if (get().isThumbnailGenerating) return;

    const { db } = get();
    if (!db) return;

    const cacheDir = await appCacheDir();
    const thumbDir = await join(cacheDir, 'thumbnails');

    // ペンディング件数が多い場合でもメモリを大量消費しないよう 500 件ずつ処理する
    const PENDING_BATCH_SIZE = 500;
    const pending = await db.select<{ id: number; path: string; thumbnail: string | null }[]>(
      'SELECT id, path, thumbnail FROM videos WHERE thumbnail IS NULL OR has_audio IS NULL LIMIT ?',
      [PENDING_BATCH_SIZE]
    );
    if (pending.length === 0) return;

    set({ isThumbnailGenerating: true, isThumbnailPaused: false, thumbnailProgress: { done: 0, total: pending.length } });

    type VideoUpdate = { id: number; thumbnail?: string; duration?: number | null; has_audio: number };

    const processVideoData = async (video: { id: number; path: string; thumbnail: string | null }): Promise<VideoUpdate | null> => {
      try {
        if (!video.thumbnail) {
          const hashBuffer = await crypto.subtle.digest(
            'SHA-256',
            new TextEncoder().encode(video.path)
          );
          const hash = Array.from(new Uint8Array(hashBuffer))
            .map((b) => b.toString(16).padStart(2, '0'))
            .join('');
          const outputPath = await join(thumbDir, hash.slice(0, 2), `${hash}.jpg`);

          const result = await invoke<{ thumbnail_path: string; duration: number | null; has_audio: boolean }>(
            'generate_thumbnail',
            { videoPath: video.path, outputPath }
          );
          const hasAudio = result.has_audio ? 1 : 0;
          await db.execute(
            'UPDATE videos SET thumbnail = ?, duration = ?, has_audio = ? WHERE id = ?',
            [result.thumbnail_path, result.duration, hasAudio, video.id]
          );
          return { id: video.id, thumbnail: result.thumbnail_path, duration: result.duration, has_audio: hasAudio };
        } else {
          // サムネイルはあるが音声情報が未取得の動画
          const hasAudioRaw = await invoke<boolean>('check_has_audio', { videoPath: video.path });
          const hasAudio = hasAudioRaw ? 1 : 0;
          await db.execute('UPDATE videos SET has_audio = ? WHERE id = ?', [hasAudio, video.id]);
          return { id: video.id, has_audio: hasAudio };
        }
      } catch (e) {
        console.warn(`Audio/thumbnail processing failed for ${video.path}:`, e);
        return null;
      }
    };

    try {
      let doneCount = 0;
      for (let i = 0; i < pending.length; i += THUMBNAIL_CONCURRENCY) {
        // ストアの isThumbnailPaused を参照 (モジュール変数を排除)
        while (get().isThumbnailPaused) {
          await new Promise<void>((resolve) => setTimeout(resolve, 200));
        }
        const batch = pending.slice(i, i + THUMBNAIL_CONCURRENCY);
        const results = await Promise.all(batch.map(processVideoData));
        doneCount += batch.length;

        // バッチ完了後に一括 set（動画更新 + 進捗を1回の state 更新で処理）
        const updateMap = new Map(
          results
            .filter((r): r is VideoUpdate => r !== null)
            .map((r) => [r.id, r])
        );
        set((state) => ({
          videos: state.videos.map((v) => {
            const upd = updateMap.get(v.id);
            return upd ? { ...v, ...upd } : v;
          }),
          thumbnailProgress: { done: doneCount, total: pending.length },
        }));
      }
    } finally {
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

  assignCategoryFromPath: async (videoIds: number[]) => {
    const { db, watchDirs } = get();
    if (!db || videoIds.length === 0) return;

    const ph = videoIds.map(() => '?').join(', ');
    const rows = await db.select<{ id: number; path: string }[]>(
      `SELECT id, path FROM videos WHERE id IN (${ph})`,
      videoIds
    );

    const normalizeDir = (p: string) => p.replace(/\\/g, '/').replace(/\/$/, '');
    const rootDirs = new Set(watchDirs.map(normalizeDir));

    const getParentDirName = (filePath: string): string | null => {
      const parts = filePath.replace(/\\/g, '/').split('/');
      parts.pop();
      const parentPath = parts.join('/');
      if (rootDirs.has(parentPath)) return null;
      return parts[parts.length - 1] || null;
    };

    const uniqueDirNames = [...new Set(
      rows.map((r) => getParentDirName(r.path)).filter((n): n is string => n != null)
    )];

    if (uniqueDirNames.length === 0) {
      await get().fetchVideos();
      return;
    }

    // バッチ INSERT: N 回の個別 INSERT を 1 回にまとめる
    const insertPh = uniqueDirNames.map(() => '(?, ?)').join(', ');
    const insertParams: unknown[] = [];
    for (const name of uniqueDirNames) insertParams.push(name, '#6366f1');
    await db.execute(
      `INSERT OR IGNORE INTO categories (name, color) VALUES ${insertPh}`,
      insertParams
    );

    // バッチ SELECT: N 回の個別 SELECT を 1 回にまとめる
    const selectPh = uniqueDirNames.map(() => '?').join(', ');
    const catRows = await db.select<{ id: number; name: string }[]>(
      `SELECT id, name FROM categories WHERE name IN (${selectPh})`,
      uniqueDirNames
    );
    const categoryIdMap: Record<string, number> = {};
    for (const row of catRows) categoryIdMap[row.name] = row.id;

    // 動画の category_id を一括更新 (トランザクションでバッチ化)
    await db.execute('BEGIN');
    try {
      for (const row of rows) {
        const dirName = getParentDirName(row.path);
        if (dirName && categoryIdMap[dirName] != null) {
          await db.execute('UPDATE videos SET category_id = ? WHERE id = ?', [categoryIdMap[dirName], row.id]);
        }
      }
      await db.execute('COMMIT');
    } catch (e) {
      await db.execute('ROLLBACK');
      throw e;
    }

    await useTagStore.getState().init(db);
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
    // N+1 クエリを避けるため IN (...) でバッチ削除
    const ph = videoIds.map(() => '?').join(', ');
    await db.execute(`DELETE FROM playlist_items WHERE video_id IN (${ph})`, videoIds);
    await db.execute(`DELETE FROM video_tags WHERE video_id IN (${ph})`, videoIds);
    await db.execute(`DELETE FROM videos WHERE id IN (${ph})`, videoIds);
    await get().fetchVideos();
  },

  incrementWatchCount: async (videoId: number) => {
    const { db } = get();
    if (!db) return;
    await db.execute('UPDATE videos SET watch_count = COALESCE(watch_count, 0) + 1 WHERE id = ?', [videoId]);
    set((state) => ({
      videos: state.videos.map((v) =>
        v.id === videoId ? { ...v, watch_count: (v.watch_count ?? 0) + 1 } : v
      ),
    }));
  },

  moveVideoFile: async (videoId: number, destDir: string) => {
    const { db, videos } = get();
    if (!db) return null;
    const video = videos.find((v) => v.id === videoId);
    if (!video) return null;
    try {
      const newPath = await invoke<string>('move_video_file', {
        sourcePath: video.path,
        destDir,
      });
      await db.execute('UPDATE videos SET path = ? WHERE id = ?', [newPath, videoId]);
      set((state) => ({
        videos: state.videos.map((v) => v.id === videoId ? { ...v, path: newPath } : v),
      }));
      return newPath;
    } catch (e) {
      console.error('Failed to move video file:', e);
      return null;
    }
  },
  renameVideoFile: async (videoId: number, newPath: string) => {
    const { db } = get();
    if (!db) return;
    await db.execute('UPDATE videos SET path = ? WHERE id = ?', [newPath, videoId]);
    set((state) => ({
      videos: state.videos.map((v) => v.id === videoId ? { ...v, path: newPath } : v),
    }));
  },
}));
