import { useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { usePlayerStore } from '../store/usePlayerStore';

interface Options {
  onEscape?: () => void;
}

export function useKeyboardShortcuts({ onEscape }: Options = {}) {
  const { currentVideo, queue, playNext, playPrev } = usePlayerStore();

  useEffect(() => {
    const handler = async (e: KeyboardEvent) => {
      // input / textarea フォーカス中はショートカット無効
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;

      // モーダルを閉じる
      if (e.key === 'Escape') {
        onEscape?.();
        return;
      }

      // 以下は再生中のみ有効
      if (!currentVideo) return;

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
          if (queue.length > 0) await playNext();
          break;
        case 'p':
        case 'P':
          if (queue.length > 0) await playPrev();
          break;
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [currentVideo, queue, playNext, playPrev, onEscape]);
}
