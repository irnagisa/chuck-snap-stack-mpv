import { useEffect, useRef, useState } from 'react';
import { useTranslation } from "react-i18next";
import { useShallow } from 'zustand/shallow';
import { usePlayerStore } from '../../store/usePlayerStore';
import { useTagStore } from '../../store/useTagStore';
import { useLibraryStore } from '../../store/useLibraryStore';
import { TagBadge, tagColorStyle } from '../Library/TagBadge';
import { VideoOrganizerPanel } from '../common/VideoOrganizerPanel';
import { formatTime } from '../../utils/time';
import {
  Maximize2, PanelBottomClose, PanelBottomOpen, Pause, Play, SkipBack, SkipForward, Star, X,
} from "lucide-react";
import { Button, Slider } from "../ui";
import styles from './MiniPlayer.module.css';

export function MiniPlayer() {
  const { t } = useTranslation();
  const {
    currentVideo, playbackTime, duration, isPaused,
    queue, queueIndex, isMiniPlayer, miniPlayerSize,
    pauseResume, seekTo, quit, playNext, playPrev, toggleMiniPlayer, setMiniPlayerSize, patchVideoFields,
  } = usePlayerStore(useShallow((s) => ({
    currentVideo: s.currentVideo,
    playbackTime: s.playbackTime,
    duration: s.duration,
    isPaused: s.isPaused,
    queue: s.queue,
    queueIndex: s.queueIndex,
    isMiniPlayer: s.isMiniPlayer,
    miniPlayerSize: s.miniPlayerSize,
    pauseResume: s.pauseResume,
    seekTo: s.seekTo,
    quit: s.quit,
    playNext: s.playNext,
    playPrev: s.playPrev,
    toggleMiniPlayer: s.toggleMiniPlayer,
    setMiniPlayerSize: s.setMiniPlayerSize,
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
    if (currentVideo) {
      fetchVideoTags(currentVideo.id);
    }
  }, [currentVideo?.id]);

  // 中サイズの編集欄で変えた評価もこちらに反映する
  useEffect(() => {
    setLocalRating(currentVideo?.rating ?? 0);
  }, [currentVideo?.id, currentVideo?.rating]);

  if (!isMiniPlayer) return null;

  const isMedium = miniPlayerSize === 'medium';
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

  const sizeLabel = isMedium ? t('player.miniPlayerCompact') : t('player.miniPlayerMedium');

  return (
    <div className={styles.root} data-size={miniPlayerSize}>
      {/* タイトル行 */}
      <div className={styles.titleRow}>
        <span className={styles.title} title={title}>
          {title}
        </span>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={sizeLabel}
          aria-pressed={isMedium}
          onClick={() => setMiniPlayerSize(isMedium ? 'compact' : 'medium')}
          title={sizeLabel}
        >
          {isMedium ? <PanelBottomClose aria-hidden /> : <PanelBottomOpen aria-hidden />}
        </Button>
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
      <div className={styles.seekRow}>
        <span className={styles.time} data-align="end">
          {formatTime(localSeek)}
        </span>
        <Slider
          className={styles.seek}
          min={0}
          max={duration > 0 ? duration : 100}
          step={0.5}
          value={[localSeek]}
          onValueChange={([v]) => { isDraggingSeek.current = true; setLocalSeek(v); }}
          onValueCommit={([v]) => { isDraggingSeek.current = false; seekTo(v); }}
          thumbLabel={t('player.seek')}
        />
        <span className={styles.time}>
          {duration > 0 ? formatTime(duration) : '--:--'}
        </span>
      </div>

      {/* コントロールボタン */}
      <div className={styles.controls}>
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

        <div className={styles.spacer} />

        {queue.length > 0 && (
          <span className={styles.queuePos}>
            {t('player.queuePosition', { current: queueIndex + 1, total: queue.length })}
          </span>
        )}

        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={t('player.endPlayback')}
          onClick={quit}
          title={t('player.endPlayback')}
        >
          <X aria-hidden />
        </Button>
      </div>

      {/* 評価・カテゴリ・タグ */}
      <div className={styles.info}>
        {isMedium && currentVideo ? (
          // 中サイズ: 評価・カテゴリ・タグを編集できる
          <VideoOrganizerPanel key={currentVideo.id} video={currentVideo} dense />
        ) : (
          <>
            {/* 評価 (星はボタンの見た目ではないクリック要素) */}
            <div className={styles.stars}>
              {[1, 2, 3, 4, 5].map((star) => (
                <button
                  key={star}
                  type="button"
                  className={styles.star}
                  data-active={star <= localRating || undefined}
                  aria-label={t('detail.ratingStar', { count: star })}
                  aria-pressed={star <= localRating}
                  onClick={() => handleRatingClick(star)}
                >
                  <Star aria-hidden fill="currentColor" />
                </button>
              ))}
            </div>

            {category && (
              <div className={styles.category}>
                <span className={styles.categoryDot} style={tagColorStyle(category.color)} />
                <span className={styles.categoryName}>{category.name}</span>
              </div>
            )}

            {currentTags.length > 0 && (
              <div className={styles.tags}>
                {currentTags.map((tag) => (
                  <TagBadge key={tag.id} tag={tag} size="sm" />
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
