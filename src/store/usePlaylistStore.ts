import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';
import type { Playlist, Video } from '../types';

interface PlaylistState {
  playlists: Playlist[];
}

interface PlaylistActions {
  init: () => Promise<void>;
  fetchPlaylists: () => Promise<void>;
  createPlaylist: (name: string) => Promise<void>;
  deletePlaylist: (id: number) => Promise<void>;
  fetchPlaylistVideos: (playlistId: number) => Promise<Video[]>;
  addVideoToPlaylist: (playlistId: number, videoId: number) => Promise<void>;
  removeVideoFromPlaylist: (playlistId: number, videoId: number) => Promise<void>;
  reorderPlaylistItems: (playlistId: number, videoIds: number[]) => Promise<void>;
}

export const usePlaylistStore = create<PlaylistState & PlaylistActions>((set, get) => ({
  playlists: [],

  init: async () => {
    await get().fetchPlaylists();
  },

  fetchPlaylists: async () => {
    const playlists = await invoke<Playlist[]>('db_fetch_playlists');
    set({ playlists });
  },

  createPlaylist: async (name: string) => {
    await invoke('db_create_playlist', { name });
    await get().fetchPlaylists();
  },

  deletePlaylist: async (id: number) => {
    await invoke('db_delete_playlist', { id });
    set((state) => ({ playlists: state.playlists.filter((p) => p.id !== id) }));
  },

  fetchPlaylistVideos: async (playlistId: number): Promise<Video[]> => {
    return invoke<Video[]>('db_fetch_playlist_videos', { playlistId });
  },

  addVideoToPlaylist: async (playlistId: number, videoId: number) => {
    await invoke('db_add_video_to_playlist', { playlistId, videoId });
  },

  removeVideoFromPlaylist: async (playlistId: number, videoId: number) => {
    await invoke('db_remove_video_from_playlist', { playlistId, videoId });
  },

  reorderPlaylistItems: async (playlistId: number, videoIds: number[]) => {
    await invoke('db_reorder_playlist_items', { playlistId, videoIds });
  },
}));
