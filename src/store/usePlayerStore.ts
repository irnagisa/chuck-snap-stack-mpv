import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import type { Video, Chapter } from '../types';
import { useLibraryStore } from './useLibraryStore';
import { useSettingsStore } from './useSettingsStore';
import { toast } from './useToastStore';

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

  // listen() 失敗時はログを出してノーオペレーションを返す
  const safeListen = <T>(event: string, handler: Parameters<typeof listen<T>>[1]) => {
    const p = listen<T>(event, handler).catch((e: unknown) => {
      console.error(`[initListeners] "${event}" リスナー登録失敗:`, e);
      return () => {};
    });
    unlistenFns.push(p);
  };

  // mpv のプロパティ変化をリアルタイムで受信
  safeListen<number>('mpv://playback-time', (e) => {
    set({ playbackTime: e.payload });
  });

  safeListen<boolean>('mpv://pause', (e) => {
    set({ isPaused: e.payload });
  });

  safeListen<number>('mpv://duration', (e) => {
    set({ duration: e.payload });
  });

  // ファイルが自然終了した場合 → ループ中はスキップ、自動再生ON かつキューがあれば次へ、なければ終了
  safeListen<string>('mpv://end-file', async (e) => {
    if (e.payload !== 'eof') return;
    const { queue, queueIndex, isLooping } = get();
    if (isLooping) return;
    const { autoPlayNext } = useSettingsStore.getState();
    if (autoPlayNext && queue.length > 0 && queueIndex < queue.length - 1) {
      await get().playNext();
    } else {
      await get().quit();
    }
  });

  // mpv プロセスが終了した場合 → 進捗を保存してステートをリセット
  safeListen('mpv://closed', async () => {
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
  });
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
      // duration/playbackTime は invokePlay の前にリセットする。
      // await 中に mpv から duration イベントが届く場合があり、後でリセットすると上書きしてしまう。
      set({ playbackTime: 0, duration: 0, abLoopA: null, abLoopB: null, chapters: [] });
      await invokePlay(video);
      if (isLooping) {
        try { await invoke('set_loop', { enabled: true }); } catch { /* mpv not ready */ }
      }
      set({
        currentVideo: video,
        isPaused: false,
        queue: [],
        queueIndex: -1,
      });
      useLibraryStore.getState().incrementWatchCount(video.id).catch(() => {});
      invoke<Chapter[]>('get_chapters', { videoPath: video.path })
        .then((chapters) => set({ chapters }))
        .catch(() => { set({ chapters: [] }); });
    },

    playWithQueue: async (videos: Video[], startIndex = 0) => {
      // 画像は mpv 非対応のためキューから除外する
      const playable = videos.filter((v) => v.media_type !== 'image');
      if (playable.length === 0) return;
      const { isShuffle, isLooping } = get();

      // startIndex が指す動画を playable 内で再探索する
      const targetId = videos[Math.max(0, Math.min(startIndex, videos.length - 1))]?.id;
      const playableIdx = targetId != null ? playable.findIndex((v) => v.id === targetId) : -1;

      let queue = [...playable];
      let idx = Math.max(0, playableIdx >= 0 ? playableIdx : 0);
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

      set({ playbackTime: 0, duration: 0, abLoopA: null, abLoopB: null, chapters: [] });
      await invokePlay(queue[idx]);
      if (isLooping) {
        try { await invoke('set_loop', { enabled: true }); } catch { /* mpv not ready */ }
      }
      set({
        currentVideo: queue[idx],
        isPaused: false,
        queue,
        queueIndex: idx,
        originalQueue,
      });
      useLibraryStore.getState().incrementWatchCount(queue[idx].id).catch(() => {});
      invoke<Chapter[]>('get_chapters', { videoPath: queue[idx].path })
        .then((chapters) => set({ chapters }))
        .catch(() => { set({ chapters: [] }); });
    },

    playNext: async () => {
      const { queue, queueIndex, currentVideo, playbackTime } = get();
      if (currentVideo && playbackTime > 0) {
        await useLibraryStore.getState().updateProgress(currentVideo.id, playbackTime);
      }
      if (queue.length === 0 || queueIndex >= queue.length - 1) return;
      const nextIdx = queueIndex + 1;
      const nextVideo = queue[nextIdx];
      set({ playbackTime: 0, duration: 0, abLoopA: null, abLoopB: null, chapters: [] });
      await invokePlay(nextVideo);
      set({
        currentVideo: nextVideo,
        isPaused: false,
        queueIndex: nextIdx,
      });
      useLibraryStore.getState().incrementWatchCount(nextVideo.id).catch(() => {});
      invoke<Chapter[]>('get_chapters', { videoPath: nextVideo.path })
        .then((chapters) => set({ chapters }))
        .catch(() => { set({ chapters: [] }); });
    },

    playPrev: async () => {
      const { queue, queueIndex, currentVideo, playbackTime } = get();
      if (currentVideo && playbackTime > 0) {
        await useLibraryStore.getState().updateProgress(currentVideo.id, playbackTime);
      }
      if (queue.length === 0 || queueIndex <= 0) return;
      const prevIdx = queueIndex - 1;
      const prevVideo = queue[prevIdx];
      set({ playbackTime: 0, duration: 0, abLoopA: null, abLoopB: null, chapters: [] });
      await invokePlay(prevVideo);
      set({
        currentVideo: prevVideo,
        isPaused: false,
        queueIndex: prevIdx,
      });
      useLibraryStore.getState().incrementWatchCount(prevVideo.id).catch(() => {});
      invoke<Chapter[]>('get_chapters', { videoPath: prevVideo.path })
        .then((chapters) => set({ chapters }))
        .catch(() => { set({ chapters: [] }); });
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
      } catch (e) {
        // invoke 失敗時はステートを元に戻す
        set({ isLooping: !next });
        console.error('[toggleLoop] set_loop 失敗:', e);
      }
    },

    toggleMiniPlayer: () => {
      const next = !get().isMiniPlayer;
      set({ isMiniPlayer: next });
      const cmd = next ? 'enter_mini_player' : 'exit_mini_player';
      invoke(cmd).catch((e: unknown) => {
        console.error(`[toggleMiniPlayer] ${cmd} 失敗:`, e);
        // invoke 失敗時はステートを元に戻す
        set({ isMiniPlayer: !next });
      });
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
      try {
        const { isLooping } = get();
        const allVideos = (await useLibraryStore.getState().fetchAllForShuffle())
          .filter((v) => v.media_type !== 'image');
        if (allVideos.length === 0) return;

        const shuffled = [...allVideos];
        for (let i = shuffled.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
        }

        set({ playbackTime: 0, duration: 0, abLoopA: null, abLoopB: null, chapters: [] });
        await invokePlay(shuffled[0]);
        if (isLooping) {
          try { await invoke('set_loop', { enabled: true }); } catch { /* mpv not ready */ }
        }
        set({
          currentVideo: shuffled[0],
          isPaused: false,
          isShuffle: true,
          originalQueue: [],
          queue: shuffled,
          queueIndex: 0,
        });
        useLibraryStore.getState().incrementWatchCount(shuffled[0].id).catch(() => {});
        invoke<Chapter[]>('get_chapters', { videoPath: shuffled[0].path })
          .then((chapters) => set({ chapters }))
          .catch(() => { set({ chapters: [] }); });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error('[playShuffleAll] エラー:', e);
        toast.error(`シャッフル再生に失敗しました: ${msg}`);
      }
    },

    setSpeed: async (speed: number) => {
      const prevSpeed = get().speed;
      set({ speed });
      try {
        await invoke('set_playback_speed', { speed });
      } catch (e) {
        // invoke 失敗時はステートを元に戻す
        set({ speed: prevSpeed });
        console.error('[setSpeed] set_playback_speed 失敗:', e);
      }
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
      set({ playbackTime: 0, duration: 0, abLoopA: null, abLoopB: null, chapters: [] });
      await invokePlay(video);
      set({
        currentVideo: video,
        isPaused: false,
        queueIndex: index,
      });
      useLibraryStore.getState().incrementWatchCount(video.id).catch(() => {});
      invoke<Chapter[]>('get_chapters', { videoPath: video.path })
        .then((chapters) => set({ chapters }))
        .catch(() => { set({ chapters: [] }); });
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
