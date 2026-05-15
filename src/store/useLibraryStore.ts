import { create } from 'zustand';
import Database from '@tauri-apps/plugin-sql';
import { invoke } from '@tauri-apps/api/core';
import type { Video, ScannedFile } from '../types';

interface LibraryState {
  videos: Video[];
  isScanning: boolean;
  isDbReady: boolean;
  dbError: string | null;
  db: Database | null;
}

interface LibraryActions {
  initDb: () => Promise<void>;
  fetchVideos: () => Promise<void>;
  scanAndImport: (path: string) => Promise<void>;
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

export const useLibraryStore = create<LibraryState & LibraryActions>((set, get) => ({
  videos: [],
  isScanning: false,
  isDbReady: false,
  dbError: null,
  db: null,

  initDb: async () => {
    try {
      const db = await Database.load('sqlite:videos.db');
      await db.execute(CREATE_VIDEOS_TABLE);
      await db.execute(CREATE_PLAYLISTS_TABLE);
      await db.execute(CREATE_PLAYLIST_ITEMS_TABLE);
      set({ db, isDbReady: true });
      await get().fetchVideos();
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
      const files = await invoke<ScannedFile[]>('scan_directory', { path });
      for (const file of files) {
        await db.execute(
          'INSERT OR IGNORE INTO videos (path, title) VALUES (?, ?)',
          [file.path, file.title]
        );
      }
      await get().fetchVideos();
    } finally {
      set({ isScanning: false });
    }
  },
}));
