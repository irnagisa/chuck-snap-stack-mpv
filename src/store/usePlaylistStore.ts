import { create } from 'zustand';
import Database from '@tauri-apps/plugin-sql';
import type { Playlist, Video } from '../types';

interface PlaylistState {
  playlists: Playlist[];
  db: Database | null;
}

interface PlaylistActions {
  init: (db: Database) => Promise<void>;
  fetchPlaylists: () => Promise<void>;
  createPlaylist: (name: string) => Promise<void>;
  deletePlaylist: (id: number) => Promise<void>;
  fetchPlaylistVideos: (playlistId: number) => Promise<Video[]>;
  addVideoToPlaylist: (playlistId: number, videoId: number) => Promise<void>;
  removeVideoFromPlaylist: (playlistId: number, videoId: number) => Promise<void>;
}

export const usePlaylistStore = create<PlaylistState & PlaylistActions>((set, get) => ({
  playlists: [],
  db: null,

  init: async (db: Database) => {
    set({ db });
    await get().fetchPlaylists();
  },

  fetchPlaylists: async () => {
    const { db } = get();
    if (!db) return;
    const playlists = await db.select<Playlist[]>(
      'SELECT * FROM playlists ORDER BY created_at DESC'
    );
    set({ playlists });
  },

  createPlaylist: async (name: string) => {
    const { db } = get();
    if (!db) return;
    await db.execute('INSERT INTO playlists (name) VALUES (?)', [name]);
    await get().fetchPlaylists();
  },

  deletePlaylist: async (id: number) => {
    const { db } = get();
    if (!db) return;
    await db.execute('DELETE FROM playlist_items WHERE playlist_id = ?', [id]);
    await db.execute('DELETE FROM playlists WHERE id = ?', [id]);
    set((state) => ({ playlists: state.playlists.filter((p) => p.id !== id) }));
  },

  fetchPlaylistVideos: async (playlistId: number): Promise<Video[]> => {
    const { db } = get();
    if (!db) return [];
    return db.select<Video[]>(
      `SELECT v.* FROM videos v
       JOIN playlist_items pi ON v.id = pi.video_id
       WHERE pi.playlist_id = ?
       ORDER BY pi.position ASC`,
      [playlistId]
    );
  },

  addVideoToPlaylist: async (playlistId: number, videoId: number) => {
    const { db } = get();
    if (!db) return;
    await db.execute(
      `INSERT OR IGNORE INTO playlist_items (playlist_id, video_id, position)
       SELECT ?, ?, COALESCE(MAX(position), 0) + 1 FROM playlist_items WHERE playlist_id = ?`,
      [playlistId, videoId, playlistId]
    );
  },

  removeVideoFromPlaylist: async (playlistId: number, videoId: number) => {
    const { db } = get();
    if (!db) return;
    await db.execute(
      'DELETE FROM playlist_items WHERE playlist_id = ? AND video_id = ?',
      [playlistId, videoId]
    );
  },
}));
