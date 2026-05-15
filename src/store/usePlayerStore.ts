import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';
import type { Video } from '../types';

interface PlayerState {
  currentVideo: Video | null;
}

interface PlayerActions {
  play: (video: Video) => Promise<void>;
  quit: () => Promise<void>;
}

export const usePlayerStore = create<PlayerState & PlayerActions>((set) => ({
  currentVideo: null,

  play: async (video: Video) => {
    await invoke('play', { path: video.path });
    set({ currentVideo: video });
  },

  quit: async () => {
    await invoke('quit_mpv');
    set({ currentVideo: null });
  },
}));
