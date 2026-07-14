import { useRef, useState, useEffect, useLayoutEffect, useMemo, useCallback, memo, forwardRef, useImperativeHandle } from 'react';
import type { LibraryViewHandle } from './LibraryGrid';
import { useVirtualizer } from '@tanstack/react-virtual';
import { convertFileSrc, invoke } from '@tauri-apps/api/core';
import { useTranslation } from "react-i18next";
import type { Video, Tag, Category } from '../../types';
import { useTagStore } from '../../store/useTagStore';
import { useShallow } from 'zustand/shallow';
import { TagBadge } from './TagBadge';
import { useAudioPreview } from '../../hooks/useAudioPreview';
import { useVideoPreview } from '../../hooks/useVideoPreview';
import { DeleteVideoModal } from './DeleteVideoModal';
import { VideoContextMenu } from './VideoContextMenu';
import { formatTime } from '../../utils/time';

interface Props {
  videos: Video[];
  currentVideoId: number | null;
  detailVideoId: number | null;
  scrollResetKey: string;
  listRowSize?: 'S' | 'M' | 'L' | 'XL';
  onPlay: (video: Video) => void;
  onShowDetail: (video: Video) => void;
  onAddToPlaylist?: (video: Video) => void;
  onSetTag?: (video: Video) => void;
  onSetCategory?: (video: Video) => void;
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
}: VideoRowProps) {
  const { t } = useTranslation();
  const isImage = v.media_type === 'image';
  const isAudio = v.media_type === 'audio';
  const isVideo = !isImage && !isAudio;
  const { isPreviewPlaying: isAudioPreviewPlaying, onMouseEnter: audioMouseEnter, onMouseLeave: audioMouseLeave } = useAudioPreview(v.path, isAudio);
  const { videoRef, isPreviewPlaying: isVideoPreviewPlaying, onMouseEnter: videoMouseEnter, onMouseLeave: videoMouseLeave } = useVideoPreview(v.path, isVideo && listRowSize !== 'S');
  const onMouseEnter = useCallback(() => { audioMouseEnter(); videoMouseEnter(); }, [audioMouseEnter, videoMouseEnter]);
  const onMouseLeave = useCallback(() => { audioMouseLeave(); videoMouseLeave(); }, [audioMouseLeave, videoMouseLeave]);
  const progressPercent =
    v.duration && v.duration > 0
      ? Math.min((v.progress / v.duration) * 100, 100)
      : null;

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

  const thumbClass = { S: 'w-10', M: 'w-16', L: 'w-24', XL: 'w-32' }[listRowSize];
  const compact = listRowSize === 'S';

  return (
    <div
      ref={rowRef}
      onContextMenu={(e) => { e.preventDefault(); onContextMenu(e, v); }}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      className={`group flex items-center gap-2 px-2 rounded-lg border transition-all cursor-pointer min-w-0 ${
        compact ? 'py-1' : 'py-1.5'
      } ${
        fileMissing
          ? 'border-red-500/60 opacity-60'
          : isSelected
            ? 'border-blue-400 dark:border-blue-500 bg-blue-50 dark:bg-blue-950/30'
            : isPlaying
              ? 'border-blue-500 bg-blue-50/60 dark:bg-blue-950/20'
              : isDetailVideo
                ? 'border-sky-400 dark:border-sky-500 bg-sky-50/60 dark:bg-sky-950/20'
                : 'border-transparent hover:border-gray-200 dark:hover:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800/50'
      }`}
      onClick={() => onShowDetail(v)}
      onDoubleClick={(e) => { e.stopPropagation(); onPlay(v); }}
    >
      {/* チェックボックス */}
      <div
        className={`shrink-0 transition-opacity ${isSelected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}
        onClick={(e) => { e.stopPropagation(); onCheckbox(e, v, idx); }}
      >
        <div
          className={`w-4 h-4 rounded border-2 flex items-center justify-center text-white text-[9px] font-bold transition-colors ${
            isSelected
              ? 'bg-blue-500 border-blue-500'
              : 'bg-white dark:bg-gray-800 border-gray-400 dark:border-gray-500 hover:bg-gray-100'
          }`}
        >
          {isSelected && '✓'}
        </div>
      </div>

      {/* カテゴリカラーバー */}
      {category ? (
        <div className="w-1 self-stretch rounded-full shrink-0" style={{ backgroundColor: category.color }} />
      ) : (
        <div className="w-1 shrink-0" />
      )}

      {/* サムネイル */}
      <div className={`relative bg-gray-200 dark:bg-gray-700 rounded overflow-hidden shrink-0 aspect-video ${thumbClass}`}>
        {v.thumbnail ? (
          <img
            src={convertFileSrc(v.thumbnail)}
            alt={title}
            className={`w-full h-full ${isImage ? 'object-contain bg-black' : 'object-cover'}`}
            loading="lazy"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-gray-400 dark:text-gray-500 text-base">
            {isImage ? '🖼' : isAudio ? '♪' : '▶'}
          </div>
        )}
        {progressPercent !== null && progressPercent > 0 && (
          <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-gray-300/40">
            <div className="h-full bg-blue-500" style={{ width: `${progressPercent}%` }} />
          </div>
        )}
        {isPlaying && (
          <div className="absolute inset-0 bg-blue-500/20 flex items-center justify-center">
            <span className="text-white text-[8px] font-semibold bg-blue-500 px-1 rounded leading-tight">
              {t('library.playing')}
            </span>
          </div>
        )}
        {isVideo && (
          <video
            ref={videoRef}
            muted
            playsInline
            className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-200 pointer-events-none ${
              isVideoPreviewPlaying ? 'opacity-100' : 'opacity-0'
            }`}
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
      </div>

      {/* タイトル・親ディレクトリ・タグ */}
      <div className="flex-1 min-w-0">
        <p className={`font-medium truncate text-gray-800 dark:text-gray-200 ${compact ? 'text-[11px]' : 'text-xs'}`}>
          {title}
        </p>
        {!compact && (
          <p className="text-[10px] truncate text-gray-400 dark:text-gray-500" title={v.path}>
            {parentDir}
          </p>
        )}
        {!compact && tags.length > 0 && (
          <div className="flex flex-wrap gap-0.5 mt-0.5">
            {tags.slice(0, 4).map((tag) => (
              <TagBadge key={tag.id} tag={tag} />
            ))}
            {tags.length > 4 && (
              <span className="text-[10px] text-gray-400 dark:text-gray-500">+{tags.length - 4}</span>
            )}
          </div>
        )}
      </div>

      {/* ファイルなしバッジ */}
      {fileMissing && (
        <span className="shrink-0 text-[10px] font-semibold px-1.5 py-0.5 rounded bg-red-600/80 text-white">
          {t('library.noFile')}
        </span>
      )}

      {/* メディアタイプバッジ */}
      {(isImage || isAudio) && (
        <span className="shrink-0 text-[10px] px-1.5 py-0.5 rounded bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-400">
          {isImage ? t('library.imageType') : t('library.audioType')}
        </span>
      )}

      {/* 再生時間 */}
      <span className="shrink-0 text-[11px] tabular-nums text-gray-500 dark:text-gray-400 w-14 text-right">
        {v.duration != null ? formatTime(v.duration) : ''}
      </span>

      {/* アクションボタン */}
      <div className="shrink-0 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        {onAddToPlaylist && (
          <button
            type="button"
            className="px-1.5 py-0.5 text-xs rounded bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-600 dark:text-gray-300"
            onClick={(e) => { e.stopPropagation(); onAddToPlaylist(v); }}
            title={t('library.addToPlaylist')}
          >
            +
          </button>
        )}
        <button
          type="button"
          className="px-1.5 py-0.5 text-xs rounded bg-blue-600/80 hover:bg-blue-600 text-white"
          onClick={(e) => { e.stopPropagation(); onPlay(v); }}
          title={t('library.play')}
        >
          ▶
        </button>
        <button
          type="button"
          className="px-1.5 py-0.5 text-xs rounded bg-red-600/80 hover:bg-red-600 text-white"
          onClick={(e) => { e.stopPropagation(); onDelete(v); }}
          title={t('library.deleteVideo')}
        >
          削除
        </button>
      </div>
    </div>
  );
});

export const LibraryList = forwardRef<LibraryViewHandle, Props>(function LibraryList({
  videos,
  currentVideoId,
  detailVideoId,
  scrollResetKey,
  listRowSize = 'M',
  onPlay,
  onShowDetail,
  onAddToPlaylist,
  onSetTag,
  onSetCategory,
  selectedIds,
  onSelectionChange,
}: Props, ref: React.Ref<LibraryViewHandle>) {
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
      <div ref={scrollRef} className="h-full overflow-y-auto select-none">
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
          onDelete={() => { setDeleteTarget(contextMenu.video); setContextMenu(null); }}
        />
      )}
    </>
  );
});
