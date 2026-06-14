import { create } from 'zustand';
import Database from '@tauri-apps/plugin-sql';
import { invoke } from '@tauri-apps/api/core';
import { appCacheDir, join } from '@tauri-apps/api/path';
import type { Video, ScannedFile } from '../types';
import { useSettingsStore } from './useSettingsStore';
import { useTagStore, getCategoryDescendantIds } from './useTagStore';
import { usePlaylistStore } from './usePlaylistStore';
import { useToastStore } from './useToastStore';

export type SortBy = 'created_at' | 'duration' | 'rating';
export type SortOrder = 'desc' | 'asc';
export type WatchedStatus = 'all' | 'watched' | 'unwatched';
export type TagFilterMode = 'and' | 'or';
export type MediaTypeFilter = 'all' | 'video' | 'audio' | 'image';

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
  setTagMode: (mode: TagFilterMode) => Promise<void>;
  setMinRating: (rating: number) => Promise<void>;
  setHasAudio: (hasAudio: number | null) => Promise<void>;
  setMinDuration: (seconds: number) => Promise<void>;
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
  addVideoFromPath: (path: string, title: string, sourceUrl?: string) => Promise<number | null>;
  removeVideoByPath: (path: string) => Promise<void>;
  batchWatcherUpdate: (batch: { creates: { path: string; title: string }[]; removes: string[]; renames: { old_path: string; new_path: string; title: string }[] }) => Promise<void>;
  moveVideoFile: (videoId: number, destDir: string) => Promise<string | null>;
  renameVideoFile: (videoId: number, newPath: string) => Promise<void>;
  updateVideoPath: (oldPath: string, newPath: string) => Promise<void>;
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
    created_at  TEXT DEFAULT CURRENT_TIMESTAMP,
    media_type  TEXT DEFAULT 'video',
    source_url  TEXT
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
    name       TEXT NOT NULL,
    color      TEXT NOT NULL DEFAULT '#6366f1',
    parent_id  INTEGER REFERENCES categories(id),
    icon       TEXT DEFAULT NULL,
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
    path                TEXT PRIMARY KEY,
    created_at          TEXT DEFAULT CURRENT_TIMESTAMP,
    use_dir_as_category INTEGER DEFAULT 0
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
  'filterSearch' | 'filterCategoryId' | 'filterTagIds' | 'filterTagMode' |
  'filterMinRating' | 'filterHasAudio' | 'filterMinDuration' | 'filterWatchedStatus' | 'filterWatchDir' | 'filterMediaType'
>;

// SQLite LIKE パターン内の特殊文字 (%, _, !) をエスケープする。
// ESCAPE '!' を使用: !% → 実リテラル%, !_ → 実リテラル_, !! → 実リテラル!
function escapeLikeDir(dir: string): string {
  return dir
    .replace(/\\/g, '/')
    .replace(/\/$/, '')
    .replace(/!/g, '!!')
    .replace(/%/g, '!%')
    .replace(/_/g, '!_');
}

function buildWhereClause(f: FilterState, categories: import('../types').Category[]): { where: string; params: unknown[] } {
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
      const ids = getCategoryDescendantIds(f.filterCategoryId, categories);
      const ph = ids.map(() => '?').join(', ');
      conditions.push(`v.category_id IN (${ph})`);
      params.push(...ids);
    }
  }
  if (f.filterTagIds.length > 0) {
    const ph = f.filterTagIds.map(() => '?').join(', ');
    if (f.filterTagMode === 'or') {
      conditions.push(
        `v.id IN (SELECT vt.video_id FROM video_tags vt WHERE vt.tag_id IN (${ph}))`
      );
      params.push(...f.filterTagIds);
    } else {
      conditions.push(
        `v.id IN (SELECT vt.video_id FROM video_tags vt WHERE vt.tag_id IN (${ph}) GROUP BY vt.video_id HAVING COUNT(*) = ?)`
      );
      params.push(...f.filterTagIds);
      params.push(f.filterTagIds.length);
    }
  }
  if (f.filterMinRating === -1) {
    conditions.push('(v.rating = 0 OR v.rating IS NULL)');
  } else if (f.filterMinRating > 0) {
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
  if (f.filterWatchDir !== null) {
    conditions.push("REPLACE(v.path, '\\', '/') LIKE ? ESCAPE '!'");
    params.push(`${escapeLikeDir(f.filterWatchDir)}/%`);
  }
  if (f.filterMediaType !== 'all') {
    conditions.push('v.media_type = ?');
    params.push(f.filterMediaType);
  }

  return {
    where: conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '',
    params,
  };
}

// デバウンスタイマー: setSearch が連続呼び出しされたとき最後の呼び出しだけ fetchVideos を実行する


const THUMBNAIL_CONCURRENCY = 3;

/**
 * ファイルパスの親ディレクトリがrootDir配下にある場合、相対ディレクトリパスを返す。
 * - ルート直下: null
 * - サブディレクトリ配下: "Movies/Action" 形式の文字列
 * - rootDir配下でない: undefined
 */
function getRelativeDirPath(filePath: string, rootDir: string): string | null | undefined {
  const normFile = filePath.replace(/\\/g, '/');
  const normRoot = rootDir.replace(/\\/g, '/').replace(/\/$/, '');
  const dir = normFile.substring(0, normFile.lastIndexOf('/'));
  if (dir === normRoot) return null;
  if (dir.startsWith(normRoot + '/')) return dir.slice(normRoot.length + 1);
  return undefined;
}

/**
 * "Movies/Action" のような相対ディレクトリパスからカテゴリ階層を再帰的に作成し、
 * 末端カテゴリのIDを返す。既存カテゴリは (name, parent_id) で照合して再利用する。
 */
// cache: "parentId/name" → categoryId。呼び出し元で共有して同じノードのDB再クエリを防ぐ。
async function buildCategoryHierarchy(
  db: Database,
  relDirPath: string,
  cache: Map<string, number>,
  color = '#6366f1',
): Promise<number | null> {
  const segments = relDirPath.split('/').filter(Boolean);
  if (segments.length === 0) return null;
  let parentId: number | null = null;
  let leafId: number | null = null;
  for (const name of segments) {
    const cacheKey = `${parentId ?? ''}/${name}`;
    const cached = cache.get(cacheKey);
    if (cached !== undefined) {
      leafId = cached;
    } else {
      const existing: { id: number }[] = parentId == null
        ? await db.select<{ id: number }[]>(
            'SELECT id FROM categories WHERE name = ? AND parent_id IS NULL', [name])
        : await db.select<{ id: number }[]>(
            'SELECT id FROM categories WHERE name = ? AND parent_id = ?', [name, parentId]);
      if (existing[0]) {
        leafId = existing[0].id;
      } else {
        const result = await db.execute(
          'INSERT INTO categories (name, color, icon, parent_id) VALUES (?, ?, ?, ?)',
          [name, color, 'folder', parentId],
        );
        leafId = result.lastInsertId ?? null;
      }
      if (leafId != null) cache.set(cacheKey, leafId);
    }
    parentId = leafId;
  }
  return leafId;
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
  db: null,

  initDb: async () => {
    try {
      const db = await Database.load('sqlite:videos.db');
      // WAL モードで読み書き同時進行を許可し、バックグラウンド処理中の書き込み競合を緩和する
      await db.execute('PRAGMA journal_mode=WAL');
      // ロック競合時に即失敗せず最大5秒リトライする
      await db.execute('PRAGMA busy_timeout=5000');
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
      try {
        await db.execute("ALTER TABLE videos ADD COLUMN media_type TEXT DEFAULT 'video'");
      } catch { /* already exists */ }
      try {
        await db.execute('ALTER TABLE videos ADD COLUMN source_url TEXT');
      } catch { /* already exists */ }
      try {
        await db.execute('ALTER TABLE categories ADD COLUMN parent_id INTEGER REFERENCES categories(id)');
      } catch { /* already exists */ }
      try {
        await db.execute('ALTER TABLE categories ADD COLUMN icon TEXT DEFAULT NULL');
      } catch { /* already exists */ }
      try {
        await db.execute('ALTER TABLE tags ADD COLUMN icon TEXT DEFAULT NULL');
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
      // 既存行の media_type を拡張子から修正 (settings テーブル作成後に一度だけ実行)
      const migrated = await db.select<{ value: string }[]>(
        "SELECT value FROM settings WHERE key = 'migration_media_type_fix'"
      );
      if (!migrated[0] || migrated[0].value !== '1') {
        await db.execute(
          `UPDATE videos SET media_type = 'image' WHERE media_type = 'video' AND (` +
          `LOWER(path) LIKE '%.jpg' OR LOWER(path) LIKE '%.jpeg' OR LOWER(path) LIKE '%.png' OR ` +
          `LOWER(path) LIKE '%.gif' OR LOWER(path) LIKE '%.webp' OR LOWER(path) LIKE '%.bmp' OR ` +
          `LOWER(path) LIKE '%.tiff' OR LOWER(path) LIKE '%.heic' OR LOWER(path) LIKE '%.avif')`
        );
        await db.execute(
          `UPDATE videos SET media_type = 'audio' WHERE media_type = 'video' AND (` +
          `LOWER(path) LIKE '%.mp3' OR LOWER(path) LIKE '%.flac' OR LOWER(path) LIKE '%.aac' OR ` +
          `LOWER(path) LIKE '%.wav' OR LOWER(path) LIKE '%.ogg' OR LOWER(path) LIKE '%.opus' OR ` +
          `LOWER(path) LIKE '%.m4a' OR LOWER(path) LIKE '%.wma')`
        );
        await db.execute(
          "INSERT OR REPLACE INTO settings (key, value) VALUES ('migration_media_type_fix', '1')"
        );
      }
      // Migration: categories.name の UNIQUE 制約を (name, parent_id) のペア単位に変更し、
      // 同じ名前でも異なる親を持つカテゴリを作成できるようにする
      const catMigrated = await db.select<{ value: string }[]>(
        "SELECT value FROM settings WHERE key = 'migration_categories_perparent_unique'"
      );
      if (!catMigrated[0] || catMigrated[0].value !== '1') {
        try {
          await db.execute('BEGIN');
          await db.execute(`CREATE TABLE categories_new (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            name       TEXT NOT NULL,
            color      TEXT NOT NULL DEFAULT '#6366f1',
            parent_id  INTEGER REFERENCES categories_new(id),
            icon       TEXT DEFAULT NULL,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
          )`);
          await db.execute('INSERT INTO categories_new SELECT id, name, color, parent_id, icon, created_at FROM categories');
          await db.execute('DROP TABLE categories');
          await db.execute('ALTER TABLE categories_new RENAME TO categories');
          await db.execute("INSERT OR REPLACE INTO settings (key, value) VALUES ('migration_categories_perparent_unique', '1')");
          await db.execute('COMMIT');
        } catch {
          await db.execute('ROLLBACK');
        }
      }
      // ルート直下: name の一意性、子カテゴリ: (name, parent_id) の一意性を保証する
      await db.execute('CREATE UNIQUE INDEX IF NOT EXISTS idx_categories_unique_root ON categories(name) WHERE parent_id IS NULL');
      await db.execute('CREATE UNIQUE INDEX IF NOT EXISTS idx_categories_unique_child ON categories(name, parent_id) WHERE parent_id IS NOT NULL');
      // Migration: 画像のサムネイルをフルサイズパスからリサイズ済みキャッシュに切り替えるためリセット
      const imgThumbMigrated = await db.select<{ value: string }[]>(
        "SELECT value FROM settings WHERE key = 'migration_image_thumbnail_reset'"
      );
      if (!imgThumbMigrated[0] || imgThumbMigrated[0].value !== '1') {
        await db.execute(
          "UPDATE videos SET thumbnail = NULL WHERE media_type = 'image' AND thumbnail = path"
        );
        await db.execute(
          "INSERT OR REPLACE INTO settings (key, value) VALUES ('migration_image_thumbnail_reset', '1')"
        );
      }
      await get().fetchVideos();
      await useTagStore.getState().init(db);
      await usePlaylistStore.getState().init(db);
      await db.execute(CREATE_WATCH_DIRS_TABLE);
      await db.execute(CREATE_SMART_PLAYLISTS_TABLE);
      try {
        await db.execute('ALTER TABLE watch_dirs ADD COLUMN use_dir_as_category INTEGER DEFAULT 0');
      } catch { /* already exists */ }
      const savedDirs = await db.select<{ path: string }[]>('SELECT path FROM watch_dirs');
      // 既存エントリを正規化パスに移行 (シンボリックリンク不一致の対処)
      const canonicalDirs: string[] = [];
      for (const d of savedDirs) {
        const canonical = await invoke<string>('canonicalize_path', { path: d.path }).catch(() => d.path);
        if (canonical !== d.path) {
          await db.execute('UPDATE watch_dirs SET path = ? WHERE path = ?', [canonical, d.path]);
        }
        canonicalDirs.push(canonical);
      }
      set({ watchDirs: canonicalDirs });
      for (const dir of canonicalDirs) {
        invoke('start_watching', { path: dir }).catch(() => {});
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

    const { where, params: baseParams } = buildWhereClause(get(), useTagStore.getState().categories);
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

    const { where, params: baseParams } = buildWhereClause(get(), useTagStore.getState().categories);
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
    const { db } = get();
    if (!db) return;
    set({ isScanning: true });
    try {
      // シンボリックリンクを解決した正規パスで保存 (LIKE マッチングの精度向上)
      const canonicalPath = await invoke<string>('canonicalize_path', { path }).catch(() => path);
      await db.execute(
        'INSERT OR REPLACE INTO watch_dirs (path, use_dir_as_category) VALUES (?, ?)',
        [canonicalPath, useDirectoryAsCategory ? 1 : 0]
      );
      set((state) => ({
        watchDirs: state.watchDirs.includes(canonicalPath)
          ? state.watchDirs
          : [...state.watchDirs, canonicalPath],
      }));
      invoke('start_watching', { path: canonicalPath }).catch(() => {});
      const files = await invoke<ScannedFile[]>('scan_directory', { path: canonicalPath });

      const categoryIdMap: Record<string, number> = {};
      if (useDirectoryAsCategory) {
        // ユニークな相対ディレクトリパスを収集し、深さ昇順で親→子の順に作成
        const relPaths = [...new Set(
          files
            .map((f) => getRelativeDirPath(f.path, canonicalPath))
            .filter((p): p is string => p != null && p !== undefined),
        )];
        if (relPaths.length > 0) {
          relPaths.sort((a, b) => a.split('/').length - b.split('/').length);
          const catCache = new Map<string, number>();
          for (const relPath of relPaths) {
            const leafId = await buildCategoryHierarchy(db, relPath, catCache);
            if (leafId != null) categoryIdMap[relPath] = leafId;
          }
          await useTagStore.getState().init(db);
        }
      }

      // SQLite パラメータ上限 (999) に収まる最大バッチサイズ (4列: path, title, category_id, media_type)
      const INSERT_BATCH_4 = 249;
      await db.execute('BEGIN');
      try {
        for (let i = 0; i < files.length; i += INSERT_BATCH_4) {
          const batch = files.slice(i, i + INSERT_BATCH_4);
          const ph = batch.map(() => '(?, ?, ?, ?)').join(', ');
          const params: unknown[] = [];
          for (const file of batch) {
            const relPath = useDirectoryAsCategory
              ? getRelativeDirPath(file.path, canonicalPath)
              : undefined;
            const categoryId = relPath ? (categoryIdMap[relPath] ?? null) : null;
            params.push(file.path, file.title, categoryId, file.media_type ?? 'video');
          }
          await db.execute(
            `INSERT OR IGNORE INTO videos (path, title, category_id, media_type) VALUES ${ph}`,
            params
          );
        }
        await db.execute('COMMIT');
      } catch (e) {
        await db.execute('ROLLBACK');
        throw e;
      }
      set({ currentPage: 1 });
      await get().fetchVideos();
      // スキャン完了後に必ずカテゴリ一覧を再取得（フォルダ名→カテゴリ変換を反映）
      await useTagStore.getState().fetchCategories(db);
      get().generateThumbnails().catch(() => {});
    } finally {
      set({ isScanning: false });
    }
  },

  rescanAllDirs: async (targetDir?: string) => {
    const { db, watchDirs } = get();
    if (!db) return;
    const dirs = targetDir ? [targetDir] : watchDirs;
    if (dirs.length === 0) return;
    set({ isScanning: true });
    try {
      // SQLite パラメータ上限 (999) に収まる最大バッチサイズ (3列: path, title, media_type)
      const INSERT_BATCH_3 = 333;
      for (const dir of dirs) {
        const files = await invoke<ScannedFile[]>('scan_directory', { path: dir });
        if (files.length === 0) continue;

        // 新規追加ファイルを検出するため INSERT 前の最大 ID を記録
        const maxIdRow = await db.select<{ id: number }[]>(
          'SELECT COALESCE(MAX(id), 0) AS id FROM videos'
        );
        const prevMaxId = maxIdRow[0]?.id ?? 0;

        await db.execute('BEGIN');
        try {
          for (let i = 0; i < files.length; i += INSERT_BATCH_3) {
            const batch = files.slice(i, i + INSERT_BATCH_3);
            const ph = batch.map(() => '(?, ?, ?)').join(', ');
            const params: unknown[] = [];
            for (const file of batch) params.push(file.path, file.title, file.media_type ?? 'video');
            await db.execute(
              `INSERT OR IGNORE INTO videos (path, title, media_type) VALUES ${ph}`,
              params
            );
          }
          await db.execute('COMMIT');
        } catch (e) {
          await db.execute('ROLLBACK');
          throw e;
        }

        // use_dir_as_category が有効な場合、新規追加ファイルにカテゴリを割り当てる
        const dirFlagRow = await db.select<{ use_dir_as_category: number }[]>(
          'SELECT use_dir_as_category FROM watch_dirs WHERE path = ?',
          [dir]
        );
        if (dirFlagRow[0]?.use_dir_as_category === 1) {
          const newRows = await db.select<{ id: number }[]>(
            'SELECT id FROM videos WHERE id > ?',
            [prevMaxId]
          );
          if (newRows.length > 0) {
            // エラーが出ても後続の fetchVideos を止めないよう catch する
            await get().assignCategoryFromPath(newRows.map((r) => r.id)).catch((e) => {
              console.error('assignCategoryFromPath failed:', e);
            });
          }
        }
      }

      // 対象ディレクトリ内のDB登録済みファイルのうち実在しないものを削除
      const dirConditions = dirs.map(() => "REPLACE(path, '\\\\', '/') LIKE ? ESCAPE '!'").join(' OR ');
      const dirParams = dirs.map((d) => `${escapeLikeDir(d)}/%`);
      const dbVideos = await db.select<{ id: number; path: string }[]>(
        `SELECT id, path FROM videos WHERE ${dirConditions}`,
        dirParams
      );
      if (dbVideos.length > 0) {
        const sizes = await invoke<(number | null)[]>('get_file_sizes', {
          paths: dbVideos.map((v) => v.path),
        });
        const missingIds = dbVideos.filter((_, i) => sizes[i] === null).map((v) => v.id);
        if (missingIds.length > 0) {
          const ph = missingIds.map(() => '?').join(', ');
          await db.execute(`DELETE FROM playlist_items WHERE video_id IN (${ph})`, missingIds);
          await db.execute(`DELETE FROM video_tags WHERE video_id IN (${ph})`, missingIds);
          await db.execute(`DELETE FROM videos WHERE id IN (${ph})`, missingIds);
        }
      }

      // 全スキャン時: 未登録フォルダのファイルをDBから削除
      if (!targetDir && watchDirs.length > 0) {
        const registeredConditions = watchDirs
          .map(() => "REPLACE(path, '\\\\', '/') LIKE ? ESCAPE '!'")
          .join(' OR ');
        const registeredParams = watchDirs.map((d) => `${escapeLikeDir(d)}/%`);
        const unregisteredVideos = await db.select<{ id: number }[]>(
          `SELECT id FROM videos WHERE NOT (${registeredConditions})`,
          registeredParams
        );
        if (unregisteredVideos.length > 0) {
          const BATCH = 400;
          for (let i = 0; i < unregisteredVideos.length; i += BATCH) {
            const ids = unregisteredVideos.slice(i, i + BATCH).map((v) => v.id);
            const ph = ids.map(() => '?').join(', ');
            await db.execute(`DELETE FROM playlist_items WHERE video_id IN (${ph})`, ids);
            await db.execute(`DELETE FROM video_tags WHERE video_id IN (${ph})`, ids);
            await db.execute(`DELETE FROM videos WHERE id IN (${ph})`, ids);
          }
        }
      }

      await get().fetchVideos();
      // サムネイル生成はスキャン完了と切り離してバックグラウンド実行する。
      // await すると isThumbnailGenerating が true の場合に即 return → isScanning が
      // 誤って false になり、バックグラウンドの生成処理が DB を占有し続ける問題を防ぐ。
      get().generateThumbnails().catch(() => {});
    } finally {
      set({ isScanning: false });
    }
  },

  removeWatchDir: async (path: string) => {
    const { db } = get();
    if (!db) return;
    const escaped = escapeLikeDir(path);
    const videos = await db.select<{ id: number }[]>(
      "SELECT id FROM videos WHERE path LIKE ? ESCAPE '!'",
      [escaped + '/%']
    );
    if (videos.length > 0) {
      const BATCH = 400;
      for (let i = 0; i < videos.length; i += BATCH) {
        const ids = videos.slice(i, i + BATCH).map((v) => v.id);
        const ph = ids.map(() => '?').join(',');
        await db.execute(`DELETE FROM playlist_items WHERE video_id IN (${ph})`, ids);
        await db.execute(`DELETE FROM video_tags WHERE video_id IN (${ph})`, ids);
        await db.execute(`DELETE FROM videos WHERE id IN (${ph})`, ids);
      }
    }
    await db.execute('DELETE FROM watch_dirs WHERE path = ?', [path]);
    await invoke('stop_watching', { path }).catch(() => {});
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

    const { db } = get();
    if (!db) return;

    const cacheDir = await appCacheDir();
    const thumbDir = await join(cacheDir, 'thumbnails');

    set({ isThumbnailGenerating: true, isThumbnailPaused: false, thumbnailProgress: null });

    type VideoUpdate = { id: number; thumbnail?: string | null; duration?: number | null; has_audio: number };

    const audioExts = ['mp3', 'flac', 'aac', 'wav', 'ogg', 'opus', 'm4a', 'wma'];
    const imageExts = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'tiff', 'heic', 'avif'];

    // ffmpeg/ffprobe 呼び出しのみ行い DB 書き込みは行わない。
    // 並行実行時の DB ロック競合を防ぐため、書き込みは Promise.all 後にまとめて実施する。
    const processVideoData = async (video: { id: number; path: string; thumbnail: string | null }): Promise<VideoUpdate | null> => {
      try {
        const ext = video.path.split('.').pop()?.toLowerCase() ?? '';
        const isImage = imageExts.includes(ext);
        const isAudio = audioExts.includes(ext);

        if (isImage) {
          if (video.thumbnail) {
            return { id: video.id, has_audio: 0 };
          }
          const hashBuffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(video.path));
          const hash = Array.from(new Uint8Array(hashBuffer)).map((b) => b.toString(16).padStart(2, '0')).join('');
          const outputPath = await join(thumbDir, hash.slice(0, 2), `${hash}.jpg`);
          try {
            const result = await invoke<{ thumbnail_path: string; duration: number | null; has_audio: boolean }>(
              'generate_thumbnail',
              { videoPath: video.path, outputPath }
            );
            return { id: video.id, thumbnail: result.thumbnail_path, duration: null, has_audio: 0 };
          } catch {
            return { id: video.id, thumbnail: null, duration: null, has_audio: 0 };
          }
        }

        if (!video.thumbnail) {
          const hashBuffer = await crypto.subtle.digest(
            'SHA-256',
            new TextEncoder().encode(video.path)
          );
          const hash = Array.from(new Uint8Array(hashBuffer))
            .map((b) => b.toString(16).padStart(2, '0'))
            .join('');
          const outputPath = await join(thumbDir, hash.slice(0, 2), `${hash}.jpg`);

          if (isAudio) {
            // 音声: アルバムアート抽出を試みる。失敗してもエラーにしない。
            try {
              const result = await invoke<{ thumbnail_path: string; duration: number | null; has_audio: boolean }>(
                'generate_thumbnail',
                { videoPath: video.path, outputPath }
              );
              return { id: video.id, thumbnail: result.thumbnail_path, duration: result.duration, has_audio: 1 };
            } catch {
              // アルバムアートなし: サムネイルなし・duration は mpv 再生時に取得
              return { id: video.id, thumbnail: null, duration: null, has_audio: 1 };
            }
          }

          const result = await invoke<{ thumbnail_path: string; duration: number | null; has_audio: boolean }>(
            'generate_thumbnail',
            { videoPath: video.path, outputPath }
          );
          const hasAudio = result.has_audio ? 1 : 0;
          return { id: video.id, thumbnail: result.thumbnail_path, duration: result.duration, has_audio: hasAudio };
        } else {
          // サムネイルはあるが音声情報が未取得の動画
          if (isAudio) return { id: video.id, has_audio: 1 };
          const hasAudioRaw = await invoke<boolean>('check_has_audio', { videoPath: video.path });
          const hasAudio = hasAudioRaw ? 1 : 0;
          return { id: video.id, has_audio: hasAudio };
        }
      } catch (e) {
        console.warn(`Audio/thumbnail processing failed for ${video.path}:`, e);
        return null;
      }
    };

    // 処理済み ID を記録し、エラー等で終わらないファイルの無限再試行を防ぐ。
    // スキャン後に追加された新規ファイルは未記録なので次ループで処理される。
    const processedIds = new Set<number>();
    const PENDING_BATCH_SIZE = 500;

    try {
      while (true) {
        const pending = await db.select<{ id: number; path: string; thumbnail: string | null }[]>(
          'SELECT id, path, thumbnail FROM videos WHERE thumbnail IS NULL OR has_audio IS NULL LIMIT ?',
          [PENDING_BATCH_SIZE]
        );
        const toProcess = pending.filter((v) => !processedIds.has(v.id));
        if (toProcess.length === 0) break;

        set({ thumbnailProgress: { done: 0, total: toProcess.length } });

        let doneCount = 0;
        for (let i = 0; i < toProcess.length; i += THUMBNAIL_CONCURRENCY) {
          while (get().isThumbnailPaused || get().isScanning) {
            await new Promise<void>((resolve) => setTimeout(resolve, 200));
          }
          const batch = toProcess.slice(i, i + THUMBNAIL_CONCURRENCY);
          const results = await Promise.all(batch.map(processVideoData));
          doneCount += batch.length;
          for (const v of batch) processedIds.add(v.id);

          // ffmpeg 完了後に DB 書き込みをシリアルで実行（並行書き込みによるロック競合を回避）
          for (const r of results) {
            if (r === null) continue;
            if (r.thumbnail !== undefined) {
              await db.execute(
                'UPDATE videos SET thumbnail = ?, duration = ?, has_audio = ? WHERE id = ?',
                [r.thumbnail, r.duration ?? null, r.has_audio, r.id]
              );
            } else {
              await db.execute('UPDATE videos SET has_audio = ? WHERE id = ?', [r.has_audio, r.id]);
            }
          }

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
            thumbnailProgress: { done: doneCount, total: toProcess.length },
          }));
        }
      }
    } finally {
      set({ isThumbnailGenerating: false, isThumbnailPaused: false, thumbnailProgress: null });
      await get().fetchVideos();
    }
  },

  rescanVideo: async (videoId: number) => {
    const { db } = get();
    if (!db) return;

    const rows = await db.select<{ id: number; path: string }[]>(
      'SELECT id, path FROM videos WHERE id = ?',
      [videoId]
    );
    if (!rows[0]) return;
    const video = rows[0];

    const audioExts = ['mp3', 'flac', 'aac', 'wav', 'ogg', 'opus', 'm4a', 'wma'];
    const imageExts = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'tiff', 'heic', 'avif'];
    const ext = video.path.split('.').pop()?.toLowerCase() ?? '';
    const isImage = imageExts.includes(ext);
    const isAudio = audioExts.includes(ext);
    const mediaType = isImage ? 'image' : isAudio ? 'audio' : 'video';

    const cacheDir = await appCacheDir();
    const thumbDir = await join(cacheDir, 'thumbnails');
    const hashBuffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(video.path));
    const hash = Array.from(new Uint8Array(hashBuffer))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
    const outputPath = await join(thumbDir, hash.slice(0, 2), `${hash}.jpg`);

    try {
      if (isImage) {
        try {
          const result = await invoke<{ thumbnail_path: string; duration: number | null; has_audio: boolean }>(
            'generate_thumbnail', { videoPath: video.path, outputPath }
          );
          await db.execute(
            'UPDATE videos SET media_type = ?, thumbnail = ?, duration = NULL, has_audio = 0 WHERE id = ?',
            [mediaType, result.thumbnail_path, videoId]
          );
        } catch {
          await db.execute(
            'UPDATE videos SET media_type = ?, thumbnail = NULL, duration = NULL, has_audio = 0 WHERE id = ?',
            [mediaType, videoId]
          );
        }
      } else if (isAudio) {
        try {
          const result = await invoke<{ thumbnail_path: string; duration: number | null; has_audio: boolean }>(
            'generate_thumbnail', { videoPath: video.path, outputPath }
          );
          await db.execute(
            'UPDATE videos SET media_type = ?, thumbnail = ?, duration = ?, has_audio = 1 WHERE id = ?',
            [mediaType, result.thumbnail_path, result.duration ?? null, videoId]
          );
        } catch {
          await db.execute(
            'UPDATE videos SET media_type = ?, thumbnail = NULL, duration = NULL, has_audio = 1 WHERE id = ?',
            [mediaType, videoId]
          );
        }
      } else {
        const result = await invoke<{ thumbnail_path: string; duration: number | null; has_audio: boolean }>(
          'generate_thumbnail', { videoPath: video.path, outputPath }
        );
        await db.execute(
          'UPDATE videos SET media_type = ?, thumbnail = ?, duration = ?, has_audio = ? WHERE id = ?',
          [mediaType, result.thumbnail_path, result.duration ?? null, result.has_audio ? 1 : 0, videoId]
        );
      }
    } catch (e) {
      console.warn('rescanVideo failed:', e);
    }

    await get().fetchVideos();
  },

  rescanMultiple: async (videoIds: number[]) => {
    const { db } = get();
    if (!db || videoIds.length === 0) return;

    const audioExts = ['mp3', 'flac', 'aac', 'wav', 'ogg', 'opus', 'm4a', 'wma'];
    const imageExts = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'tiff', 'heic', 'avif'];

    const SELECT_BATCH = 499;
    const rows: { id: number; path: string }[] = [];
    for (let i = 0; i < videoIds.length; i += SELECT_BATCH) {
      const chunk = videoIds.slice(i, i + SELECT_BATCH);
      const ph = chunk.map(() => '?').join(', ');
      const batch = await db.select<{ id: number; path: string }[]>(
        `SELECT id, path FROM videos WHERE id IN (${ph})`, chunk
      );
      rows.push(...batch);
    }

    const cacheDir = await appCacheDir();
    const thumbDir = await join(cacheDir, 'thumbnails');

    set({ isThumbnailGenerating: true, isThumbnailPaused: false, thumbnailProgress: { done: 0, total: rows.length } });

    type RescanUpdate = { id: number; mediaType: string; thumbnail: string | null; duration: number | null; hasAudio: number };

    const processOne = async (video: { id: number; path: string }): Promise<RescanUpdate | null> => {
      const ext = video.path.split('.').pop()?.toLowerCase() ?? '';
      const isImage = imageExts.includes(ext);
      const isAudio = audioExts.includes(ext);
      const mediaType = isImage ? 'image' : isAudio ? 'audio' : 'video';
      const hashBuffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(video.path));
      const hash = Array.from(new Uint8Array(hashBuffer)).map((b) => b.toString(16).padStart(2, '0')).join('');
      const outputPath = await join(thumbDir, hash.slice(0, 2), `${hash}.jpg`);
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
        for (const r of results) {
          if (!r) continue;
          await db.execute(
            'UPDATE videos SET media_type = ?, thumbnail = ?, duration = ?, has_audio = ? WHERE id = ?',
            [r.mediaType, r.thumbnail, r.duration, r.hasAudio, r.id]
          );
        }
        set({ thumbnailProgress: { done, total: rows.length } });
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

  updateVideo: async (videoId: number, updates: Partial<Pick<Video, 'title' | 'rating' | 'path' | 'media_type' | 'source_url'>>) => {
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

    // SELECT をバッチ処理してパラメータ上限 (999) を回避
    const SELECT_BATCH = 499;
    const rows: { id: number; path: string }[] = [];
    for (let i = 0; i < videoIds.length; i += SELECT_BATCH) {
      const chunk = videoIds.slice(i, i + SELECT_BATCH);
      const ph = chunk.map(() => '?').join(', ');
      const batch = await db.select<{ id: number; path: string }[]>(
        `SELECT id, path FROM videos WHERE id IN (${ph})`,
        chunk
      );
      rows.push(...batch);
    }

    const rootDirs = watchDirs.map((d) => d.replace(/\\/g, '/').replace(/\/$/, ''));

    // ファイルパスからwatchDirsを基準にした相対ディレクトリパスを取得
    const getRelPath = (filePath: string): string | null => {
      for (const root of rootDirs) {
        const rel = getRelativeDirPath(filePath, root);
        if (rel !== undefined) return rel; // null: ルート直下, string: サブディレクトリ
      }
      // watchDirs に含まれない場合は immediate parent 名をフォールバックとして使用
      const parts = filePath.replace(/\\/g, '/').split('/');
      parts.pop();
      return parts[parts.length - 1] || null;
    };

    // ユニークな相対パスを収集し、深さ昇順で親→子の順に作成
    const uniqueRelPaths = [...new Set(
      rows.map((r) => getRelPath(r.path)).filter((p): p is string => p != null),
    )];

    if (uniqueRelPaths.length === 0) {
      await get().fetchVideos();
      return;
    }

    uniqueRelPaths.sort((a, b) => a.split('/').length - b.split('/').length);
    const catCache = new Map<string, number>();
    const categoryIdMap: Record<string, number> = {};
    const total = uniqueRelPaths.length;
    const { addToast, updateToast, removeToast } = useToastStore.getState();
    const toastId = addToast(`カテゴリ割り当て中... 0 / ${total}`, 'info', 0);
    try {
      for (let pi = 0; pi < uniqueRelPaths.length; pi++) {
        updateToast(toastId, `カテゴリ割り当て中... ${pi + 1} / ${total}`);
        const leafId = await buildCategoryHierarchy(db, uniqueRelPaths[pi], catCache);
        if (leafId != null) categoryIdMap[uniqueRelPaths[pi]] = leafId;
      }

      // category_id でグループ化して IN (...) バッチ UPDATE (N 個別クエリ → M グループクエリ)
      const categoryGroups = new Map<number, number[]>();
      for (const row of rows) {
        const relPath = getRelPath(row.path);
        const catId = relPath != null ? categoryIdMap[relPath] : undefined;
        if (catId != null) {
          if (!categoryGroups.has(catId)) categoryGroups.set(catId, []);
          categoryGroups.get(catId)!.push(row.id);
        }
      }

      if (categoryGroups.size > 0) {
        // category_id 1パラメータ + id 最大498個 = 499パラメータ ≤ SQLite 上限
        const UPDATE_BATCH = 498;
        await db.execute('BEGIN');
        try {
          for (const [catId, ids] of categoryGroups) {
            for (let i = 0; i < ids.length; i += UPDATE_BATCH) {
              const batch = ids.slice(i, i + UPDATE_BATCH);
              const ph = batch.map(() => '?').join(', ');
              await db.execute(
                `UPDATE videos SET category_id = ? WHERE id IN (${ph})`,
                [catId, ...batch]
              );
            }
          }
          await db.execute('COMMIT');
        } catch (e) {
          await db.execute('ROLLBACK');
          throw e;
        }
      }

      await useTagStore.getState().fetchCategories(db);
      await get().fetchVideos();
      removeToast(toastId);
      const assigned = [...categoryGroups.values()].reduce((s, ids) => s + ids.length, 0);
      addToast(
        assigned > 0 ? `カテゴリを割り当てました（${assigned} 件）` : 'カテゴリ割り当て完了',
        'success'
      );
    } catch (e) {
      removeToast(toastId);
      throw e;
    }
  },

  addVideoFromPath: async (path: string, title: string, sourceUrl?: string) => {
    const { db } = get();
    if (!db) return null;
    const ext = path.split('.').pop()?.toLowerCase() ?? '';
    const audioExts = ['mp3', 'flac', 'aac', 'wav', 'ogg', 'opus', 'm4a', 'wma'];
    const imageExts = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'tiff', 'heic', 'avif'];
    const mediaType = audioExts.includes(ext) ? 'audio' : imageExts.includes(ext) ? 'image' : 'video';
    await db.execute(
      'INSERT OR IGNORE INTO videos (path, title, media_type, source_url) VALUES (?, ?, ?, ?)',
      [path, title, mediaType, sourceUrl ?? null]
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

  batchWatcherUpdate: async ({ creates, removes, renames }) => {
    const { db } = get();
    if (!db) return;

    // 削除: パスを一括 SELECT して IN (...) バッチ DELETE
    if (removes.length > 0) {
      const SELECT_BATCH = 499;
      const removeIds: number[] = [];
      for (let i = 0; i < removes.length; i += SELECT_BATCH) {
        const chunk = removes.slice(i, i + SELECT_BATCH);
        const ph = chunk.map(() => '?').join(', ');
        const rows = await db.select<{ id: number }[]>(
          `SELECT id FROM videos WHERE path IN (${ph})`, chunk
        );
        removeIds.push(...rows.map((r) => r.id));
      }
      if (removeIds.length > 0) {
        const BATCH = 400;
        for (let i = 0; i < removeIds.length; i += BATCH) {
          const ids = removeIds.slice(i, i + BATCH);
          const ph = ids.map(() => '?').join(', ');
          await db.execute(`DELETE FROM playlist_items WHERE video_id IN (${ph})`, ids);
          await db.execute(`DELETE FROM video_tags WHERE video_id IN (${ph})`, ids);
          await db.execute(`DELETE FROM videos WHERE id IN (${ph})`, ids);
        }
      }
    }

    // リネーム: 旧パス未登録の場合は新規追加として creates へ追加
    for (const r of renames) {
      const rows = await db.select<{ id: number }[]>(
        'SELECT id FROM videos WHERE path = ?', [r.old_path]
      );
      if (!rows[0]) {
        creates.push({ path: r.new_path, title: r.title });
        continue;
      }
      const videoId = rows[0].id;
      const conflicting = await db.select<{ id: number }[]>(
        'SELECT id FROM videos WHERE path = ? AND id != ?', [r.new_path, videoId]
      );
      if (conflicting.length > 0) {
        const ids = conflicting.map((c) => c.id);
        const ph = ids.map(() => '?').join(', ');
        await db.execute(`DELETE FROM playlist_items WHERE video_id IN (${ph})`, ids);
        await db.execute(`DELETE FROM video_tags WHERE video_id IN (${ph})`, ids);
        await db.execute(`DELETE FROM videos WHERE id IN (${ph})`, ids);
      }
      await db.execute('UPDATE videos SET path = ?, title = ? WHERE id = ?', [r.new_path, r.title, videoId]);
    }

    // 追加: バッチ INSERT → use_dir_as_category 有効フォルダならカテゴリ割り当て
    if (creates.length > 0) {
      const audioExts = ['mp3', 'flac', 'aac', 'wav', 'ogg', 'opus', 'm4a', 'wma'];
      const imageExts = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'tiff', 'heic', 'avif'];

      const maxIdRow = await db.select<{ id: number }[]>('SELECT COALESCE(MAX(id), 0) AS id FROM videos');
      const prevMaxId = maxIdRow[0]?.id ?? 0;

      // 3列 (path, title, media_type): 332 × 3 = 996 ≤ 999
      const INSERT_BATCH = 332;
      for (let i = 0; i < creates.length; i += INSERT_BATCH) {
        const batch = creates.slice(i, i + INSERT_BATCH);
        const ph = batch.map(() => '(?, ?, ?)').join(', ');
        const params: unknown[] = [];
        for (const f of batch) {
          const ext = f.path.split('.').pop()?.toLowerCase() ?? '';
          const mediaType = audioExts.includes(ext) ? 'audio' : imageExts.includes(ext) ? 'image' : 'video';
          params.push(f.path, f.title, mediaType);
        }
        await db.execute(`INSERT OR IGNORE INTO videos (path, title, media_type) VALUES ${ph}`, params);
      }

      const catEnabled = await db.select<{ use_dir_as_category: number }[]>(
        'SELECT use_dir_as_category FROM watch_dirs WHERE use_dir_as_category = 1 LIMIT 1'
      );
      if (catEnabled.length > 0) {
        const newRows = await db.select<{ id: number }[]>(
          'SELECT id FROM videos WHERE id > ?', [prevMaxId]
        );
        if (newRows.length > 0) {
          await get().assignCategoryFromPath(newRows.map((r) => r.id)).catch((e) => {
            console.error('assignCategoryFromPath failed in batchWatcherUpdate:', e);
          });
        }
      }
    }

    await get().fetchVideos();
    get().generateThumbnails().catch(() => {});
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
    // ウォッチャーが先に newPath を登録済みの場合 (race condition) は先に削除してから UPDATE
    const conflicting = await db.select<{ id: number }[]>(
      'SELECT id FROM videos WHERE path = ? AND id != ?',
      [newPath, videoId]
    );
    if (conflicting.length > 0) {
      const ids = conflicting.map((r) => r.id);
      const ph = ids.map(() => '?').join(', ');
      await db.execute(`DELETE FROM playlist_items WHERE video_id IN (${ph})`, ids);
      await db.execute(`DELETE FROM video_tags WHERE video_id IN (${ph})`, ids);
      await db.execute(`DELETE FROM videos WHERE id IN (${ph})`, ids);
    }
    await db.execute('UPDATE videos SET path = ? WHERE id = ?', [newPath, videoId]);
    set((state) => ({
      videos: state.videos
        .filter((v) => !conflicting.some((c) => c.id === v.id))
        .map((v) => v.id === videoId ? { ...v, path: newPath } : v),
    }));
  },

  updateVideoPath: async (oldPath: string, newPath: string) => {
    const { db } = get();
    if (!db) return;
    const rows = await db.select<{ id: number }[]>('SELECT id FROM videos WHERE path = ?', [oldPath]);
    if (rows.length === 0) return;
    const videoId = rows[0].id;
    // 競合エントリがある場合は先に削除 (Create イベントが先行した場合など)
    const conflicting = await db.select<{ id: number }[]>(
      'SELECT id FROM videos WHERE path = ? AND id != ?',
      [newPath, videoId]
    );
    if (conflicting.length > 0) {
      const ids = conflicting.map((r) => r.id);
      const ph = ids.map(() => '?').join(', ');
      await db.execute(`DELETE FROM playlist_items WHERE video_id IN (${ph})`, ids);
      await db.execute(`DELETE FROM video_tags WHERE video_id IN (${ph})`, ids);
      await db.execute(`DELETE FROM videos WHERE id IN (${ph})`, ids);
    }
    await db.execute('UPDATE videos SET path = ? WHERE id = ?', [newPath, videoId]);
    await get().fetchVideos();
  },
}));
