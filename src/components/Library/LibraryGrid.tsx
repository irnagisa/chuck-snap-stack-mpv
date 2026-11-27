import { useRef, useState, useEffect, useLayoutEffect, useMemo, useCallback, memo, forwardRef, useImperativeHandle, type ReactNode } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { invoke } from '@tauri-apps/api/core';
import { openUrl } from '@tauri-apps/plugin-opener';
import { useTranslation } from "react-i18next";
import type { Video, Tag, Category, VideoGroupInfo } from '../../types';
import { useTagStore } from '../../store/useTagStore';
import { useLibraryStore } from '../../store/useLibraryStore';
import { useLibraryViewStore } from '../../store/useLibraryViewStore';
import { useSettingsStore } from '../../store/useSettingsStore';
import { useShallow } from 'zustand/shallow';
import { useAudioPreview } from '../../hooks/useAudioPreview';
import { useVideoPreview } from '../../hooks/useVideoPreview';
import { DeleteVideoModal } from './DeleteVideoModal';
import { VideoContextMenu } from './VideoContextMenu';
import { Check, ExternalLink, FileX, Film, Image as ImageIcon, Layers, Link2, ListPlus, Music, Play, Star, Trash2, VolumeX } from 'lucide-react';
import { Button } from '../ui';
import { formatTime } from '../../utils/time';
import { AudioWave, ThumbImage } from './MediaThumb';
import styles from './VideoCard.module.css';
import { TagBadge } from './TagBadge';

interface VideoCardProps {
  video: Video;
  isPlaying: boolean;
  isSelected: boolean;
  isDetailVideo: boolean;
  tags: Tag[];
  category: Category | null;
  /** 入っているグループ (2 件以上のときだけ印を出す) */
  group?: VideoGroupInfo;
  /** グループを代表の 1 件にまとめて表示しているか */
  stacked: boolean;
  idx: number;
  onPlay: (video: Video) => void;
  onShowDetail: (video: Video) => void;
  onAddToPlaylist?: (video: Video) => void;
  onDelete: (video: Video) => void;
  onCheckbox: (e: React.MouseEvent, video: Video, idx: number) => void;
  onContextMenu: (e: React.MouseEvent, video: Video) => void;
  onRegisterObserver: (el: HTMLDivElement, callback: () => void) => () => void;
  previewEnabled: boolean;
}

const VideoCard = memo(function VideoCard({
  video: v,
  isPlaying,
  isSelected,
  isDetailVideo,
  tags,
  category,
  group,
  stacked,
  idx,
  onPlay,
  onShowDetail,
  onAddToPlaylist,
  onDelete,
  onCheckbox,
  onContextMenu,
  onRegisterObserver,
  previewEnabled,
}: VideoCardProps) {
  const { t } = useTranslation();
  const isLink = v.media_type === 'link';
  const isImage = v.media_type === 'image';
  const isAudio = v.media_type === 'audio';
  const isVideo = !isImage && !isAudio && !isLink;
  const { isPreviewPlaying: isAudioPreviewPlaying, onMouseEnter: audioMouseEnter, onMouseLeave: audioMouseLeave } = useAudioPreview(v.path, isAudio && previewEnabled);
  const { videoRef, isPreviewPlaying: isVideoPreviewPlaying, onMouseEnter: videoMouseEnter, onMouseLeave: videoMouseLeave } = useVideoPreview(v.path, isVideo && previewEnabled);
  const onMouseEnter = useCallback(() => { audioMouseEnter(); videoMouseEnter(); }, [audioMouseEnter, videoMouseEnter]);
  const onMouseLeave = useCallback(() => { audioMouseLeave(); videoMouseLeave(); }, [audioMouseLeave, videoMouseLeave]);
  const handlePrimaryClick = () => onShowDetail(v);
  const handlePlay = useCallback(() => {
    if (isLink) {
      openUrl(v.path).catch(() => {});
    } else {
      onPlay(v);
    }
  }, [isLink, v, onPlay]);
  const progressPercent =
    v.duration && v.duration > 0
      ? Math.min((v.progress / v.duration) * 100, 100)
      : null;

  const cardRef = useRef<HTMLDivElement>(null);
  const [fileMissing, setFileMissing] = useState(false);
  const checkedRef = useRef(false);

  useEffect(() => {
    checkedRef.current = false;
    setFileMissing(false);
  }, [v.path]);

  useEffect(() => {
    if (isLink) return; // URL はファイルパスではないので存在チェックをスキップ
    const el = cardRef.current;
    if (!el || checkedRef.current) return;
    return onRegisterObserver(el, () => {
      if (checkedRef.current) return;
      checkedRef.current = true;
      invoke<boolean>('path_exists', { path: v.path })
        .then((exists) => { if (!exists) setFileMissing(true); })
        .catch(() => setFileMissing(true));
    });
  }, [v.path, onRegisterObserver, isLink]);

  const title =
    v.title ??
    (isLink
      ? (() => {
          try {
            return new URL(v.path).hostname;
          } catch {
            return v.path;
          }
        })()
      : v.path.split('/').pop());
  const showDuration = !isImage && !isLink && v.duration != null && v.duration > 0;
  const showGroup = group != null && group.memberCount >= 2;
  const progressWidth =
    progressPercent !== null && progressPercent > 0 ? progressPercent : v.progress > 0 && progressPercent === null ? 100 : 0;

  return (
    <div
      ref={cardRef}
      className={styles.card}
      data-selected={isSelected || undefined}
      data-playing={isPlaying || undefined}
      data-detail={isDetailVideo || undefined}
      data-missing={fileMissing || undefined}
      onContextMenu={(e) => { e.preventDefault(); onContextMenu(e, v); }}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      onClick={handlePrimaryClick}
      onDoubleClick={(e) => { e.stopPropagation(); handlePlay(); }}
      // キーボード: Tab でカードに移動、Enter で詳細、Shift+Enter で再生
      tabIndex={0}
      aria-label={title}
      onKeyDown={(e) => {
        if (e.key !== 'Enter' || e.target !== e.currentTarget) return;
        e.preventDefault();
        if (e.shiftKey) handlePlay();
        else handlePrimaryClick();
      }}
    >
      {showGroup && stacked && <div className={styles.stackEdge} aria-hidden />}
      <div className={styles.thumb}>
        {v.thumbnail ? (
          <ThumbImage src={v.thumbnail} alt={v.title ?? ''} />
        ) : (
          <div className={styles.placeholder}>
            {isLink ? <Link2 aria-hidden /> : isImage ? <ImageIcon aria-hidden /> : isAudio ? <Music aria-hidden /> : <Film aria-hidden />}
          </div>
        )}

        {isVideo && (
          <video
            ref={videoRef}
            muted
            playsInline
            className={styles.preview}
            data-active={isVideoPreviewPlaying || undefined}
          />
        )}
        {isAudio && isAudioPreviewPlaying && <AudioWave />}

        {/* 左上: 選択チェック (hover か選択中に表示) */}
        <div className={styles.topLeft}>
          <button
            type="button"
            className={`${styles.check} ${styles.hoverOnly}`}
            data-checked={isSelected || undefined}
            aria-label={t('library.select')}
            aria-pressed={isSelected}
            onClick={(e) => { e.stopPropagation(); onCheckbox(e, v, idx); }}
            onDoubleClick={(e) => e.stopPropagation()}
          >
            {isSelected && <Check aria-hidden />}
          </button>
        </div>

        {/* 右上: 状態バッジ / hover 時は操作ボタン */}
        <div className={styles.topRight}>
          {v.status === 'inbox' && !isPlaying && (
            <span className={styles.pill} data-tone="new" title={t('library.newHint')}>{t('library.new')}</span>
          )}
          {isPlaying && (
            <span className={styles.pill} data-tone="accent">
              <span className={styles.eq} aria-hidden><span /><span /><span /></span>
              {t('library.playing')}
            </span>
          )}
          <div className={`${styles.actions} ${styles.hoverOnly}`}>
            {onAddToPlaylist && (
              <Button
                variant="secondary"
                size="icon-sm"
                onClick={(e) => { e.stopPropagation(); onAddToPlaylist(v); }}
                onDoubleClick={(e) => e.stopPropagation()}
                title={t('library.addToPlaylist')}
                aria-label={t('library.addToPlaylist')}
              >
                <ListPlus aria-hidden />
              </Button>
            )}
            <Button
              variant="secondary"
              size="icon-sm"
              className={styles.danger}
              onClick={(e) => { e.stopPropagation(); onDelete(v); }}
              onDoubleClick={(e) => e.stopPropagation()}
              title={t('library.deleteVideo')}
              aria-label={t('library.deleteVideo')}
            >
              <Trash2 aria-hidden />
            </Button>
          </div>
        </div>

        {/* 中央: 再生ボタン */}
        <button
          type="button"
          className={`${styles.playButton} ${styles.hoverOnly}`}
          onClick={(e) => { e.stopPropagation(); handlePlay(); }}
          onDoubleClick={(e) => e.stopPropagation()}
          title={isLink ? t('library.openUrl') : t('library.play')}
          aria-label={isLink ? t('library.openUrl') : t('library.play')}
        >
          {isLink ? <ExternalLink aria-hidden /> : <Play aria-hidden fill="currentColor" />}
        </button>

        {/* 左下: 再生時間・種別・音声なし */}
        <div className={styles.bottomLeft}>
          {showDuration && <span className={styles.pill}>{formatTime(v.duration!)}</span>}
          {isImage && <span className={styles.pill}><ImageIcon aria-hidden />{t('library.imageType')}</span>}
          {isAudio && <span className={styles.pill}><Music aria-hidden />{t('library.audioType')}</span>}
          {isLink && <span className={styles.pill}><Link2 aria-hidden />{t('library.linkType')}</span>}
          {v.has_audio === 0 && !isImage && !isAudio && (
            <span className={styles.pill} title={t('filters.audioNo')}><VolumeX aria-hidden /></span>
          )}
        </div>

        {progressWidth > 0 && (
          <div className={styles.progress}>
            <div className={styles.progressBar} style={{ width: `${progressWidth}%` }} />
          </div>
        )}

        {fileMissing && (
          <div className={styles.center}>
            <span className={styles.pill} data-tone="danger">
              <FileX aria-hidden />
              {t('library.noFile')}
            </span>
          </div>
        )}
        {showGroup && (
          <div className={styles.bottomRight}>
            <span
              className={styles.pill}
              data-tone={stacked ? 'accent' : undefined}
              title={t(group.kind === 'series' ? 'groups.badgeSeries' : 'groups.badgeVariants', { name: group.name, count: group.memberCount })}
            >
              <Layers aria-hidden />
              {group.memberCount}
            </span>
          </div>
        )}
      </div>

      <div className={styles.body}>
        <p className={styles.title} title={title}>{title}</p>
        {/* 情報が無くても行の高さは確保し、カードの高さを揃える */}
        {(
          <div className={styles.meta}>
            {category && (
              <span className={styles.category}>
                <span className={styles.dot} style={{ backgroundColor: category.color }} />
                {category.name}
              </span>
            )}
            {tags.slice(0, 2).map((tag) => (
              <TagBadge key={tag.id} tag={tag} size="sm" />
            ))}
            {tags.length > 2 && <span className={styles.more}>+{tags.length - 2}</span>}
            {v.rating > 0 && (
              <span className={styles.rating} aria-label={`★${v.rating}`}>
                <Star aria-hidden fill="currentColor" />
                {v.rating}
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
});

export interface LibraryViewHandle {
  scrollToId: (id: number) => void;
}

interface Props {
  videos: Video[];
  currentVideoId: number | null;
  detailVideoId?: number | null;
  scrollResetKey?: string | number;
  onPlay: (video: Video) => void;
  onShowDetail: (video: Video) => void;
  onAddToPlaylist?: (video: Video) => void;
  onSetTag?: (video: Video) => void;
  onSetCategory?: (video: Video) => void;
  onMoveDir?: (video: Video) => void;
  selectedIds: Set<number>;
  onSelectionChange: (ids: Set<number>) => void;
  /** 一覧が空のときに表示する内容 */
  emptyState?: ReactNode;
}

const ITEM_MIN_WIDTH = 160;
const GAP = 16; // gap-4
/** 選択・再生中の輪郭 (box-shadow) がスクロール領域の上端で切れないための余白 */
const OUTLINE_SPACE = 8;

export const LibraryGrid = forwardRef<LibraryViewHandle, Props>(function LibraryGrid({
  videos,
  currentVideoId,
  detailVideoId,
  scrollResetKey,
  onPlay,
  onShowDetail,
  onAddToPlaylist,
  onSetTag,
  onSetCategory,
  onMoveDir,
  selectedIds,
  onSelectionChange,
  emptyState,
}: Props, ref: React.Ref<LibraryViewHandle>) {
  // useShallow: videoTags の参照が変わっても内容が同一なら再レンダリングをスキップ
  // (fetchVideos の normalizedVideoTags によりタグ内容が変わっていない動画の配列参照は維持される)
  const { gridItemMinWidth = ITEM_MIN_WIDTH } = useLibraryViewStore(useShallow((s) => ({ gridItemMinWidth: s.gridItemMinWidth })));
  const hoverPreviewEnabled = useSettingsStore((s) => s.hoverPreviewEnabled);
  const videoTags = useTagStore(useShallow((s) => s.videoTags));
  const categories = useTagStore(useShallow((s) => s.categories));
  const videoGroups = useLibraryStore((s) => s.videoGroups);
  const collapseGroups = useLibraryStore((s) => s.filterCollapseGroups);
  const [deleteTarget, setDeleteTarget] = useState<Video | null>(null);
  const [contextMenu, setContextMenu] = useState<{ video: Video; x: number; y: number } | null>(null);

  // 共有 IntersectionObserver: per-card IO インスタンスを一本化
  // useLayoutEffect を使うことで子コンポーネントの useEffect (IO 登録) より
  // 先に IO を生成し、初回マウント時の登録空振りを防ぐ
  const ioCallbacksRef = useRef<Map<HTMLElement, () => void>>(new Map());
  const observerRef = useRef<IntersectionObserver | null>(null);
  useLayoutEffect(() => {
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const cb = ioCallbacksRef.current.get(entry.target as HTMLElement);
        if (cb) {
          observer.unobserve(entry.target);
          ioCallbacksRef.current.delete(entry.target as HTMLElement);
          cb();
        }
      }
    }, { threshold: 0.1 });
    observerRef.current = observer;
    return () => { observer.disconnect(); ioCallbacksRef.current.clear(); };
  }, []);

  const registerObserver = useCallback((el: HTMLDivElement, callback: () => void): (() => void) => {
    const observer = observerRef.current;
    if (!observer) return () => {};
    ioCallbacksRef.current.set(el, callback);
    observer.observe(el);
    return () => {
      ioCallbacksRef.current.delete(el);
      observer.unobserve(el);
    };
  }, []);

  const lastSelectedIdxRef = useRef<number | null>(null);
  const selectedIdsRef = useRef(selectedIds);
  useEffect(() => { selectedIdsRef.current = selectedIds; }, [selectedIds]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [columns, setColumns] = useState(4);

  const categoryMap = useMemo(
    () => Object.fromEntries(categories.map((c) => [c.id, c])),
    [categories],
  );

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const measure = () => {
      // clientWidth には輪郭用の左右 padding (.scroller) が含まれるので差し引く
      const cs = getComputedStyle(el);
      const width = el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
      const cols = Math.max(1, Math.floor((width + GAP) / (gridItemMinWidth + GAP)));
      setColumns(cols);
    };
    measure();
    // debounce: リサイズ中の高頻度な measure 呼び出しを抑制
    let timer: ReturnType<typeof setTimeout> | null = null;
    const debouncedMeasure = () => {
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(measure, 150);
    };
    const ro = new ResizeObserver(debouncedMeasure);
    ro.observe(el);
    return () => {
      if (timer !== null) clearTimeout(timer);
      ro.disconnect();
    };
  }, [gridItemMinWidth]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = 0;
    }
  }, [scrollResetKey]);

  const rows = useMemo(() => {
    const result: Video[][] = [];
    for (let i = 0; i < videos.length; i += columns) {
      result.push(videos.slice(i, i + columns));
    }
    return result;
  }, [videos, columns]);

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: useCallback(() => 180, []),
    overscan: 3,
    // 1 行目の輪郭が上端で切れないための余白
    paddingStart: OUTLINE_SPACE,
  });

  useImperativeHandle(ref, () => ({
    scrollToId: (id: number) => {
      const idx = videos.findIndex((v) => v.id === id);
      if (idx < 0) return;
      const rowIdx = Math.floor(idx / columns);
      virtualizer.scrollToIndex(rowIdx, { align: 'center' });
    },
  }), [videos, columns, virtualizer]);

  const handleCheckbox = useCallback((e: React.MouseEvent, video: Video, idx: number) => {
    e.stopPropagation();
    if (e.shiftKey) e.preventDefault();
    const next = new Set(selectedIdsRef.current);

    if (e.shiftKey && lastSelectedIdxRef.current !== null) {
      const from = Math.min(lastSelectedIdxRef.current, idx);
      const to = Math.max(lastSelectedIdxRef.current, idx);
      for (let i = from; i <= to; i++) {
        next.add(videos[i].id);
      }
    } else {
      if (next.has(video.id)) {
        next.delete(video.id);
      } else {
        next.add(video.id);
      }
      lastSelectedIdxRef.current = idx;
    }

    onSelectionChange(next);
  }, [videos, onSelectionChange]);

  const handleContextMenu = useCallback((e: React.MouseEvent, video: Video) => {
    setContextMenu({ video, x: e.clientX, y: e.clientY });
  }, []);

  return (
    <>
      <div ref={scrollRef} className={styles.scroller}>
        {videos.length === 0 ? (
          emptyState
        ) : (
          <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
            {virtualizer.getVirtualItems().map((virtualRow) => {
              const rowVideos = rows[virtualRow.index];
              return (
                <div
                  key={virtualRow.key}
                  data-index={virtualRow.index}
                  ref={virtualizer.measureElement}
                  style={{ position: 'absolute', top: virtualRow.start, left: 0, right: 0 }}
                >
                  <div
                    className={styles.gridRow}
                    style={{
                      gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
                      gap: GAP,
                    }}
                  >
                    {rowVideos.map((v, colIdx) => {
                      const idx = virtualRow.index * columns + colIdx;
                      return (
                        <VideoCard
                          key={v.id}
                          video={v}
                          isPlaying={v.id === currentVideoId}
                          isSelected={selectedIds.has(v.id)}
                          isDetailVideo={v.id === (detailVideoId ?? null)}
                          tags={videoTags[v.id] ?? []}
                          category={v.category_id != null ? categoryMap[v.category_id] : null}
                          group={videoGroups[v.id]}
                          stacked={collapseGroups}
                          idx={idx}
                          onPlay={onPlay}
                          onShowDetail={onShowDetail}
                          onAddToPlaylist={onAddToPlaylist}
                          onDelete={setDeleteTarget}
                          onCheckbox={handleCheckbox}
                          onContextMenu={handleContextMenu}
                          onRegisterObserver={registerObserver}
                          previewEnabled={hoverPreviewEnabled && gridItemMinWidth >= 180}
                        />
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {deleteTarget && (
        <DeleteVideoModal
          video={deleteTarget}
          onClose={() => setDeleteTarget(null)}
          onRemoved={() => setDeleteTarget(null)}
        />
      )}

      {contextMenu && (
        <VideoContextMenu
          video={contextMenu.video}
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={() => setContextMenu(null)}
          onPlay={() => { onPlay(contextMenu.video); setContextMenu(null); }}
          onShowDetail={() => { onShowDetail(contextMenu.video); setContextMenu(null); }}
          onAddToPlaylist={onAddToPlaylist ? () => { onAddToPlaylist!(contextMenu.video); setContextMenu(null); } : undefined}
          onSetTag={onSetTag ? () => { onSetTag!(contextMenu.video); setContextMenu(null); } : undefined}
          onSetCategory={onSetCategory ? () => { onSetCategory!(contextMenu.video); setContextMenu(null); } : undefined}
          onMoveDir={onMoveDir ? () => { onMoveDir!(contextMenu.video); setContextMenu(null); } : undefined}
          onDelete={() => { setDeleteTarget(contextMenu.video); setContextMenu(null); }}
        />
      )}
    </>
  );
});
