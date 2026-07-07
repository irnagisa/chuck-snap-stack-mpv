import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/path', () => ({
  appCacheDir: vi.fn(() => Promise.resolve('/cache')),
  join: vi.fn((...parts: string[]) => Promise.resolve(parts.join('/'))),
}));

import { invoke } from '@tauri-apps/api/core';
import { generateThumbnailsWorker, rescanVideoWorker, rescanMultipleWorker } from './thumbnailUtils';
import type { Video } from '../types';

const mockInvoke = vi.mocked(invoke);

function makeVideo(overrides: Partial<Video> = {}): Video {
  return {
    id: 1,
    path: '/tmp/video.mp4',
    title: 'Test',
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
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ── generateThumbnailsWorker ───────────────────────────────────────────────

describe('generateThumbnailsWorker', () => {
  it('does nothing if already generating', async () => {
    const get = vi.fn(() => ({ isThumbnailGenerating: true, isThumbnailPaused: false, isScanning: false, thumbnailProgress: null, videos: [] }));
    const set = vi.fn();
    const onDone = vi.fn();

    await generateThumbnailsWorker(get as never, set as never, onDone);

    expect(mockInvoke).not.toHaveBeenCalled();
    expect(onDone).not.toHaveBeenCalled();
  });

  it('calls onDone and resets state when no pending thumbnails', async () => {
    let state = { isThumbnailGenerating: false, isThumbnailPaused: false, isScanning: false, thumbnailProgress: null, videos: [] };
    const get = vi.fn(() => state);
    const set = vi.fn((updater: unknown) => {
      if (typeof updater === 'function') {
        state = { ...state, ...(updater as (s: typeof state) => Partial<typeof state>)(state) };
      } else {
        state = { ...state, ...(updater as Partial<typeof state>) };
      }
    });
    const onDone = vi.fn(() => Promise.resolve());

    // db_get_pending_thumbnails returns empty → exits immediately
    mockInvoke.mockResolvedValueOnce([]);

    await generateThumbnailsWorker(get as never, set as never, onDone);

    expect(onDone).toHaveBeenCalledOnce();
    expect(state.isThumbnailGenerating).toBe(false);
    expect(state.thumbnailProgress).toBeNull();
  });
});

// ── rescanVideoWorker ──────────────────────────────────────────────────────

describe('rescanVideoWorker', () => {
  it('calls generate_thumbnail and db_update_thumbnails_batch for a video file', async () => {
    const video = makeVideo({ path: '/tmp/video.mp4', thumbnail: null });
    mockInvoke.mockResolvedValueOnce({ thumbnail_path: '/cache/thumb.webp', duration: 120, has_audio: true });
    mockInvoke.mockResolvedValueOnce(undefined); // db_update_video
    mockInvoke.mockResolvedValueOnce(undefined); // db_update_thumbnails_batch
    const onDone = vi.fn(() => Promise.resolve());

    await rescanVideoWorker(video, onDone);

    const calls = mockInvoke.mock.calls.map((c) => c[0]);
    expect(calls).toContain('generate_thumbnail');
    expect(calls).toContain('db_update_video');
    expect(calls).toContain('db_update_thumbnails_batch');

    // thumbnail_path / duration / hasAudio が正しく DB に渡されることを確認
    const batchCall = mockInvoke.mock.calls.find((c) => c[0] === 'db_update_thumbnails_batch');
    expect(batchCall![1]).toEqual(
      expect.objectContaining({
        updates: [
          expect.objectContaining({ thumbnail: '/cache/thumb.webp', duration: 120, hasAudio: 1 }),
        ],
      })
    );

    expect(onDone).toHaveBeenCalledOnce();
  });

  it('skips generate_thumbnail for audio files and sets hasAudio=1', async () => {
    const video = makeVideo({ path: '/tmp/track.mp3', thumbnail: null });
    mockInvoke.mockResolvedValueOnce({ thumbnail_path: '/cache/audio.webp', duration: 200, has_audio: false });
    mockInvoke.mockResolvedValueOnce(undefined); // db_update_video
    mockInvoke.mockResolvedValueOnce(undefined); // db_update_thumbnails_batch
    const onDone = vi.fn(() => Promise.resolve());

    await rescanVideoWorker(video, onDone);

    const thumbCall = mockInvoke.mock.calls.find((c) => c[0] === 'db_update_thumbnails_batch');
    expect(thumbCall).toBeDefined();
    expect((thumbCall![1] as { updates: { hasAudio: number }[] }).updates[0].hasAudio).toBe(1);
    expect(onDone).toHaveBeenCalledOnce();
  });

  it('calls onDone even when generate_thumbnail throws', async () => {
    const video = makeVideo({ path: '/tmp/bad.mp4', thumbnail: null });
    mockInvoke.mockRejectedValueOnce(new Error('ffmpeg error'));
    const onDone = vi.fn(() => Promise.resolve());

    await rescanVideoWorker(video, onDone);

    expect(onDone).toHaveBeenCalledOnce();
  });
});

// ── rescanMultipleWorker ───────────────────────────────────────────────────

describe('rescanMultipleWorker', () => {
  it('processes all videos and calls onDone', async () => {
    const videos = [
      makeVideo({ id: 1, path: '/a.mp4', thumbnail: null }),
      makeVideo({ id: 2, path: '/b.mp4', thumbnail: null }),
    ];
    // generate_thumbnail × 2, db_update_video × 2, db_update_thumbnails_batch × 2
    mockInvoke.mockResolvedValue({ thumbnail_path: '/t.webp', duration: 10, has_audio: true });
    const setProgress = vi.fn();
    const onDone = vi.fn(() => Promise.resolve());

    await rescanMultipleWorker(videos, setProgress, onDone);

    expect(setProgress).toHaveBeenCalled();
    const lastCall = setProgress.mock.calls[setProgress.mock.calls.length - 1];
    expect(lastCall).toEqual([2, 2]);
    expect(onDone).toHaveBeenCalledOnce();
  });

  it('calls onDone even when all thumbnails fail', async () => {
    const videos = [makeVideo({ id: 1, path: '/bad.mp4', thumbnail: null })];
    mockInvoke.mockRejectedValue(new Error('fail'));
    const onDone = vi.fn(() => Promise.resolve());

    await rescanMultipleWorker(videos, vi.fn(), onDone);

    expect(onDone).toHaveBeenCalledOnce();
  });
});
