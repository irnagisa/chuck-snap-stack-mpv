import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(() => new Promise(() => {})) }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(() => Promise.resolve(() => {})) }));
vi.mock('@tauri-apps/api/path', () => ({
  appCacheDir: vi.fn(() => Promise.resolve('/tmp')),
  join: vi.fn((...parts: string[]) => Promise.resolve(parts.join('/'))),
  basename: vi.fn(() => Promise.resolve('video.mp4')),
}));

import { invoke } from '@tauri-apps/api/core';
import { useDownloadStore, type DownloadJob } from './useDownloadStore';

function makeJob(overrides: Partial<DownloadJob> = {}): DownloadJob {
  return {
    id: 'job-1',
    url: 'https://example.com/v.mp4',
    saveDir: '/tmp',
    filename: 'v.mp4',
    useYtdlp: false,
    phase: 'queued',
    progress: { downloaded: 0, total: 0, percent: 0 },
    errorMsg: '',
    title: '',
    ...overrides,
  };
}

beforeEach(() => {
  useDownloadStore.setState({ jobs: [] });
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// addJob
// ---------------------------------------------------------------------------

describe('addJob', () => {
  it('adds a job to the jobs list', () => {
    useDownloadStore.getState().addJob({
      url: 'https://example.com/v.mp4',
      saveDir: '/tmp',
      filename: 'v.mp4',
      useYtdlp: false,
    });
    expect(useDownloadStore.getState().jobs).toHaveLength(1);
  });

  it('stores the provided url, saveDir, filename, useYtdlp', () => {
    useDownloadStore.getState().addJob({
      url: 'https://example.com/video.mp4',
      saveDir: '/downloads',
      filename: 'video.mp4',
      useYtdlp: true,
    });
    const job = useDownloadStore.getState().jobs[0];
    expect(job.url).toBe('https://example.com/video.mp4');
    expect(job.saveDir).toBe('/downloads');
    expect(job.filename).toBe('video.mp4');
    expect(job.useYtdlp).toBe(true);
  });

  it('assigns a unique id string', () => {
    useDownloadStore.getState().addJob({ url: 'https://a.com/a.mp4', saveDir: '/tmp', filename: 'a.mp4', useYtdlp: false });
    useDownloadStore.getState().addJob({ url: 'https://b.com/b.mp4', saveDir: '/tmp', filename: 'b.mp4', useYtdlp: false });
    const [j1, j2] = useDownloadStore.getState().jobs;
    expect(j1.id).toBeTruthy();
    expect(j2.id).toBeTruthy();
    expect(j1.id).not.toBe(j2.id);
  });
});

// ---------------------------------------------------------------------------
// dismissJob
// ---------------------------------------------------------------------------

describe('dismissJob', () => {
  it('removes the job with the given id', () => {
    useDownloadStore.setState({ jobs: [makeJob({ id: 'a' }), makeJob({ id: 'b' })] });
    useDownloadStore.getState().dismissJob('a');
    expect(useDownloadStore.getState().jobs).toHaveLength(1);
    expect(useDownloadStore.getState().jobs[0].id).toBe('b');
  });

  it('does nothing when the id is not found', () => {
    useDownloadStore.setState({ jobs: [makeJob({ id: 'x' })] });
    useDownloadStore.getState().dismissJob('unknown');
    expect(useDownloadStore.getState().jobs).toHaveLength(1);
  });

  it('results in empty list when the only job is dismissed', () => {
    useDownloadStore.setState({ jobs: [makeJob({ id: 'only' })] });
    useDownloadStore.getState().dismissJob('only');
    expect(useDownloadStore.getState().jobs).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// cancelActive
// ---------------------------------------------------------------------------

describe('cancelActive', () => {
  it('calls cancel_download when active job is not ytdlp', () => {
    useDownloadStore.setState({ jobs: [makeJob({ id: 'active', phase: 'downloading', useYtdlp: false })] });
    useDownloadStore.getState().cancelActive();
    expect(vi.mocked(invoke)).toHaveBeenCalledWith('cancel_download');
  });

  it('calls cancel_ytdlp_download when active job uses ytdlp', () => {
    useDownloadStore.setState({ jobs: [makeJob({ id: 'active', phase: 'downloading', useYtdlp: true })] });
    useDownloadStore.getState().cancelActive();
    expect(vi.mocked(invoke)).toHaveBeenCalledWith('cancel_ytdlp_download');
  });

  it('does not call invoke when there is no active download', () => {
    useDownloadStore.setState({ jobs: [makeJob({ id: 'q', phase: 'queued' })] });
    useDownloadStore.getState().cancelActive();
    expect(vi.mocked(invoke)).not.toHaveBeenCalled();
  });
});
