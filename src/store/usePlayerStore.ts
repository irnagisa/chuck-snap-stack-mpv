import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import type { Video } from '../types';
import { useLibraryStore } from './useLibraryStore';

interface PlayerState {
  currentVideo: Video | null;
  playbackTime: number;
  duration: number;
  isPaused: boolean;
  isLooping: boolean;
  isShuffle: boolean;
  queue: Video[];
  queueIndex: number;
  originalQueue: Video[];
}

interface PlayerActions {
  play: (video: Video) => Promise<void>;
  playWithQueue: (videos: Video[], startIndex?: number) => Promise<void>;
  playNext: () => Promise<void>;
  playPrev: () => Promise<void>;
  quit: () => Promise<void>;
  pauseResume: () => Promise<void>;
  seekTo: (seconds: number) => Promise<void>;
  toggleLoop: () => Promise<void>;
  toggleShuffle: () => void;
  playShuffleAll: () => Promise<void>;
}

// モジュールレベルで一度だけリスナーを登録する
let listenersInitialized = false;

function initListeners(
  set: (s: Partial<PlayerState>) => void,
  get: () => PlayerState & PlayerActions,
) {
  if (listenersInitialized) return;
  listenersInitialized = true;

  // mpv のプロパティ変化をリアルタイムで受信
  listen<number>('mpv://playback-time', (e) => {
    set({ playbackTime: e.payload });
  });

  listen<boolean>('mpv://pause', (e) => {
    set({ isPaused: e.payload });
  });

  listen<number>('mpv://duration', (e) => {
    set({ duration: e.payload });
  });

  // ファイルが自然終了した場合 → ループ中はスキップ、キューがあれば次へ進む
  listen<string>('mpv://end-file', async (e) => {
    if (e.payload !== 'eof') return;
    const { queue, queueIndex, isLooping } = get();
    if (isLooping) return;
    if (queue.length > 0 && queueIndex < queue.length - 1) {
      await get().playNext();
    }
  });

  // mpv プロセスが終了した場合 → 進捗を保存してステートをリセット
  listen('mpv://closed', async () => {
    const { currentVideo, playbackTime } = get();
    if (currentVideo && playbackTime > 0) {
      await useLibraryStore.getState().updateProgress(currentVideo.id, playbackTime);
    }
    set({
      currentVideo: null,
      playbackTime: 0,
      duration: 0,
      isPaused: false,
      queue: [],
      queueIndex: -1,
    });
  });
}

async function invokPlay(video: Video) {
  await invoke('play', { path: video.path }).catch((e: unknown) => {
    console.error('play failed:', e);
    throw e;
  });
}

export const usePlayerStore = create<PlayerState & PlayerActions>((set, get) => {
  // ストア生成時にリスナーを登録（一度だけ）
  initListeners(set, get);

  return {
    currentVideo: null,
    playbackTime: 0,
    duration: 0,
    isPaused: false,
    isLooping: false,
    isShuffle: false,
    queue: [],
    queueIndex: -1,
    originalQueue: [],

    play: async (video: Video) => {
      const { isLooping } = get();
      await invokPlay(video);
      if (isLooping) {
        try { await invoke('set_loop', { enabled: true }); } catch { /* mpv not ready */ }
      }
      set({
        currentVideo: video,
        playbackTime: 0,
        duration: 0,
        isPaused: false,
        queue: [],
        queueIndex: -1,
      });
    },

    playWithQueue: async (videos: Video[], startIndex = 0) => {
      if (videos.length === 0) return;
      const { isShuffle, isLooping } = get();

      let queue = [...videos];
      let idx = Math.max(0, Math.min(startIndex, videos.length - 1));
      let originalQueue: Video[] = [];

      if (isShuffle && videos.length > 1) {
        const current = queue[idx];
        const rest = queue.filter((_, i) => i !== idx);
        for (let i = rest.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [rest[i], rest[j]] = [rest[j], rest[i]];
        }
        originalQueue = [...videos];
        queue = [current, ...rest];
        idx = 0;
      }

      await invokPlay(queue[idx]);
      if (isLooping) {
        try { await invoke('set_loop', { enabled: true }); } catch { /* mpv not ready */ }
      }
      set({
        currentVideo: queue[idx],
        playbackTime: 0,
        duration: 0,
        isPaused: false,
        queue,
        queueIndex: idx,
        originalQueue,
      });
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
      set({
        currentVideo: nextVideo,
        playbackTime: 0,
        duration: 0,
        isPaused: false,
        queueIndex: nextIdx,
      });
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
      set({
        currentVideo: prevVideo,
        playbackTime: 0,
        duration: 0,
        isPaused: false,
        queueIndex: prevIdx,
      });
    },

    quit: async () => {
      const { currentVideo, playbackTime } = get();
      if (currentVideo && playbackTime > 0) {
        await useLibraryStore.getState().updateProgress(currentVideo.id, playbackTime);
      }
      try {
        await invoke('quit_mpv');
      } catch {
        // mpv が既に終了していても続行
      }
      set({
        currentVideo: null,
        playbackTime: 0,
        duration: 0,
        isPaused: false,
        queue: [],
        queueIndex: -1,
      });
    },

    pauseResume: async () => {
      try {
        await invoke('pause_resume');
      } catch {
        // 無視
      }
    },

    seekTo: async (seconds: number) => {
      try {
        await invoke('seek', { seconds });
      } catch {
        // 無視
      }
    },

    toggleLoop: async () => {
      const next = !get().isLooping;
      set({ isLooping: next });
      try {
        await invoke('set_loop', { enabled: next });
      } catch {
        // 無視
      }
    },

    toggleShuffle: () => {
      const { isShuffle, queue, queueIndex, originalQueue } = get();

      if (!isShuffle) {
        const current = queue[queueIndex];
        if (!current || queue.length <= 1) {
          set({ isShuffle: !isShuffle });
          return;
        }
        const rest = queue.filter((_, i) => i !== queueIndex);
        for (let i = rest.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [rest[i], rest[j]] = [rest[j], rest[i]];
        }
        set({
          isShuffle: true,
          originalQueue: queue,
          queue: [current, ...rest],
          queueIndex: 0,
        });
      } else {
        const current = queue[queueIndex];
        const restored = originalQueue.length > 0 ? originalQueue : queue;
        const newIndex = current ? restored.findIndex((v) => v.id === current.id) : -1;
        set({
          isShuffle: false,
          originalQueue: [],
          queue: restored,
          queueIndex: newIndex >= 0 ? newIndex : 0,
        });
      }
    },

    playShuffleAll: async () => {
      const { isLooping } = get();
      const allVideos = await useLibraryStore.getState().fetchAllForShuffle();
      if (allVideos.length === 0) return;

      const shuffled = [...allVideos];
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
      }

      await invokPlay(shuffled[0]);
      if (isLooping) {
        try { await invoke('set_loop', { enabled: true }); } catch { /* mpv not ready */ }
      }
      set({
        currentVideo: shuffled[0],
        playbackTime: 0,
        duration: 0,
        isPaused: false,
        isShuffle: true,
        originalQueue: [],
        queue: shuffled,
        queueIndex: 0,
      });
    },
  };
});
