import { useEffect, useRef, useState } from 'react';
import { useTranslation } from "react-i18next";
import { useShallow } from 'zustand/shallow';
import { usePlayerStore } from '../../store/usePlayerStore';
import { useTagStore } from '../../store/useTagStore';
import { useLibraryStore } from '../../store/useLibraryStore';
import { TagBadge } from '../Library/TagBadge';
import { formatTime } from '../../utils/time';
import { Maximize2, Pause, Play, SkipBack, SkipForward, X } from "lucide-react";
import { Button, Slider } from "../ui";

export function MiniPlayer() {
  const { t } = useTranslation();
  const {
    currentVideo, playbackTime, duration, isPaused,
    queue, queueIndex, isMiniPlayer,
    pauseResume, seekTo, quit, playNext, playPrev, toggleMiniPlayer, patchVideoFields,
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
    patchVideoFields: s.patchVideoFields,
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
    patchVideoFields(currentVideo.id, { rating: next });
  };

  return (
    <div className="scheme-dark flex flex-col h-screen w-screen bg-gray-900 text-white overflow-hidden select-none">
      {/* タイトル行 */}
      <div className="flex items-center gap-2 px-3 pt-3 pb-1 shrink-0">
        <span className="flex-1 text-xs text-gray-300 truncate min-w-0" title={title}>
          {title}
        </span>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={t('player.backToNormal')}
          onClick={toggleMiniPlayer}
          title={t('player.backToNormal')}
        >
          <Maximize2 aria-hidden />
        </Button>
      </div>

      {/* シークバー */}
      <div className="px-3 pb-1 shrink-0">
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] text-gray-500 tabular-nums w-8 text-right shrink-0">
            {formatTime(localSeek)}
          </span>
          <Slider
            className="flex-1"
            min={0}
            max={duration > 0 ? duration : 100}
            step={0.5}
            value={[localSeek]}
            onValueChange={([v]) => { isDraggingSeek.current = true; setLocalSeek(v); }}
            onValueCommit={([v]) => { isDraggingSeek.current = false; seekTo(v); }}
            thumbLabel={t('player.seek')}
          />
          <span className="text-[10px] text-gray-500 tabular-nums w-8 shrink-0">
            {duration > 0 ? formatTime(duration) : '--:--'}
          </span>
        </div>
      </div>

      {/* コントロールボタン */}
      <div className="flex items-center justify-center gap-1 px-3 pb-3 shrink-0">
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={t('player.prevVideo')}
          onClick={playPrev}
          disabled={!hasPrev}
          title={t('player.prevVideo')}
        >
          <SkipBack aria-hidden />
        </Button>
        <Button
          variant="primary"
          size="icon"
          onClick={pauseResume}
          title={isPaused ? t('player.playTooltip') : t('player.pauseTooltip')}
          aria-label={isPaused ? t('player.playTooltip') : t('player.pauseTooltip')}
        >
          {isPaused ? <Play aria-hidden fill="currentColor" /> : <Pause aria-hidden fill="currentColor" />}
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={t('player.nextVideo')}
          onClick={playNext}
          disabled={!hasNext}
          title={t('player.nextVideo')}
        >
          <SkipForward aria-hidden />
        </Button>

        <div className="flex-1" />

        {queue.length > 0 && (
          <span className="text-[10px] text-gray-500 tabular-nums">
            {t('player.queuePosition', { current: queueIndex + 1, total: queue.length })}
          </span>
        )}

        <Button
          variant="ghost"
          size="icon-sm"
          className="ml-1"
          aria-label={t('player.endPlayback')}
          onClick={quit}
          title={t('player.endPlayback')}
        >
          <X aria-hidden />
        </Button>
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
