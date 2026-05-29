import { useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { usePlayerStore } from '../store/usePlayerStore';

interface Options {
  onEscape?: () => void;
}

export function useKeyboardShortcuts({ onEscape }: Options = {}) {
  // refs で最新値を保持することで、currentVideo / queue の変化ごとにリスナーを付け直さない
  const onEscapeRef = useRef(onEscape);
  useEffect(() => {
    onEscapeRef.current = onEscape;
  }, [onEscape]);

  useEffect(() => {
    // ストアを直接 subscribe して currentVideo / queue を ref で追跡
    const currentVideoRef = { current: usePlayerStore.getState().currentVideo };
    const queueRef = { current: usePlayerStore.getState().queue };

    const unsub = usePlayerStore.subscribe((state) => {
      currentVideoRef.current = state.currentVideo;
      queueRef.current = state.queue;
    });

    const handler = async (e: KeyboardEvent) => {
      // input / textarea フォーカス中はショートカット無効
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;

      // モーダルを閉じる
      if (e.key === 'Escape') {
        onEscapeRef.current?.();
        return;
      }

      // 以下は再生中のみ有効
      if (!currentVideoRef.current) return;

      switch (e.key) {
        case ' ':
          e.preventDefault();
          await invoke('pause_resume').catch(() => {});
          break;
        case 'ArrowLeft':
          e.preventDefault();
          await invoke('relative_seek', { seconds: -5 }).catch(() => {});
          break;
        case 'ArrowRight':
          e.preventDefault();
          await invoke('relative_seek', { seconds: 5 }).catch(() => {});
          break;
        case 'ArrowUp':
          e.preventDefault();
          await invoke('adjust_volume', { delta: 5 }).catch(() => {});
          break;
        case 'ArrowDown':
          e.preventDefault();
          await invoke('adjust_volume', { delta: -5 }).catch(() => {});
          break;
        case 'f':
        case 'F':
          await invoke('toggle_fullscreen').catch(() => {});
          break;
        case 'n':
        case 'N':
          if (queueRef.current.length > 0) {
            await usePlayerStore.getState().playNext();
          }
          break;
        case 'p':
        case 'P':
          if (queueRef.current.length > 0) {
            await usePlayerStore.getState().playPrev();
          }
          break;
      }
    };

    window.addEventListener('keydown', handler);
    return () => {
      window.removeEventListener('keydown', handler);
      unsub();
    };
  }, []); // 空配列: マウント時に一度だけ登録
}
