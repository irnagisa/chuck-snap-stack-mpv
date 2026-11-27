import { describe, it, expect, vi, beforeEach } from 'vitest';
import { invoke } from '@tauri-apps/api/core';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('./useToastStore', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

import { coalesce, markInboxViewShown, notifyInboxChanged, useInboxStore } from './useInboxStore';

const mockInvoke = vi.mocked(invoke);

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => { resolve = r; });
  return { promise, resolve };
}

describe('coalesce', () => {
  it('does not overlap runs and reruns once for calls made while running', async () => {
    const gates: ReturnType<typeof deferred>[] = [];
    const run = vi.fn(() => {
      const g = deferred();
      gates.push(g);
      return g.promise;
    });
    const call = coalesce(run);

    const p1 = call();
    const p2 = call();
    const p3 = call();
    expect(run).toHaveBeenCalledTimes(1);

    gates[0].resolve();
    await vi.waitFor(() => expect(run).toHaveBeenCalledTimes(2));
    gates[1].resolve();
    await Promise.all([p1, p2, p3]);
    expect(run).toHaveBeenCalledTimes(2);

    // 終わった後の呼び出しは新しく 1 回走る
    const p4 = call();
    expect(run).toHaveBeenCalledTimes(3);
    gates[2].resolve();
    await p4;
  });

  it('lets later calls run after a failure', async () => {
    const run = vi.fn().mockRejectedValueOnce(new Error('x')).mockResolvedValue(undefined);
    const call = coalesce(run);
    await expect(call()).rejects.toThrow('x');
    await call();
    expect(run).toHaveBeenCalledTimes(2);
  });
});

describe('useInboxStore', () => {
  const stats = { total: 3, inboxCount: 2, missingCategory: 1, missingTags: 1, missingRating: 2, almostDone: 0 };

  beforeEach(() => {
    mockInvoke.mockReset();
    useInboxStore.setState({ videos: [], stats: null, isLoading: false });
  });

  it('refreshInboxStats reads only the stats', async () => {
    mockInvoke.mockResolvedValue(stats);
    await useInboxStore.getState().refreshInboxStats();
    expect(mockInvoke).toHaveBeenCalledTimes(1);
    expect(mockInvoke).toHaveBeenCalledWith('db_get_inbox_stats');
    expect(useInboxStore.getState().stats).toEqual(stats);
  });

  it('refreshInbox reloads the list without toggling isLoading', async () => {
    const seen: boolean[] = [];
    const unsub = useInboxStore.subscribe((s) => seen.push(s.isLoading));
    mockInvoke.mockImplementation(async (cmd) => (cmd === 'db_get_inbox_videos' ? [] : stats));
    await useInboxStore.getState().refreshInbox();
    unsub();
    expect(mockInvoke).toHaveBeenCalledWith('db_get_inbox_videos');
    expect(seen.every((v) => v === false)).toBe(true);
    expect(useInboxStore.getState().stats).toEqual(stats);
  });

  it('fetchInbox clears isLoading even when loading fails', async () => {
    mockInvoke.mockRejectedValue(new Error('db'));
    await useInboxStore.getState().fetchInbox();
    expect(useInboxStore.getState().isLoading).toBe(false);
  });

  it('notifyInboxChanged reads only the stats while the Inbox view is closed', async () => {
    mockInvoke.mockResolvedValue(stats);
    notifyInboxChanged();
    await vi.waitFor(() => expect(useInboxStore.getState().stats).toEqual(stats));
    expect(mockInvoke.mock.calls.map((c) => c[0])).toEqual(['db_get_inbox_stats']);
  });

  it('notifyInboxChanged reloads the list while the Inbox view is open', async () => {
    mockInvoke.mockImplementation(async (cmd) => (cmd === 'db_get_inbox_videos' ? [] : stats));
    const hide = markInboxViewShown();
    notifyInboxChanged();
    hide();
    await vi.waitFor(() => expect(useInboxStore.getState().stats).toEqual(stats));
    expect(mockInvoke).toHaveBeenCalledWith('db_get_inbox_videos');
  });
});
