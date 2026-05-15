import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';
import type { Video } from '../types';
import { useLibraryStore } from './useLibraryStore';

interface PlayerState {
  currentVideo: Video | null;
  playbackTime: number;
  queue: Video[];
  queueIndex: number;
}

interface PlayerActions {
  play: (video: Video) => Promise<void>;
  playWithQueue: (videos: Video[], startIndex?: number) => Promise<void>;
  playNext: () => Promise<void>;
  playPrev: () => Promise<void>;
  quit: () => Promise<void>;
}

// Zustand state 外で管理 (setInterval はシリアライズ不要)
let pollingInterval: ReturnType<typeof setInterval> | null = null;

function startPolling(
  set: (s: Partial<PlayerState>) => void,
  get: () => PlayerState & PlayerActions
) {
  stopPolling();
  pollingInterval = setInterval(async () => {
    try {
      const time = await invoke<number>('get_playback_time');
      set({ playbackTime: time });
    } catch {
      // mpv が idle / 終了済みの場合 → キューがあれば次へ
      const { currentVideo, queue, playbackTime } = get();
      if (currentVideo && queue.length > 0 && playbackTime > 3) {
        get().playNext();
      }
    }
  }, 2000);
}

function stopPolling() {
  if (pollingInterval !== null) {
    clearInterval(pollingInterval);
    pollingInterval = null;
  }
}

async function invokPlay(video: Video) {
  await invoke('play', { path: video.path });
}

export const usePlayerStore = create<PlayerState & PlayerActions>((set, get) => ({
  currentVideo: null,
  playbackTime: 0,
  queue: [],
  queueIndex: -1,

  play: async (video: Video) => {
    await invokPlay(video);
    set({ currentVideo: video, playbackTime: 0, queue: [], queueIndex: -1 });
    startPolling(set, get);
  },

  playWithQueue: async (videos: Video[], startIndex = 0) => {
    if (videos.length === 0) return;
    const idx = Math.max(0, Math.min(startIndex, videos.length - 1));
    await invokPlay(videos[idx]);
    set({ currentVideo: videos[idx], playbackTime: 0, queue: videos, queueIndex: idx });
    startPolling(set, get);
  },

  playNext: async () => {
    const { queue, queueIndex, currentVideo, playbackTime } = get();
    if (currentVideo && playbackTime > 0) {
      await useLibraryStore.getState().updateProgress(currentVideo.id, playbackTime);
    }
    if (queue.length === 0 || queueIndex >= queue.length - 1) return;
    const nextIdx = queueIndex + 1;
    const nextVideo = queue[nextIdx];
    await invokPlay(nextVideo);
    set({ currentVideo: nextVideo, playbackTime: 0, queueIndex: nextIdx });
    startPolling(set, get);
  },

  playPrev: async () => {
    const { queue, queueIndex, currentVideo, playbackTime } = get();
    if (currentVideo && playbackTime > 0) {
      await useLibraryStore.getState().updateProgress(currentVideo.id, playbackTime);
    }
    if (queue.length === 0 || queueIndex <= 0) return;
    const prevIdx = queueIndex - 1;
    const prevVideo = queue[prevIdx];
    await invokPlay(prevVideo);
    set({ currentVideo: prevVideo, playbackTime: 0, queueIndex: prevIdx });
    startPolling(set, get);
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

    set({ currentVideo: null, playbackTime: 0, queue: [], queueIndex: -1 });
  },
}));
