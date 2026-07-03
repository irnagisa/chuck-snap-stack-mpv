import { useEffect, useRef, useState } from 'react';
import { useTranslation } from "react-i18next";
import { useShallow } from 'zustand/shallow';
import { usePlayerStore } from '../../store/usePlayerStore';
import { useTagStore } from '../../store/useTagStore';
import { useLibraryStore } from '../../store/useLibraryStore';
import { TagBadge } from '../Library/TagBadge';
import { formatTime } from '../../utils/time';

export function MiniPlayer() {
  const { t } = useTranslation();
  const {
    currentVideo, playbackTime, duration, isPaused,
    queue, queueIndex, isMiniPlayer,
    pauseResume, seekTo, quit, playNext, playPrev, toggleMiniPlayer,
  } = usePlayerStore(useShallow((s) => ({
    currentVideo: s.currentVideo,
    playbackTime: s.playbackTime,
    duration: s.duration,
    isPaused: s.isPaused,
    queue: s.queue,
    queueIndex: s.queueIndex,
    isMiniPlayer: s.isMiniPlayer,
    pauseResume: s.pauseResume,
    seekTo: s.seekTo,
    quit: s.quit,
    playNext: s.playNext,
    playPrev: s.playPrev,
    toggleMiniPlayer: s.toggleMiniPlayer,
  })));

  const { videoTags, categories, fetchVideoTags } = useTagStore(useShallow((s) => ({
    videoTags: s.videoTags,
    categories: s.categories,
    fetchVideoTags: s.fetchVideoTags,
  })));

  const { updateVideo } = useLibraryStore(useShallow((s) => ({
    updateVideo: s.updateVideo,
  })));

  const isDraggingSeek = useRef(false);
  const [localSeek, setLocalSeek] = useState(0);
  const [localRating, setLocalRating] = useState(0);

  useEffect(() => {
    if (!isDraggingSeek.current) setLocalSeek(playbackTime);
  }, [playbackTime]);

  useEffect(() => {
    setLocalRating(currentVideo?.rating ?? 0);
    if (currentVideo) {
      fetchVideoTags(currentVideo.id);
    }
  }, [currentVideo?.id]);

  if (!isMiniPlayer) return null;

  const pct = duration > 0 ? (playbackTime / duration) * 100 : 0;
  const hasPrev = queue.length > 0 && queueIndex > 0;
  const hasNext = queue.length > 0 && queueIndex < queue.length - 1;
  const title = currentVideo
    ? (currentVideo.title ?? currentVideo.path.split('/').pop() ?? '')
    : t('player.noVideo');

  const currentTags = currentVideo ? (videoTags[currentVideo.id] ?? []) : [];
  const category = currentVideo?.category_id != null
    ? (categories.find((c) => c.id === currentVideo.category_id) ?? null)
    : null;

  const handleRatingClick = async (star: number) => {
    if (!currentVideo) return;
    const next = star === localRating ? 0 : star;
    setLocalRating(next);
    await updateVideo(currentVideo.id, { rating: next });
  };

  return (
    <div className="flex flex-col h-screen w-screen bg-gray-900 text-white overflow-hidden select-none">
      {/* タイトル行 */}
      <div className="flex items-center gap-2 px-3 pt-3 pb-1 shrink-0">
        <span className="flex-1 text-xs text-gray-300 truncate min-w-0" title={title}>
          {title}
        </span>
        <button
          type="button"
          onClick={toggleMiniPlayer}
          className="text-gray-400 hover:text-white text-xs px-1.5 py-0.5 rounded hover:bg-gray-700 shrink-0"
          title={t('player.backToNormal')}
        >
          ⇲
        </button>
      </div>

      {/* シークバー */}
      <div className="px-3 pb-1 shrink-0">
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] text-gray-500 tabular-nums w-8 text-right shrink-0">
            {formatTime(localSeek)}
          </span>
          <div className="flex-1 relative h-4 flex items-center">
            <div className="absolute inset-x-0 h-1 rounded-full bg-gray-700">
              <div
                className="h-full rounded-full bg-blue-500 pointer-events-none"
                style={{ width: `${pct}%` }}
              />
            </div>
            <input
              type="range"
              className="absolute inset-x-0 w-full opacity-0 cursor-pointer h-4"
              min={0}
              max={duration > 0 ? duration : 100}
              step={0.5}
              value={localSeek}
              onChange={(e) => { isDraggingSeek.current = true; setLocalSeek(Number(e.target.value)); }}
              onMouseDown={() => { isDraggingSeek.current = true; }}
              onMouseUp={(e) => {
                isDraggingSeek.current = false;
                seekTo(Number((e.target as HTMLInputElement).value));
              }}
              onTouchStart={() => { isDraggingSeek.current = true; }}
              onTouchEnd={(e) => {
                isDraggingSeek.current = false;
                seekTo(Number((e.target as HTMLInputElement).value));
              }}
            />
          </div>
          <span className="text-[10px] text-gray-500 tabular-nums w-8 shrink-0">
            {duration > 0 ? formatTime(duration) : '--:--'}
          </span>
        </div>
      </div>

      {/* コントロールボタン */}
      <div className="flex items-center justify-center gap-1 px-3 pb-3 shrink-0">
        <button
          type="button"
          onClick={playPrev}
          disabled={!hasPrev}
          className="p-1.5 rounded hover:bg-gray-700 disabled:opacity-30 disabled:cursor-not-allowed text-gray-300"
          title={t('player.prevVideo')}
        >
          ⏮
        </button>
        <button
          type="button"
          onClick={pauseResume}
          className="p-1.5 rounded hover:bg-gray-700 text-white w-9 text-center"
          title={isPaused ? t('player.playTooltip') : t('player.pauseTooltip')}
        >
          {isPaused ? '▶' : '⏸'}
        </button>
        <button
          type="button"
          onClick={playNext}
          disabled={!hasNext}
          className="p-1.5 rounded hover:bg-gray-700 disabled:opacity-30 disabled:cursor-not-allowed text-gray-300"
          title={t('player.nextVideo')}
        >
          ⏭
        </button>

        <div className="flex-1" />

        {queue.length > 0 && (
          <span className="text-[10px] text-gray-500 tabular-nums">
            {t('player.queuePosition', { current: queueIndex + 1, total: queue.length })}
          </span>
        )}

        <button
          type="button"
          onClick={quit}
          className="p-1.5 rounded hover:bg-red-700 text-gray-400 hover:text-white text-xs ml-1"
          title={t('player.endPlayback')}
        >
          ✕
        </button>
      </div>

      {/* 評価・カテゴリ・タグ */}
      <div className="flex-1 overflow-y-auto px-3 pb-3 flex flex-col gap-2 border-t border-gray-800">
        {/* 評価 */}
        <div className="flex items-center gap-0.5 pt-2">
          {[1, 2, 3, 4, 5].map((star) => (
            <button
              key={star}
              type="button"
              className={`text-base leading-none transition-colors ${
                star <= localRating
                  ? 'text-yellow-400'
                  : 'text-gray-600 hover:text-yellow-300'
              }`}
              onClick={() => handleRatingClick(star)}
              title={`${star}★`}
            >
              ★
            </button>
          ))}
        </div>

        {/* カテゴリ */}
        {category && (
          <div className="flex items-center gap-1.5 min-w-0">
            <span
              className="w-2 h-2 rounded-full shrink-0"
              style={{ backgroundColor: category.color }}
            />
            <span className="text-[11px] text-gray-300 truncate">{category.name}</span>
          </div>
        )}

        {/* タグ */}
        {currentTags.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {currentTags.map((tag) => (
              <TagBadge key={tag.id} tag={tag} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
