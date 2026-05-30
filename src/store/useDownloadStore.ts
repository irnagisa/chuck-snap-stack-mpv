import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { join, basename } from '@tauri-apps/api/path';
import { useLibraryStore } from './useLibraryStore';

export interface DownloadJob {
  id: string;
  url: string;
  saveDir: string;
  filename: string;
  useYtdlp: boolean;
  phase: 'queued' | 'downloading' | 'done' | 'error' | 'cancelled';
  progress: { downloaded: number; total: number; percent: number };
  errorMsg: string;
  title: string;
}

interface DownloadStore {
  jobs: DownloadJob[];
  addJob: (params: Pick<DownloadJob, 'url' | 'saveDir' | 'filename' | 'useYtdlp'>) => void;
  cancelActive: () => void;
  dismissJob: (id: string) => void;
}

let isProcessing = false;

async function processNext() {
  if (isProcessing) return;

  const next = useDownloadStore.getState().jobs.find((j) => j.phase === 'queued');
  if (!next) return;

  isProcessing = true;

  useDownloadStore.setState((s) => ({
    jobs: s.jobs.map((j) =>
      j.id === next.id ? { ...j, phase: 'downloading' } : j
    ),
  }));

  const unlisten = await listen<{ downloaded: number; total: number; percent: number }>(
    'download://progress',
    (event) => {
      useDownloadStore.setState((s) => ({
        jobs: s.jobs.map((j) =>
          j.id === next.id ? { ...j, progress: event.payload } : j
        ),
      }));
    }
  );

  try {
    let resultPath: string;

    if (next.useYtdlp) {
      resultPath = await invoke<string>('download_with_ytdlp', {
        url: next.url,
        saveDir: next.saveDir,
      });
    } else {
      const savePath = await join(next.saveDir, next.filename);
      resultPath = await invoke<string>('download_video', {
        url: next.url,
        savePath,
      });
    }

    unlisten();

    let title: string;
    try {
      const base = await basename(resultPath);
      title = base.replace(/\.[^.]+$/, '');
    } catch {
      title = next.useYtdlp ? '' : next.filename.replace(/\.[^.]+$/, '');
    }

    await useLibraryStore.getState().addVideoFromPath(resultPath, title);

    useDownloadStore.setState((s) => ({
      jobs: s.jobs.map((j) =>
        j.id === next.id ? { ...j, phase: 'done', title } : j
      ),
    }));

    setTimeout(() => {
      useDownloadStore.setState((s) => ({
        jobs: s.jobs.filter((j) => j.id !== next.id),
      }));
    }, 5000);
  } catch (e) {
    unlisten();
    const msg = e instanceof Error ? e.message : String(e);
    const phase: DownloadJob['phase'] =
      msg === 'キャンセルされました' ? 'cancelled' : 'error';

    useDownloadStore.setState((s) => ({
      jobs: s.jobs.map((j) =>
        j.id === next.id
          ? { ...j, phase, errorMsg: phase === 'error' ? msg : '' }
          : j
      ),
    }));

    if (phase === 'cancelled') {
      setTimeout(() => {
        useDownloadStore.setState((s) => ({
          jobs: s.jobs.filter((j) => j.id !== next.id),
        }));
      }, 2000);
    }
  } finally {
    isProcessing = false;
    processNext();
  }
}

export const useDownloadStore = create<DownloadStore>(() => ({
  jobs: [],

  addJob: ({ url, saveDir, filename, useYtdlp }) => {
    const id = `${Date.now()}-${Math.random()}`;
    useDownloadStore.setState((s) => ({
      jobs: [
        ...s.jobs,
        {
          id,
          url,
          saveDir,
          filename,
          useYtdlp,
          phase: 'queued',
          progress: { downloaded: 0, total: 0, percent: 0 },
          errorMsg: '',
          title: '',
        },
      ],
    }));
    processNext();
  },

  cancelActive: () => {
    const active = useDownloadStore.getState().jobs.find((j) => j.phase === 'downloading');
    if (!active) return;
    if (active.useYtdlp) {
      invoke('cancel_ytdlp_download').catch(() => {});
    } else {
      invoke('cancel_download').catch(() => {});
    }
  },

  dismissJob: (id) => {
    useDownloadStore.setState((s) => ({
      jobs: s.jobs.filter((j) => j.id !== id),
    }));
  },
}));
