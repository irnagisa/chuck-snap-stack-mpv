import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(() => Promise.resolve(() => {})) }));

import { invoke } from '@tauri-apps/api/core';
import { useTranscodeStore, type EnqueueOptions } from './useTranscodeStore';

const mockInvoke = vi.mocked(invoke);

/** transcode_video の呼び出しごとに resolve / reject を外から制御する */
let pending: { path: string; resolve: (out: string) => void; reject: (e: unknown) => void }[] = [];

function makeOpts(path: string, overrides: Partial<EnqueueOptions> = {}): EnqueueOptions {
  return {
    videoPath: path,
    videoName: path.split('/').pop() ?? path,
    durationSecs: 60,
    crf: 32,
    preset: 8,
    onSuccess: vi.fn(() => Promise.resolve()),
    ...overrides,
  };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(async () => {
  // 前のテストの処理ループを終わらせる
  await useTranscodeStore.getState().cancelAll();
  pending.forEach((p) => p.reject('キャンセルされました'));
  await flush();
  pending = [];
  vi.clearAllMocks();
  mockInvoke.mockImplementation(((cmd: string, args?: Record<string, unknown>) => {
    if (cmd === 'get_file_size') {
      return String(args?.path).endsWith('missing.mp4') ? Promise.reject('not found') : Promise.resolve(1000);
    }
    if (cmd === 'transcode_video') {
      return new Promise<string>((resolve, reject) => {
        pending.push({ path: String(args?.inputPath), resolve, reject });
      });
    }
    return Promise.resolve();
  }) as typeof invoke);
  useTranscodeStore.getState().dismiss();
});

describe('enqueue', () => {
  it('runs jobs one at a time in order', async () => {
    const s = useTranscodeStore.getState();
    s.enqueue(makeOpts('/v/a.mp4'));
    s.enqueue(makeOpts('/v/b.mp4'));
    await flush();

    expect(pending.map((p) => p.path)).toEqual(['/v/a.mp4']);
    expect(useTranscodeStore.getState().current?.videoPath).toBe('/v/a.mp4');
    expect(useTranscodeStore.getState().queue.map((j) => j.videoPath)).toEqual(['/v/b.mp4']);

    pending[0].resolve('/v/a.av1.mkv');
    await flush();
    expect(pending.map((p) => p.path)).toEqual(['/v/a.mp4', '/v/b.mp4']);

    pending[1].resolve('/v/b.av1.mkv');
    await flush();
    const st = useTranscodeStore.getState();
    expect(st.current).toBeNull();
    expect(st.isDone).toBe(true);
    expect(st.batch).toMatchObject({ total: 2, succeeded: 2, failed: 0 });
  });

  it('waits for onSuccess before starting the next job', async () => {
    let finishOnSuccess!: () => void;
    const onSuccess = vi.fn(() => new Promise<void>((r) => { finishOnSuccess = r; }));
    const s = useTranscodeStore.getState();
    s.enqueue(makeOpts('/v/a.mp4', { onSuccess }));
    s.enqueue(makeOpts('/v/b.mp4'));
    await flush();

    pending[0].resolve('/v/a.av1.mkv');
    await flush();
    expect(onSuccess).toHaveBeenCalledWith('/v/a.av1.mkv');
    expect(pending).toHaveLength(1);

    finishOnSuccess();
    await flush();
    expect(pending).toHaveLength(2);
  });

  it('rejects a file that is already running or queued', async () => {
    const s = useTranscodeStore.getState();
    expect(s.enqueue(makeOpts('/v/a.mp4'))).toBe(true);
    expect(s.enqueue(makeOpts('/v/b.mp4'))).toBe(true);
    expect(s.enqueue(makeOpts('/v/a.mp4'))).toBe(false);
    expect(s.enqueue(makeOpts('/v/b.mp4'))).toBe(false);
    expect(useTranscodeStore.getState().batch.total).toBe(2);
  });

  it('continues with the next job after a failure', async () => {
    const s = useTranscodeStore.getState();
    s.enqueue(makeOpts('/v/missing.mp4'));
    s.enqueue(makeOpts('/v/b.mp4'));
    await flush();

    expect(pending.map((p) => p.path)).toEqual(['/v/b.mp4']);
    pending[0].resolve('/v/b.av1.mkv');
    await flush();

    const st = useTranscodeStore.getState();
    expect(st.batch).toMatchObject({ total: 2, succeeded: 1, failed: 1 });
    expect(st.lastError?.videoName).toBe('missing.mp4');
  });
});

describe('cancel', () => {
  it('cancels only the running job and keeps processing the queue', async () => {
    const s = useTranscodeStore.getState();
    s.enqueue(makeOpts('/v/a.mp4'));
    s.enqueue(makeOpts('/v/b.mp4'));
    await flush();

    await s.cancel();
    expect(mockInvoke).toHaveBeenCalledWith('cancel_transcode');
    pending[0].reject('キャンセルされました');
    await flush();

    expect(pending.map((p) => p.path)).toEqual(['/v/a.mp4', '/v/b.mp4']);
    expect(useTranscodeStore.getState().batch.total).toBe(1);
  });

  it('cancelAll clears the queue and hides the status when nothing finished', async () => {
    const s = useTranscodeStore.getState();
    s.enqueue(makeOpts('/v/a.mp4'));
    s.enqueue(makeOpts('/v/b.mp4'));
    await flush();

    await s.cancelAll();
    pending[0].reject('キャンセルされました');
    await flush();

    const st = useTranscodeStore.getState();
    expect(pending).toHaveLength(1);
    expect(st.current).toBeNull();
    expect(st.queue).toEqual([]);
    expect(st.isDone).toBe(false);
  });

  it('removeFromQueue drops a waiting job', async () => {
    const s = useTranscodeStore.getState();
    s.enqueue(makeOpts('/v/a.mp4'));
    s.enqueue(makeOpts('/v/b.mp4'));
    s.enqueue(makeOpts('/v/c.mp4'));
    await flush();

    const b = useTranscodeStore.getState().queue.find((j) => j.videoPath === '/v/b.mp4')!;
    s.removeFromQueue(b.id);
    pending[0].resolve('/v/a.av1.mkv');
    await flush();

    expect(pending.map((p) => p.path)).toEqual(['/v/a.mp4', '/v/c.mp4']);
    expect(useTranscodeStore.getState().batch.total).toBe(2);
  });
});
