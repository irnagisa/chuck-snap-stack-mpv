import { useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { usePlayerStore } from '../store/usePlayerStore';
import { useSettingsStore } from '../store/useSettingsStore';
import type { KeyBindings } from '../store/useSettingsStore';

interface Options {
  onEscape?: () => void;
}

export function useKeyboardShortcuts({ onEscape }: Options = {}) {
  const onEscapeRef = useRef(onEscape);
  useEffect(() => {
    onEscapeRef.current = onEscape;
  }, [onEscape]);

  useEffect(() => {
    const currentVideoRef = { current: usePlayerStore.getState().currentVideo };
    const queueRef = { current: usePlayerStore.getState().queue };
    // keybindings も ref で追跡し、設定変更時にリスナーを付け直さない
    const bindingsRef: { current: KeyBindings } = {
      current: useSettingsStore.getState().keybindings,
    };

    const unsub = usePlayerStore.subscribe((state) => {
      currentVideoRef.current = state.currentVideo;
      queueRef.current = state.queue;
    });

    const unsubSettings = useSettingsStore.subscribe((state) => {
      bindingsRef.current = state.keybindings;
    });

    const handler = async (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT') return;

      const b = bindingsRef.current;
      const key = e.key;

      if (key === b.escape) {
        onEscapeRef.current?.();
        return;
      }

      if (!currentVideoRef.current) return;

      if (key === b.pause || key === b.pause.toUpperCase()) {
        e.preventDefault();
        await invoke('pause_resume').catch(() => {});
      } else if (key === b.seekBackward) {
        e.preventDefault();
        await invoke('relative_seek', { seconds: -5 }).catch(() => {});
      } else if (key === b.seekForward) {
        e.preventDefault();
        await invoke('relative_seek', { seconds: 5 }).catch(() => {});
      } else if (key === b.volumeUp) {
        e.preventDefault();
        await invoke('adjust_volume', { delta: 5 }).catch(() => {});
      } else if (key === b.volumeDown) {
        e.preventDefault();
        await invoke('adjust_volume', { delta: -5 }).catch(() => {});
      } else if (key === b.fullscreen || key === b.fullscreen.toUpperCase()) {
        await invoke('toggle_fullscreen').catch(() => {});
      } else if (key === b.next || key === b.next.toUpperCase()) {
        if (queueRef.current.length > 0) {
          await usePlayerStore.getState().playNext();
        }
      } else if (key === b.prev || key === b.prev.toUpperCase()) {
        if (queueRef.current.length > 0) {
          await usePlayerStore.getState().playPrev();
        }
      }
    };

    window.addEventListener('keydown', handler);
    return () => {
      window.removeEventListener('keydown', handler);
      unsub();
      unsubSettings();
    };
  }, []);
}
