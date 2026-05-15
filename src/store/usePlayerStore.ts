import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';
import type { Video } from '../types';
import { useLibraryStore } from './useLibraryStore';

interface PlayerState {
  currentVideo: Video | null;
  playbackTime: number;
}

interface PlayerActions {
  play: (video: Video) => Promise<void>;
  quit: () => Promise<void>;
}

// Zustand state 外で管理 (setInterval はシリアライズ不要)
let pollingInterval: ReturnType<typeof setInterval> | null = null;

function startPolling(set: (s: Partial<PlayerState>) => void) {
  stopPolling();
  pollingInterval = setInterval(async () => {
    try {
      const time = await invoke<number>('get_playback_time');
      set({ playbackTime: time });
    } catch {
      // mpv が idle / 終了済みの場合は無視
    }
  }, 2000);
}

function stopPolling() {
  if (pollingInterval !== null) {
    clearInterval(pollingInterval);
    pollingInterval = null;
  }
}

export const usePlayerStore = create<PlayerState & PlayerActions>((set, get) => ({
  currentVideo: null,
  playbackTime: 0,

  play: async (video: Video) => {
    await invoke('play', { path: video.path });
    set({ currentVideo: video, playbackTime: 0 });
    startPolling(set);
  },

  quit: async () => {
    stopPolling();

    const { currentVideo, playbackTime } = get();
    if (currentVideo && playbackTime > 0) {
      await useLibraryStore.getState().updateProgress(currentVideo.id, playbackTime);
    }

    try {
      await invoke('quit_mpv');
    } catch {
      // mpv が既に終了していても続行
    }

    set({ currentVideo: null, playbackTime: 0 });
  },
}));
