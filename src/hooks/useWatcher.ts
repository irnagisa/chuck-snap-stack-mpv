import { useEffect } from 'react';
import { listen } from '@tauri-apps/api/event';
import { useLibraryStore } from '../store/useLibraryStore';

export function useWatcher() {
  useEffect(() => {
    // getState() で常に最新の関数を参照するため依存配列を空にできる。
    // これにより addVideoFromPath / removeVideoByPath の参照変化でリスナーが付け直されない。
    const u1 = listen<{ path: string; title: string }>(
      'video-file-created',
      (e) => useLibraryStore.getState().addVideoFromPath(e.payload.path, e.payload.title)
    );
    const u2 = listen<string>(
      'video-file-removed',
      (e) => useLibraryStore.getState().removeVideoByPath(e.payload)
    );
    return () => {
      // Promise.all でクリーンアップを確実に並列実行
      Promise.all([u1, u2]).then(([fn1, fn2]) => {
        fn1();
        fn2();
      });
    };
  }, []); // 空配列: マウント時に一度だけリスナーを登録
}
