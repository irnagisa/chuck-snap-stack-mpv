import { create } from 'zustand';
import Database from '@tauri-apps/plugin-sql';
import { invoke } from '@tauri-apps/api/core';
import { appCacheDir, join } from '@tauri-apps/api/path';
import type { Video, ScannedFile } from '../types';
import { useSettingsStore } from './useSettingsStore';
import { useTagStore } from './useTagStore';
import { usePlaylistStore } from './usePlaylistStore';

interface LibraryState {
  videos: Video[];
  watchDirs: string[];
  isScanning: boolean;
  isThumbnailGenerating: boolean;
  thumbnailProgress: { done: number; total: number } | null;
  isDbReady: boolean;
  dbError: string | null;
  db: Database | null;
}

interface LibraryActions {
  initDb: () => Promise<void>;
  fetchVideos: () => Promise<void>;
  scanAndImport: (path: string) => Promise<void>;
  removeWatchDir: (path: string) => Promise<void>;
  generateThumbnails: () => Promise<void>;
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

export const useLibraryStore = create<LibraryState & LibraryActions>((set, get) => ({
  videos: [],
  watchDirs: [],
  isScanning: false,
  isThumbnailGenerating: false,
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
      // category_id カラムを既存 videos テーブルに追加 (初回のみ)
      try {
        await db.execute('ALTER TABLE videos ADD COLUMN category_id INTEGER REFERENCES categories(id)');
      } catch { /* already exists */ }
      // tag_category_id カラムを既存 tags テーブルに追加 (初回のみ)
      try {
        await db.execute('ALTER TABLE tags ADD COLUMN tag_category_id INTEGER REFERENCES tag_categories(id)');
      } catch { /* already exists */ }
      set({ db, isDbReady: true });
      await useSettingsStore.getState().loadSettings(db);
      await get().fetchVideos();
      await useTagStore.getState().init(db);
      await usePlaylistStore.getState().init(db);
      await db.execute(CREATE_WATCH_DIRS_TABLE);
      // アプリ起動時: 保存済みのすべての watch_dirs を再監視
      const savedDirs = await db.select<{ path: string }[]>('SELECT path FROM watch_dirs');
      set({ watchDirs: savedDirs.map((d) => d.path) });
      for (const dir of savedDirs) {
        invoke('start_watching', { path: dir.path }).catch(() => {});
      }
      // バックグラウンドで duration/thumbnail が未取得の動画を補完
      get().generateThumbnails().catch(() => {});
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error('initDb failed:', msg);
      set({ dbError: msg });
    }
  },

  fetchVideos: async () => {
    const { db } = get();
    if (!db) return;
    const videos = await db.select<Video[]>(
      'SELECT * FROM videos ORDER BY created_at DESC'
    );
    set({ videos });
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
      // ファイル一覧を即座に UI に反映してスキャン完了とする
      await get().fetchVideos();
    } finally {
      set({ isScanning: false });
    }
    // サムネイル生成はバックグラウンドで実行
    get().generateThumbnails().catch(() => {});
  },

  removeWatchDir: async (path: string) => {
    const { db } = get();
    if (!db) return;
    await db.execute('DELETE FROM watch_dirs WHERE path = ?', [path]);
    await invoke('stop_watching', { path }).catch(() => {});
    set((state) => ({ watchDirs: state.watchDirs.filter((d) => d !== path) }));
  },

  generateThumbnails: async () => {
    if (get().isThumbnailGenerating) return;

    const { db, videos } = get();
    if (!db) return;

    const cacheDir = await appCacheDir();
    const thumbDir = await join(cacheDir, 'thumbnails');

    const withoutThumb = videos.filter((v) => !v.thumbnail);
    if (withoutThumb.length === 0) return;

    set({ isThumbnailGenerating: true, thumbnailProgress: { done: 0, total: withoutThumb.length } });

    try {
      for (const video of withoutThumb) {
        try {
          // パスの SHA-256 ハッシュ先頭2文字をシャードディレクトリ名に使用 (Git 方式)
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
          set((state) => ({
            videos: state.videos.map((v) =>
              v.id === video.id
                ? { ...v, thumbnail: result.thumbnail_path, duration: result.duration ?? v.duration }
                : v
            ),
            thumbnailProgress: state.thumbnailProgress
              ? { ...state.thumbnailProgress, done: state.thumbnailProgress.done + 1 }
              : null,
          }));
        } catch (e) {
          console.warn(`Thumbnail generation failed for ${video.path}:`, e);
          set((state) => ({
            thumbnailProgress: state.thumbnailProgress
              ? { ...state.thumbnailProgress, done: state.thumbnailProgress.done + 1 }
              : null,
          }));
        }
      }
    } finally {
      set({ isThumbnailGenerating: false, thumbnailProgress: null });
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
    // ローカル state も即時更新
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
    set((state) => ({ videos: state.videos.filter((v) => v.id !== videoId) }));
    // videoTags のキャッシュも削除
    useTagStore.getState().videoTags[videoId] && useTagStore.setState((state) => {
      const next = { ...state.videoTags };
      delete next[videoId];
      return { videoTags: next };
    });
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
    const { videos } = get();
    const target = videos.find((v) => v.path === path);
    if (!target) return;
    await get().removeVideo(target.id);
  },

  removeVideo: async (videoId: number) => {
    const { db } = get();
    if (!db) return;
    // 関連レコードを先に削除 (SQLite は PRAGMA foreign_keys がデフォルト OFF)
    await db.execute('DELETE FROM playlist_items WHERE video_id = ?', [videoId]);
    await db.execute('DELETE FROM video_tags WHERE video_id = ?', [videoId]);
    await db.execute('DELETE FROM videos WHERE id = ?', [videoId]);
    set((state) => ({ videos: state.videos.filter((v) => v.id !== videoId) }));
    if (useTagStore.getState().videoTags[videoId]) {
      useTagStore.setState((state) => {
        const next = { ...state.videoTags };
        delete next[videoId];
        return { videoTags: next };
      });
    }
  },

  removeMultiple: async (videoIds: number[]) => {
    const { db } = get();
    if (!db || videoIds.length === 0) return;
    for (const videoId of videoIds) {
      await db.execute('DELETE FROM playlist_items WHERE video_id = ?', [videoId]);
      await db.execute('DELETE FROM video_tags WHERE video_id = ?', [videoId]);
      await db.execute('DELETE FROM videos WHERE id = ?', [videoId]);
    }
    const idSet = new Set(videoIds);
    set((state) => ({ videos: state.videos.filter((v) => !idSet.has(v.id)) }));
    useTagStore.setState((state) => {
      const next = { ...state.videoTags };
      for (const id of videoIds) delete next[id];
      return { videoTags: next };
    });
  },
}));
