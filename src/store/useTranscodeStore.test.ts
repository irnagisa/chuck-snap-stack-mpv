import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(() => Promise.resolve(() => {})) }));

import { invoke } from '@tauri-apps/api/core';
import { useTranscodeStore, type EnqueueOptions, type TranscodeOutcome } from './useTranscodeStore';

const mockInvoke = vi.mocked(invoke);

/** transcode_video の呼び出しごとに resolve / reject を外から制御する */
let pending: {
  path: string;
  resolve: (out: string) => void;
  discard: (inputBytes: number, outputBytes: number) => void;
  reject: (e: unknown) => void;
}[] = [];

function makeOpts(path: string, overrides: Partial<EnqueueOptions> = {}): EnqueueOptions {
  return {
    videoPath: path,
    videoName: path.split('/').pop() ?? path,
    durationSecs: 60,
    mode: { kind: 'av1', crf: 32, preset: 8 },
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
      return new Promise<TranscodeOutcome>((resolve, reject) => {
        pending.push({
          path: String(args?.inputPath),
          resolve: (out) => resolve({ status: 'done', outputPath: out }),
          discard: (inputBytes, outputBytes) => resolve({ status: 'discarded', inputBytes, outputBytes }),
          reject,
        });
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

describe('removedSourcePaths', () => {
  it('records only sources marked as removed, and keeps them across batches', async () => {
    useTranscodeStore.setState({ removedSourcePaths: new Set() });
    const s = useTranscodeStore.getState();
    // 元ファイルを残した変換は記録しない
    s.enqueue(makeOpts('/v/kept.mp4'));
    s.enqueue(
      makeOpts('/v/trashed.mp4', {
        onSuccess: vi.fn(async () => useTranscodeStore.getState().markSourceRemoved('/v/trashed.mp4')),
      }),
    );
    await flush();
    pending[0].resolve('/v/kept.av1.mkv');
    await flush();
    pending[1].resolve('/v/trashed.av1.mkv');
    await flush();
    expect([...useTranscodeStore.getState().removedSourcePaths]).toEqual(['/v/trashed.mp4']);

    useTranscodeStore.getState().dismiss();
    expect([...useTranscodeStore.getState().removedSourcePaths]).toEqual(['/v/trashed.mp4']);
  });
});

describe('discarded', () => {
  it('counts a discarded job without calling onSuccess and continues', async () => {
    const onSuccess = vi.fn(() => Promise.resolve());
    const s = useTranscodeStore.getState();
    s.enqueue(makeOpts('/v/a.mp4', { onSuccess }));
    s.enqueue(makeOpts('/v/b.mp4'));
    await flush();

    pending[0].discard(1000, 950);
    await flush();
    expect(onSuccess).not.toHaveBeenCalled();
    expect(pending.map((p) => p.path)).toEqual(['/v/a.mp4', '/v/b.mp4']);
    expect(useTranscodeStore.getState().batch).toMatchObject({ discarded: 1, lastDiscardedName: 'a.mp4' });

    pending[1].resolve('/v/b.av1.mkv');
    await flush();
    const st = useTranscodeStore.getState();
    expect(st.isDone).toBe(true);
    expect(st.batch).toMatchObject({ total: 2, succeeded: 1, failed: 0, discarded: 1 });
    // 破棄したジョブは変換前後サイズの集計に含めない
    expect(st.batch.inputSizeBytes).toBe(1000);
  });

  it('shows the result even when every job was discarded', async () => {
    useTranscodeStore.getState().enqueue(makeOpts('/v/a.mp4'));
    await flush();
    pending[0].discard(1000, 990);
    await flush();
    const st = useTranscodeStore.getState();
    expect(st.isDone).toBe(true);
    expect(st.batch).toMatchObject({ total: 1, succeeded: 0, discarded: 1 });
  });
});

describe('discardedPaths', () => {
  it('records only re-encodes (AV1 / HEVC) that were discarded', async () => {
    useTranscodeStore.setState({ discardedPaths: new Set() });
    const s = useTranscodeStore.getState();
    s.enqueue(makeOpts('/v/av1.mp4'));
    s.enqueue(makeOpts('/v/hevc.mp4', { mode: { kind: 'hevc', bitratePercent: 50 } }));
    s.enqueue(makeOpts('/v/audio.mp4', { mode: { kind: 'audio' } }));
    s.enqueue(makeOpts('/v/done.mp4'));
    for (let i = 0; i < 3; i++) {
      await flush();
      pending[i].discard(1000, 990);
    }
    await flush();
    pending[3].resolve('/v/done.av1.mkv');
    await flush();
    expect([...useTranscodeStore.getState().discardedPaths]).toEqual(['/v/av1.mp4', '/v/hevc.mp4']);
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

describe('prepare', () => {
  it('uses the mode returned right before running', async () => {
    const prepare = vi.fn(() => Promise.resolve({ kind: 'dropStreams' as const, streams: [2] }));
    useTranscodeStore.getState().enqueue(makeOpts('/v/a.mp4', { mode: { kind: 'dropStreams', streams: [1, 2] }, prepare }));
    await flush();
    await flush();

    expect(prepare).toHaveBeenCalledTimes(1);
    expect(mockInvoke).toHaveBeenCalledWith('transcode_video', {
      inputPath: '/v/a.mp4',
      durationSecs: 60,
      mode: { kind: 'dropStreams', streams: [2] },
    });
  });

  it('skips the job when prepare returns null and moves on', async () => {
    const s = useTranscodeStore.getState();
    s.enqueue(makeOpts('/v/a.mp4', { prepare: () => Promise.resolve(null) }));
    s.enqueue(makeOpts('/v/b.mp4'));
    await flush();
    await flush();

    expect(pending.map((p) => p.path)).toEqual(['/v/b.mp4']);
    expect(useTranscodeStore.getState().batch.total).toBe(1);
    pending[0].resolve('/v/b.av1.mkv');
    await flush();
    expect(useTranscodeStore.getState().batch).toMatchObject({ total: 1, succeeded: 1 });
  });
});
