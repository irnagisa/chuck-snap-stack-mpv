import { useRef, useState, useEffect, useLayoutEffect, useMemo, useCallback, memo, forwardRef, useImperativeHandle } from 'react';
import type { LibraryViewHandle } from './LibraryGrid';
import { useVirtualizer } from '@tanstack/react-virtual';
import { invoke } from '@tauri-apps/api/core';
import { useTranslation } from "react-i18next";
import type { Video, Tag, Category } from '../../types';
import { useTagStore } from '../../store/useTagStore';
import { useShallow } from 'zustand/shallow';
import { useAudioPreview } from '../../hooks/useAudioPreview';
import { useVideoPreview } from '../../hooks/useVideoPreview';
import { DeleteVideoModal } from './DeleteVideoModal';
import { VideoContextMenu } from './VideoContextMenu';
import { formatTime } from '../../utils/time';
import { useLibraryViewStore } from '../../store/useLibraryViewStore';
import { useSettingsStore } from '../../store/useSettingsStore';
import { Check, FileX, ListPlus, Play, Star, Trash2 } from "lucide-react";
import { Button } from "../ui";
import { MediaThumb, MediaTypeIcon } from "./MediaThumb";
import styles from "./VideoCard.module.css";

interface Props {
  videos: Video[];
  currentVideoId: number | null;
  detailVideoId: number | null;
  scrollResetKey: string;
  onPlay: (video: Video) => void;
  onShowDetail: (video: Video) => void;
  onAddToPlaylist?: (video: Video) => void;
  onSetTag?: (video: Video) => void;
  onSetCategory?: (video: Video) => void;
  onMoveDir?: (video: Video) => void;
  selectedIds: Set<number>;
  onSelectionChange: (ids: Set<number>) => void;
}

interface VideoRowProps {
  video: Video;
  isPlaying: boolean;
  isSelected: boolean;
  isDetailVideo: boolean;
  tags: Tag[];
  category: Category | null;
  idx: number;
  listRowSize: 'S' | 'M' | 'L' | 'XL';
  onPlay: (video: Video) => void;
  onShowDetail: (video: Video) => void;
  onAddToPlaylist?: (video: Video) => void;
  onDelete: (video: Video) => void;
  onCheckbox: (e: React.MouseEvent, video: Video, idx: number) => void;
  onContextMenu: (e: React.MouseEvent, video: Video) => void;
  onRegisterObserver: (el: HTMLDivElement, callback: () => void) => () => void;
  previewEnabled: boolean;
}



const ROW_HEIGHTS = { S: 38, M: 52, L: 72, XL: 90 } as const;

const VideoRow = memo(function VideoRow({
  video: v,
  isPlaying,
  isSelected,
  isDetailVideo,
  tags,
  category,
  idx,
  listRowSize,
  onPlay,
  onShowDetail,
  onAddToPlaylist,
  onDelete,
  onCheckbox,
  onContextMenu,
  onRegisterObserver,
  previewEnabled,
}: VideoRowProps) {
  const { t } = useTranslation();
  const isImage = v.media_type === 'image';
  const isAudio = v.media_type === 'audio';
  const isVideo = !isImage && !isAudio;
  const { isPreviewPlaying: isAudioPreviewPlaying, onMouseEnter: audioMouseEnter, onMouseLeave: audioMouseLeave } = useAudioPreview(v.path, isAudio && previewEnabled);
  const { videoRef, isPreviewPlaying: isVideoPreviewPlaying, onMouseEnter: videoMouseEnter, onMouseLeave: videoMouseLeave } = useVideoPreview(v.path, isVideo && previewEnabled && listRowSize !== 'S');
  const onMouseEnter = useCallback(() => { audioMouseEnter(); videoMouseEnter(); }, [audioMouseEnter, videoMouseEnter]);
  const onMouseLeave = useCallback(() => { audioMouseLeave(); videoMouseLeave(); }, [audioMouseLeave, videoMouseLeave]);

  const rowRef = useRef<HTMLDivElement>(null);
  const [fileMissing, setFileMissing] = useState(false);
  const checkedRef = useRef(false);

  useEffect(() => {
    checkedRef.current = false;
    setFileMissing(false);
  }, [v.path]);

  useEffect(() => {
    const el = rowRef.current;
    if (!el || checkedRef.current) return;
    return onRegisterObserver(el, () => {
      if (checkedRef.current) return;
      checkedRef.current = true;
      invoke<boolean>('path_exists', { path: v.path })
        .then((exists) => { if (!exists) setFileMissing(true); })
        .catch(() => setFileMissing(true));
    });
  }, [v.path, onRegisterObserver]);

  const title = v.title ?? v.path.split('/').pop() ?? '';

  // 親ディレクトリ: 末尾2階層 (例: Videos/Action)
  const pathParts = v.path.split('/');
  const parentDir = pathParts.length >= 3
    ? `${pathParts[pathParts.length - 3]}/${pathParts[pathParts.length - 2]}`
    : pathParts[pathParts.length - 2] ?? '';

  const compact = listRowSize === 'S';

  return (
    <div
      ref={rowRef}
      className={styles.row}
      data-compact={compact || undefined}
      data-selected={isSelected || undefined}
      data-playing={isPlaying || undefined}
      data-detail={isDetailVideo || undefined}
      data-missing={fileMissing || undefined}
      onContextMenu={(e) => { e.preventDefault(); onContextMenu(e, v); }}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      onClick={() => onShowDetail(v)}
      onDoubleClick={(e) => { e.stopPropagation(); onPlay(v); }}
    >
      {/* 選択チェック (hover か選択中に表示) */}
      <button
        type="button"
        className={`${styles.check} ${styles.rowCheck} ${styles.hoverOnly}`}
        data-checked={isSelected || undefined}
        aria-label={t('library.select')}
        aria-pressed={isSelected}
        onClick={(e) => { e.stopPropagation(); onCheckbox(e, v, idx); }}
        onDoubleClick={(e) => e.stopPropagation()}
      >
        {isSelected && <Check aria-hidden />}
      </button>

      {/* サムネイル */}
      <MediaThumb
        video={v}
        compact
        showDuration={false}
        className={styles.rowThumb}
        data-size={listRowSize}
      >
        {isVideo && (
          <video
            ref={videoRef}
            muted
            playsInline
            className={styles.preview}
            data-active={isVideoPreviewPlaying || undefined}
          />
        )}
        {isAudio && isAudioPreviewPlaying && (
          <div className="absolute inset-0 bg-black/20 flex items-end justify-center gap-px pb-0.5 pointer-events-none">
            {[0, 1, 2, 3, 4].map((i) => (
              <div
                key={i}
                className="w-0.5 bg-green-400 rounded-full audio-wave-bar"
                style={{ height: `${5 + (i % 3) * 3}px`, animation: 'audioWave 0.5s ease-in-out infinite alternate', animationDelay: `${i * 0.1}s` }}
              />
            ))}
          </div>
        )}
      </MediaThumb>

      {/* タイトル・カテゴリ・タグ・フォルダ */}
      <div className={styles.rowBody}>
        <p className={styles.title} title={title}>{title}</p>
        {!compact && (
          <div className={styles.meta}>
            {category && (
              <span className={styles.category}>
                <span className={styles.dot} style={{ backgroundColor: category.color }} />
                {category.name}
              </span>
            )}
            {tags.slice(0, 3).map((tag) => (
              <span key={tag.id} className={styles.tag} style={{ backgroundColor: tag.color }}>
                {tag.name}
              </span>
            ))}
            {tags.length > 3 && <span className={styles.more}>+{tags.length - 3}</span>}
            <span className={styles.sub} title={v.path}>{parentDir}</span>
          </div>
        )}
      </div>

      {/* 状態バッジ */}
      {isPlaying && (
        <span className={styles.softPill} data-tone="accent">
          <span className={styles.eq} aria-hidden><span /><span /><span /></span>
          {t('library.playing')}
        </span>
      )}
      {fileMissing && (
        <span className={styles.softPill} data-tone="danger">
          <FileX aria-hidden />
          {t('library.noFile')}
        </span>
      )}
      {(isImage || isAudio) && (
        <span className={styles.softPill}>
          <MediaTypeIcon type={v.media_type} />
          {isImage ? t('library.imageType') : t('library.audioType')}
        </span>
      )}

      {v.rating > 0 && (
        <span className={styles.rating} aria-label={`★${v.rating}`}>
          <Star aria-hidden fill="currentColor" />
          {v.rating}
        </span>
      )}

      <span className={styles.duration}>{v.duration != null ? formatTime(v.duration) : ''}</span>

      {/* 操作ボタン (hover で表示) */}
      <div className={`${styles.rowActions} ${styles.hoverOnly}`}>
        {onAddToPlaylist && (
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t('library.addToPlaylist')}
            title={t('library.addToPlaylist')}
            onClick={(e) => { e.stopPropagation(); onAddToPlaylist(v); }}
            onDoubleClick={(e) => e.stopPropagation()}
          >
            <ListPlus aria-hidden />
          </Button>
        )}
        <Button
          variant="danger-soft"
          size="icon-sm"
          onClick={(e) => { e.stopPropagation(); onDelete(v); }}
          onDoubleClick={(e) => e.stopPropagation()}
          title={t('library.deleteVideo')}
          aria-label={t('library.deleteVideo')}
        >
          <Trash2 aria-hidden />
        </Button>
        <Button
          variant="primary"
          size="icon-sm"
          onClick={(e) => { e.stopPropagation(); onPlay(v); }}
          onDoubleClick={(e) => e.stopPropagation()}
          title={t('library.play')}
          aria-label={t('library.play')}
        >
          <Play aria-hidden fill="currentColor" />
        </Button>
      </div>
    </div>
  );
});

export const LibraryList = forwardRef<LibraryViewHandle, Props>(function LibraryList({
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
}: Props, ref: React.Ref<LibraryViewHandle>) {
  const listRowSize = useLibraryViewStore((s) => s.listItemSize);
  const hoverPreviewEnabled = useSettingsStore((s) => s.hoverPreviewEnabled);
  // useShallow: videoTags の参照が変わっても内容が同一なら再レンダリングをスキップ
  // (fetchVideos の normalizedVideoTags によりタグ内容が変わっていない動画の配列参照は維持される)
  const videoTags = useTagStore(useShallow((s) => s.videoTags));
  const categories = useTagStore(useShallow((s) => s.categories));
  const [deleteTarget, setDeleteTarget] = useState<Video | null>(null);
  const [contextMenu, setContextMenu] = useState<{ video: Video; x: number; y: number } | null>(null);

  // 共有 IntersectionObserver: per-row IO インスタンスを一本化
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

  const categoryMap = useMemo(
    () => Object.fromEntries(categories.map((c) => [c.id, c])),
    [categories],
  );

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = 0;
    }
  }, [scrollResetKey]);

  const estimateHeight = useCallback(() => ROW_HEIGHTS[listRowSize], [listRowSize]);

  const virtualizer = useVirtualizer({
    count: videos.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: estimateHeight,
    overscan: 5,
    // 1 行目の輪郭が上端で切れないための余白
    paddingStart: 4,
  });

  useImperativeHandle(ref, () => ({
    scrollToId: (id: number) => {
      const idx = videos.findIndex((v) => v.id === id);
      if (idx >= 0) virtualizer.scrollToIndex(idx, { align: 'center' });
    },
  }), [videos, virtualizer]);

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
          <p className="text-gray-400 mt-4 text-sm dark:text-gray-500">
            動画が見つかりません。ディレクトリをスキャンしてください。
          </p>
        ) : (
          <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
            {virtualizer.getVirtualItems().map((virtualItem) => {
              const v = videos[virtualItem.index];
              return (
                <div
                  key={virtualItem.key}
                  data-index={virtualItem.index}
                  ref={virtualizer.measureElement}
                  style={{ position: 'absolute', top: virtualItem.start, left: 0, right: 0, paddingBottom: 4 }}
                >
                  <VideoRow
                    video={v}
                    isPlaying={v.id === currentVideoId}
                    isSelected={selectedIds.has(v.id)}
                    isDetailVideo={v.id === (detailVideoId ?? null)}
                    tags={videoTags[v.id] ?? []}
                    category={v.category_id != null ? categoryMap[v.category_id] : null}
                    idx={virtualItem.index}
                    listRowSize={listRowSize}
                    onPlay={onPlay}
                    onShowDetail={onShowDetail}
                    onAddToPlaylist={onAddToPlaylist}
                    onDelete={setDeleteTarget}
                    onCheckbox={handleCheckbox}
                    onContextMenu={handleContextMenu}
                    onRegisterObserver={registerObserver}
                    previewEnabled={hoverPreviewEnabled}
                  />
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
