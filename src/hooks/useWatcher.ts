import { useEffect } from 'react';
import { listen } from '@tauri-apps/api/event';
import { useLibraryStore } from '../store/useLibraryStore';

export function useWatcher() {
  const addVideoFromPath = useLibraryStore((s) => s.addVideoFromPath);
  const removeVideoByPath = useLibraryStore((s) => s.removeVideoByPath);

  useEffect(() => {
    const u1 = listen<{ path: string; title: string }>(
      'video-file-created',
      (e) => addVideoFromPath(e.payload.path, e.payload.title)
    );
    const u2 = listen<string>(
      'video-file-removed',
      (e) => removeVideoByPath(e.payload)
    );
    return () => {
      u1.then((fn) => fn());
      u2.then((fn) => fn());
    };
  }, [addVideoFromPath, removeVideoByPath]);
}
