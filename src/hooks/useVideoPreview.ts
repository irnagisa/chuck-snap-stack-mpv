import { useRef, useState, useCallback, useEffect } from 'react';
import { convertFileSrc } from '@tauri-apps/api/core';
import { claimPreviewSlot, releasePreviewSlot } from './previewCoordinator';

const HOVER_DELAY_MS = 400;

export function useVideoPreview(path: string, enabled: boolean) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tokenRef = useRef(Symbol('video-preview'));
  const [isPreviewPlaying, setIsPreviewPlaying] = useState(false);

  // play/pause イベントリスナーを登録 (再生開始時に他のプレビューを停止させる)
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const onPlay = () => {
      claimPreviewSlot(tokenRef.current, () => video.pause());
      setIsPreviewPlaying(true);
    };
    const onPause = () => {
      releasePreviewSlot(tokenRef.current);
      setIsPreviewPlaying(false);
    };
    const onEnded = () => {
      releasePreviewSlot(tokenRef.current);
      setIsPreviewPlaying(false);
    };
    video.addEventListener('play', onPlay);
    video.addEventListener('pause', onPause);
    video.addEventListener('ended', onEnded);
    return () => {
      video.removeEventListener('play', onPlay);
      video.removeEventListener('pause', onPause);
      video.removeEventListener('ended', onEnded);
    };
  }, []);

  // アンマウント時クリーンアップ
  useEffect(() => {
    const token = tokenRef.current;
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      releasePreviewSlot(token);
    };
  }, []);

  // ウィンドウが非アクティブになったら確実に停止する
  useEffect(() => {
    const stop = () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      videoRef.current?.pause();
    };
    const onVisibilityChange = () => {
      if (document.hidden) stop();
    };
    window.addEventListener('blur', stop);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      window.removeEventListener('blur', stop);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, []);

  // パス変更時: 停止・リセット
  useEffect(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    const video = videoRef.current;
    if (video && video.src) {
      video.pause();
      video.src = '';
      video.load();
    }
    setIsPreviewPlaying(false);
  }, [path]);

  const onMouseEnter = useCallback(() => {
    if (!enabled) return;
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      const video = videoRef.current;
      if (!video) return;

      const startPlay = () => {
        const dur = video.duration;
        if (dur && isFinite(dur) && dur > 0) {
          video.currentTime = dur * 0.2;
        }
        video.play().catch(() => {});
      };

      if (!video.src) {
        video.src = convertFileSrc(path);
      }

      if (video.readyState >= 1) {
        startPlay();
      } else {
        const onError = () => video.removeEventListener('loadedmetadata', startPlay);
        video.addEventListener('loadedmetadata', startPlay, { once: true });
        video.addEventListener('error', onError, { once: true });
        video.load();
      }
    }, HOVER_DELAY_MS);
  }, [enabled, path]);

  const onMouseLeave = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    const video = videoRef.current;
    if (video) {
      video.pause();
    }
    setIsPreviewPlaying(false);
  }, []);

  return { videoRef, isPreviewPlaying, onMouseEnter, onMouseLeave };
}
