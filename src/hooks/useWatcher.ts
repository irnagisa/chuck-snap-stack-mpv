import { useEffect } from 'react';
import { listen } from '@tauri-apps/api/event';
import { useLibraryStore } from '../store/useLibraryStore';

type WatcherBatch = {
  creates: { path: string; title: string }[];
  removes: string[];
  renames: { old_path: string; new_path: string; title: string }[];
};

const DEBOUNCE_MS = 500;

export function useWatcher() {
  useEffect(() => {
    let cancelled = false;
    let u1: (() => void) | undefined;
    let u2: (() => void) | undefined;
    let u3: (() => void) | undefined;

    const batch: WatcherBatch = { creates: [], removes: [], renames: [] };
    let timer: ReturnType<typeof setTimeout> | null = null;

    const flush = () => {
      timer = null;
      // splice(0) でバッチをスナップショットして空にする
      const snap: WatcherBatch = {
        creates: batch.creates.splice(0),
        removes: batch.removes.splice(0),
        renames: batch.renames.splice(0),
      };
      if (snap.creates.length > 0 || snap.removes.length > 0 || snap.renames.length > 0) {
        useLibraryStore.getState().batchWatcherUpdate(snap);
      }
    };

    const schedule = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(flush, DEBOUNCE_MS);
    };

    (async () => {
      u1 = await listen<{ path: string; title: string }>(
        'video-file-created',
        (e) => { batch.creates.push(e.payload); schedule(); }
      );
      u2 = await listen<string>(
        'video-file-removed',
        (e) => { batch.removes.push(e.payload); schedule(); }
      );
      u3 = await listen<{ old_path: string; new_path: string; title: string }>(
        'video-file-renamed',
        (e) => { batch.renames.push(e.payload); schedule(); }
      );
      if (cancelled) { u1?.(); u2?.(); u3?.(); }
    })();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      u1?.();
      u2?.();
      u3?.();
    };
  }, []);
}
