import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import type { Video, Chapter } from '../types';
import { useLibraryStore } from './useLibraryStore';

interface PlayerState {
  currentVideo: Video | null;
  playbackTime: number;
  duration: number;
  isPaused: boolean;
  isLooping: boolean;
  isShuffle: boolean;
  isMiniPlayer: boolean;
  queue: Video[];
  queueIndex: number;
  originalQueue: Video[];
  speed: number;
  abLoopA: number | null;
  abLoopB: number | null;
  chapters: Chapter[];
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
  toggleMiniPlayer: () => void;
  playShuffleAll: () => Promise<void>;
  setSpeed: (speed: number) => Promise<void>;
  setAbLoopA: () => Promise<void>;
  setAbLoopB: () => Promise<void>;
  clearAbLoop: () => Promise<void>;
  setChapters: (chapters: Chapter[]) => void;
  reorderQueue: (newQueue: Video[]) => void;
  removeFromQueue: (videoId: number) => void;
  jumpToQueue: (index: number) => Promise<void>;
}

// モジュールレベルで一度だけリスナーを登録する
let listenersInitialized = false;
// HMR 時の重複登録防止: unlisten 関数を保持しておきモジュール破棄時に解除する
const unlistenFns: Promise<() => void>[] = [];

function initListeners(
  set: (s: Partial<PlayerState>) => void,
  get: () => PlayerState & PlayerActions,
) {
  if (listenersInitialized) return;
  listenersInitialized = true;

  // mpv のプロパティ変化をリアルタイムで受信
  unlistenFns.push(listen<number>('mpv://playback-time', (e) => {
    set({ playbackTime: e.payload });
  }));

  unlistenFns.push(listen<boolean>('mpv://pause', (e) => {
    set({ isPaused: e.payload });
  }));

  unlistenFns.push(listen<number>('mpv://duration', (e) => {
    set({ duration: e.payload });
  }));

  // ファイルが自然終了した場合 → ループ中はスキップ、キューがあれば次へ進む
  unlistenFns.push(listen<string>('mpv://end-file', async (e) => {
    if (e.payload !== 'eof') return;
    const { queue, queueIndex, isLooping } = get();
    if (isLooping) return;
    if (queue.length > 0 && queueIndex < queue.length - 1) {
      await get().playNext();
    }
  }));

  // mpv プロセスが終了した場合 → 進捗を保存してステートをリセット
  unlistenFns.push(listen('mpv://closed', async () => {
    const { currentVideo, playbackTime, isMiniPlayer } = get();
    if (currentVideo && playbackTime > 0) {
      await useLibraryStore.getState().updateProgress(currentVideo.id, playbackTime);
    }
    if (isMiniPlayer) {
      invoke('exit_mini_player').catch(console.error);
    }
    set({
      currentVideo: null,
      playbackTime: 0,
      duration: 0,
      isPaused: false,
      isMiniPlayer: false,
      queue: [],
      queueIndex: -1,
      originalQueue: [],
      abLoopA: null,
      abLoopB: null,
      chapters: [],
    });
  }));
}

async function invokePlay(video: Video) {
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
    isMiniPlayer: false,
    queue: [],
    queueIndex: -1,
    originalQueue: [],
    speed: 1.0,
    abLoopA: null,
    abLoopB: null,
    chapters: [],

    play: async (video: Video) => {
      const { isLooping } = get();
      await invokePlay(video);
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
        abLoopA: null,
        abLoopB: null,
        chapters: [],
      });
      useLibraryStore.getState().incrementWatchCount(video.id).catch(() => {});
      invoke<Chapter[]>('get_chapters', { videoPath: video.path })
        .then((chapters) => set({ chapters }))
        .catch(() => {});
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

      await invokePlay(queue[idx]);
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
        abLoopA: null,
        abLoopB: null,
        chapters: [],
      });
      useLibraryStore.getState().incrementWatchCount(queue[idx].id).catch(() => {});
      invoke<Chapter[]>('get_chapters', { videoPath: queue[idx].path })
        .then((chapters) => set({ chapters }))
        .catch(() => {});
    },

    playNext: async () => {
      const { queue, queueIndex, currentVideo, playbackTime } = get();
      if (currentVideo && playbackTime > 0) {
        await useLibraryStore.getState().updateProgress(currentVideo.id, playbackTime);
      }
      if (queue.length === 0 || queueIndex >= queue.length - 1) return;
      const nextIdx = queueIndex + 1;
      const nextVideo = queue[nextIdx];
      await invokePlay(nextVideo);
      set({
        currentVideo: nextVideo,
        playbackTime: 0,
        duration: 0,
        isPaused: false,
        queueIndex: nextIdx,
        abLoopA: null,
        abLoopB: null,
        chapters: [],
      });
      useLibraryStore.getState().incrementWatchCount(nextVideo.id).catch(() => {});
      invoke<Chapter[]>('get_chapters', { videoPath: nextVideo.path })
        .then((chapters) => set({ chapters }))
        .catch(() => {});
    },

    playPrev: async () => {
      const { queue, queueIndex, currentVideo, playbackTime } = get();
      if (currentVideo && playbackTime > 0) {
        await useLibraryStore.getState().updateProgress(currentVideo.id, playbackTime);
      }
      if (queue.length === 0 || queueIndex <= 0) return;
      const prevIdx = queueIndex - 1;
      const prevVideo = queue[prevIdx];
      await invokePlay(prevVideo);
      set({
        currentVideo: prevVideo,
        playbackTime: 0,
        duration: 0,
        isPaused: false,
        queueIndex: prevIdx,
        abLoopA: null,
        abLoopB: null,
        chapters: [],
      });
      useLibraryStore.getState().incrementWatchCount(prevVideo.id).catch(() => {});
      invoke<Chapter[]>('get_chapters', { videoPath: prevVideo.path })
        .then((chapters) => set({ chapters }))
        .catch(() => {});
    },

    quit: async () => {
      const { currentVideo, playbackTime, isMiniPlayer } = get();
      if (currentVideo && playbackTime > 0) {
        await useLibraryStore.getState().updateProgress(currentVideo.id, playbackTime);
      }
      if (isMiniPlayer) {
        invoke('exit_mini_player').catch(console.error);
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
        isMiniPlayer: false,
        queue: [],
        queueIndex: -1,
        originalQueue: [],
        abLoopA: null,
        abLoopB: null,
        chapters: [],
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

    toggleMiniPlayer: () => {
      const next = !get().isMiniPlayer;
      set({ isMiniPlayer: next });
      if (next) {
        invoke('enter_mini_player').catch(console.error);
      } else {
        invoke('exit_mini_player').catch(console.error);
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

      await invokePlay(shuffled[0]);
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
        abLoopA: null,
        abLoopB: null,
        chapters: [],
      });
      useLibraryStore.getState().incrementWatchCount(shuffled[0].id).catch(() => {});
      invoke<Chapter[]>('get_chapters', { videoPath: shuffled[0].path })
        .then((chapters) => set({ chapters }))
        .catch(() => {});
    },

    setSpeed: async (speed: number) => {
      set({ speed });
      try {
        await invoke('set_playback_speed', { speed });
      } catch { /* 無視 */ }
    },

    setAbLoopA: async () => {
      const { playbackTime, abLoopA } = get();
      if (abLoopA !== null) {
        // A がすでにセット済みなら ab-loop コマンドで B に進む
        try { await invoke('set_ab_loop_b'); } catch { /* 無視 */ }
        set({ abLoopB: playbackTime });
      } else {
        try { await invoke('set_ab_loop_a'); } catch { /* 無視 */ }
        set({ abLoopA: playbackTime, abLoopB: null });
      }
    },

    setAbLoopB: async () => {
      const { playbackTime } = get();
      try { await invoke('set_ab_loop_b'); } catch { /* 無視 */ }
      set({ abLoopB: playbackTime });
    },

    clearAbLoop: async () => {
      try { await invoke('clear_ab_loop'); } catch { /* 無視 */ }
      set({ abLoopA: null, abLoopB: null });
    },

    setChapters: (chapters: Chapter[]) => {
      set({ chapters });
    },

    reorderQueue: (newQueue: Video[]) => {
      const { currentVideo } = get();
      const newIndex = currentVideo ? newQueue.findIndex((v) => v.id === currentVideo.id) : -1;
      set({ queue: newQueue, queueIndex: newIndex >= 0 ? newIndex : 0 });
    },

    removeFromQueue: (videoId: number) => {
      const { queue, queueIndex } = get();
      const removeIdx = queue.findIndex((v) => v.id === videoId);
      if (removeIdx === -1) return;
      const newQueue = queue.filter((_, i) => i !== removeIdx);
      const newIndex = removeIdx < queueIndex
        ? queueIndex - 1
        : removeIdx === queueIndex
          ? Math.min(queueIndex, newQueue.length - 1)
          : queueIndex;
      set({ queue: newQueue, queueIndex: newIndex });
    },

    jumpToQueue: async (index: number) => {
      const { queue, currentVideo, playbackTime } = get();
      if (index < 0 || index >= queue.length) return;
      if (currentVideo && playbackTime > 0) {
        await useLibraryStore.getState().updateProgress(currentVideo.id, playbackTime);
      }
      const video = queue[index];
      await invokePlay(video);
      set({
        currentVideo: video,
        playbackTime: 0,
        duration: 0,
        isPaused: false,
        queueIndex: index,
        abLoopA: null,
        abLoopB: null,
        chapters: [],
      });
      useLibraryStore.getState().incrementWatchCount(video.id).catch(() => {});
      invoke<Chapter[]>('get_chapters', { videoPath: video.path })
        .then((chapters) => set({ chapters }))
        .catch(() => {});
    },
  };
});

// HMR 時にリスナーを解除して重複登録を防ぐ
if (import.meta.hot) {
  import.meta.hot.dispose(async () => {
    const fns = await Promise.all(unlistenFns);
    fns.forEach((fn) => fn());
    unlistenFns.length = 0;
    listenersInitialized = false;
  });
}
