import { useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { convertFileSrc } from '@tauri-apps/api/core';
import type { Video } from '../../types';

interface Props {
  video: Video;
  allImages: Video[];
  onClose: () => void;
  onNavigate: (video: Video) => void;
}

export function ImageViewerModal({ video, allImages, onClose, onNavigate }: Props) {
  const { t } = useTranslation();
  const idx = allImages.findIndex((v) => v.id === video.id);

  const goPrev = useCallback(() => {
    if (idx > 0) onNavigate(allImages[idx - 1]);
  }, [idx, allImages, onNavigate]);

  const goNext = useCallback(() => {
    if (idx < allImages.length - 1) onNavigate(allImages[idx + 1]);
  }, [idx, allImages, onNavigate]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { onClose(); return; }
      if (e.key === 'ArrowLeft') { goPrev(); return; }
      if (e.key === 'ArrowRight') { goNext(); return; }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose, goPrev, goNext]);

  return (
    <div
      className="fixed inset-0 z-[300] flex items-center justify-center bg-black/90"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div
        className="relative max-w-[95vw] max-h-[95vh] flex flex-col items-center"
        onClick={(e) => e.stopPropagation()}
      >
        <img
          src={convertFileSrc(video.path)}
          alt={video.title ?? video.path.split('/').pop()}
          className="max-w-[95vw] max-h-[88vh] object-contain rounded shadow-2xl"
          draggable={false}
        />
        <div className="mt-2 flex items-center gap-4">
          <span className="text-white/70 text-sm truncate max-w-xs">
            {video.title ?? video.path.split('/').pop()}
          </span>
          {allImages.length > 1 && (
            <span className="text-white/40 text-xs tabular-nums shrink-0">
              {t('imageViewer.counter', { current: idx + 1, total: allImages.length })}
            </span>
          )}
        </div>
      </div>

      {/* 前へボタン */}
      {idx > 0 && (
        <button
          type="button"
          className="absolute left-4 top-1/2 -translate-y-1/2 text-white/60 hover:text-white text-3xl leading-none bg-black/30 rounded-full w-10 h-10 flex items-center justify-center"
          onClick={(e) => { e.stopPropagation(); goPrev(); }}
          title={t('imageViewer.prev')}
        >
          ‹
        </button>
      )}

      {/* 次へボタン */}
      {idx < allImages.length - 1 && (
        <button
          type="button"
          className="absolute right-4 top-1/2 -translate-y-1/2 text-white/60 hover:text-white text-3xl leading-none bg-black/30 rounded-full w-10 h-10 flex items-center justify-center"
          onClick={(e) => { e.stopPropagation(); goNext(); }}
          title={t('imageViewer.next')}
        >
          ›
        </button>
      )}

      <button
        type="button"
        className="absolute top-4 right-4 text-white/60 hover:text-white text-xl leading-none bg-black/30 rounded-full w-8 h-8 flex items-center justify-center"
        onClick={onClose}
        title={t('imageViewer.close')}
      >
        ✕
      </button>
    </div>
  );
}
