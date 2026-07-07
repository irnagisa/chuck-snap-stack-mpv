import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(() => Promise.resolve(() => {})) }));
vi.mock('@tauri-apps/api/path', () => ({
  appCacheDir: vi.fn(() => Promise.resolve('/tmp')),
  join: vi.fn((...parts: string[]) => Promise.resolve(parts.join('/'))),
}));
vi.mock('./useLibraryStore', () => ({
  useLibraryStore: {
    getState: vi.fn(() => ({
      fetchAllForShuffle: vi.fn(() => Promise.resolve([])),
    })),
  },
}));

import { usePlayerStore } from './usePlayerStore';
import type { Video } from '../types';

function makeVideo(id: number): Video {
  return {
    id,
    path: `/tmp/video${id}.mp4`,
    title: `Video ${id}`,
    duration: 100,
    thumbnail: null,
    watched_at: null,
    progress: 0,
    rating: 0,
    category_id: null,
    has_audio: null,
    watch_count: 0,
    created_at: '2024-01-01',
    media_type: 'video',
    source_url: null,
    status: null,
    source_type: null,
  };
}

const initialState = {
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
};

beforeEach(() => {
  usePlayerStore.setState(initialState);
});

describe('toggleShuffle ON', () => {
  it('puts current video first, shuffles rest, saves originalQueue, sets queueIndex to 0', async () => {
    const v1 = makeVideo(1);
    const v2 = makeVideo(2);
    const v3 = makeVideo(3);
    // fetchAllForShuffle が失敗した場合のフォールバック: 現在のキューでシャッフル
    const { useLibraryStore } = await import('./useLibraryStore');
    vi.mocked(useLibraryStore.getState).mockReturnValue({
      fetchAllForShuffle: vi.fn(() => Promise.resolve([v1, v2, v3])),
    } as never);
    usePlayerStore.setState({
      isShuffle: false,
      queue: [v1, v2, v3],
      queueIndex: 1,
      currentVideo: v2,
      originalQueue: [],
    });

    await usePlayerStore.getState().toggleShuffle();

    const state = usePlayerStore.getState();
    expect(state.isShuffle).toBe(true);
    expect(state.queue[0]).toEqual(v2);
    expect(state.queueIndex).toBe(0);
    expect(state.originalQueue).toEqual([v1, v2, v3]);
    expect(state.queue).toHaveLength(3);
    // All original videos present
    expect(state.queue.map((v) => v.id).sort()).toEqual([1, 2, 3]);
  });
});

describe('toggleShuffle ON — empty queue', () => {
  it('sets isShuffle to true even when queue is empty', async () => {
    usePlayerStore.setState({ queue: [], currentVideo: null, isShuffle: false });

    await usePlayerStore.getState().toggleShuffle();

    expect(usePlayerStore.getState().isShuffle).toBe(true);
    expect(usePlayerStore.getState().queue).toEqual([]);
  });
});

describe('toggleShuffle OFF', () => {
  it('restores originalQueue and finds current video index', () => {
    const v1 = makeVideo(1);
    const v2 = makeVideo(2);
    const v3 = makeVideo(3);
    usePlayerStore.setState({
      isShuffle: true,
      queue: [v2, v3, v1],
      queueIndex: 0,
      currentVideo: v2,
      originalQueue: [v1, v2, v3],
    });

    usePlayerStore.getState().toggleShuffle();

    const state = usePlayerStore.getState();
    expect(state.isShuffle).toBe(false);
    expect(state.queue).toEqual([v1, v2, v3]);
    expect(state.queueIndex).toBe(1); // v2 is at index 1 in originalQueue
    expect(state.originalQueue).toEqual([]);
  });
});

describe('removeFromQueue', () => {
  it('decrements queueIndex when removing an item before current', () => {
    const v1 = makeVideo(1);
    const v2 = makeVideo(2);
    const v3 = makeVideo(3);
    usePlayerStore.setState({
      queue: [v1, v2, v3],
      queueIndex: 2,
      currentVideo: v3,
    });

    usePlayerStore.getState().removeFromQueue(v1.id);

    const state = usePlayerStore.getState();
    expect(state.queue).toEqual([v2, v3]);
    expect(state.queueIndex).toBe(1);
  });

  it('clamps queueIndex with Math.min when removing current (last item)', () => {
    const v1 = makeVideo(1);
    const v2 = makeVideo(2);
    const v3 = makeVideo(3);
    usePlayerStore.setState({
      queue: [v1, v2, v3],
      queueIndex: 2,
      currentVideo: v3,
    });

    usePlayerStore.getState().removeFromQueue(v3.id);

    const state = usePlayerStore.getState();
    expect(state.queue).toEqual([v1, v2]);
    expect(state.queueIndex).toBe(1); // Math.min(2, 2-1) = 1
  });

  it('keeps queueIndex unchanged when removing an item after current', () => {
    const v1 = makeVideo(1);
    const v2 = makeVideo(2);
    const v3 = makeVideo(3);
    usePlayerStore.setState({
      queue: [v1, v2, v3],
      queueIndex: 0,
      currentVideo: v1,
    });

    usePlayerStore.getState().removeFromQueue(v3.id);

    const state = usePlayerStore.getState();
    expect(state.queue).toEqual([v1, v2]);
    expect(state.queueIndex).toBe(0);
  });

  it('does nothing when removing a non-existent id', () => {
    const v1 = makeVideo(1);
    const v2 = makeVideo(2);
    usePlayerStore.setState({ queue: [v1, v2], queueIndex: 0, currentVideo: v1 });

    usePlayerStore.getState().removeFromQueue(999);

    const state = usePlayerStore.getState();
    expect(state.queue).toEqual([v1, v2]);
    expect(state.queueIndex).toBe(0);
  });
});

describe('reorderQueue', () => {
  it('updates queue and finds the new index of currentVideo', () => {
    const v1 = makeVideo(1);
    const v2 = makeVideo(2);
    const v3 = makeVideo(3);
    usePlayerStore.setState({
      queue: [v1, v2, v3],
      queueIndex: 0,
      currentVideo: v1,
    });

    usePlayerStore.getState().reorderQueue([v3, v1, v2]);

    const state = usePlayerStore.getState();
    expect(state.queue).toEqual([v3, v1, v2]);
    expect(state.queueIndex).toBe(1); // v1 is now at index 1
  });
});
