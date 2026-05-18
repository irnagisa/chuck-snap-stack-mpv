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
  queue: Video[];
  queueIndex: number;
}

interface PlayerActions {
  play: (video: Video) => Promise<void>;
  playWithQueue: (videos: Video[], startIndex?: number) => Promise<void>;
  playNext: () => Promise<void>;
  playPrev: () => Promise<void>;
  quit: () => Promise<void>;
  pauseResume: () => Promise<void>;
  seekTo: (seconds: number) => Promise<void>;
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

  // ファイルが自然終了した場合 → キューがあれば次へ進む
  listen<string>('mpv://end-file', async (e) => {
    if (e.payload !== 'eof') return;
    const { queue, queueIndex } = get();
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
  await invoke('play', { path: video.path });
}

export const usePlayerStore = create<PlayerState & PlayerActions>((set, get) => {
  // ストア生成時にリスナーを登録（一度だけ）
  initListeners(set, get);

  return {
    currentVideo: null,
    playbackTime: 0,
    duration: 0,
    isPaused: false,
    queue: [],
    queueIndex: -1,

    play: async (video: Video) => {
      await invokPlay(video);
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
      const idx = Math.max(0, Math.min(startIndex, videos.length - 1));
      await invokPlay(videos[idx]);
      set({
        currentVideo: videos[idx],
        playbackTime: 0,
        duration: 0,
        isPaused: false,
        queue: videos,
        queueIndex: idx,
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
  };
});
