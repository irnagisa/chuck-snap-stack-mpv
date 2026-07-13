import { useRef, useState, useEffect, useCallback } from 'react';
import { convertFileSrc } from '@tauri-apps/api/core';

/** ホバー開始からプレビュー再生を始めるまでの遅延 (ms) */
const HOVER_DELAY_MS = 400;
/** プレビュー再生音量 (0.0 - 1.0) */
const PREVIEW_VOLUME = 0.4;

/**
 * 音声ファイルのホバープレビューフック。
 * - HOVER_DELAY_MS 後に再生開始 (素早いマウス通過では再生しない)
 * - Audio 要素はホバー時に遅延生成 (マウント時は何もしない)
 * - パス変更・アンマウント時に確実にクリーンアップ
 */
export function useAudioPreview(path: string, enabled: boolean) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [isPreviewPlaying, setIsPreviewPlaying] = useState(false);

  // アンマウント時のクリーンアップ
  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      const audio = audioRef.current;
      if (audio) {
        audio.pause();
        audio.src = '';
        audioRef.current = null;
      }
    };
  }, []);

  // パス変更時: 再生中のプレビューを停止・src をリセット
  useEffect(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      audio.currentTime = 0;
      audio.src = '';
    }
    setIsPreviewPlaying(false);
  }, [path]);

  const onMouseEnter = useCallback(() => {
    if (!enabled) return;
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      let audio = audioRef.current;
      if (!audio) {
        audio = new Audio();
        audio.volume = PREVIEW_VOLUME;
        audio.addEventListener('playing', () => setIsPreviewPlaying(true));
        audio.addEventListener('pause', () => setIsPreviewPlaying(false));
        audioRef.current = audio;
      }
      // src が未設定の場合のみセット (2回目以降のホバーは再利用)
      if (!audio.src) {
        audio.src = convertFileSrc(path);
      }
      audio.currentTime = 0;
      audio.play().catch(() => {});
    }, HOVER_DELAY_MS);
  }, [enabled, path]);

  const onMouseLeave = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      audio.currentTime = 0;
    }
    setIsPreviewPlaying(false);
  }, []);

  return { isPreviewPlaying, onMouseEnter, onMouseLeave };
}
