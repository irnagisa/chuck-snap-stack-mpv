import { useEffect } from 'react';
import { listen } from '@tauri-apps/api/event';
import { useLibraryStore } from '../store/useLibraryStore';

export function useWatcher() {
  useEffect(() => {
    // アンマウント前に Promise が解決していない場合も確実にクリーンアップできるよう
    // cancelled フラグで二重クリーンアップを保証する
    let cancelled = false;
    let u1: (() => void) | undefined;
    let u2: (() => void) | undefined;
    let u3: (() => void) | undefined;

    (async () => {
      u1 = await listen<{ path: string; title: string }>(
        'video-file-created',
        (e) => useLibraryStore.getState().addVideoFromPath(e.payload.path, e.payload.title)
      );
      u2 = await listen<string>(
        'video-file-removed',
        (e) => useLibraryStore.getState().removeVideoByPath(e.payload)
      );
      u3 = await listen<{ old_path: string; new_path: string }>(
        'video-file-renamed',
        (e) => useLibraryStore.getState().updateVideoPath(e.payload.old_path, e.payload.new_path)
      );
      // cleanup がすでに実行されていた場合は即座に登録解除
      if (cancelled) {
        u1();
        u2();
        u3();
      }
    })();

    return () => {
      cancelled = true;
      u1?.();
      u2?.();
      u3?.();
    };
  }, []); // 空配列: マウント時に一度だけリスナーを登録
}
