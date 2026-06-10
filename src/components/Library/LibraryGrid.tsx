import { useRef, useState, useEffect, useMemo, useCallback, memo } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { convertFileSrc, invoke } from '@tauri-apps/api/core';
import type { Video, Tag, Category } from '../../types';
import { useTagStore } from '../../store/useTagStore';
import { TagBadge } from './TagBadge';
import { DeleteVideoModal } from './DeleteVideoModal';

interface VideoCardProps {
  video: Video;
  isPlaying: boolean;
  isSelected: boolean;
  isDetailVideo: boolean;
  tags: Tag[];
  category: Category | null;
  idx: number;
  onPlay: (video: Video) => void;
  onShowDetail: (video: Video) => void;
  onAddToPlaylist?: (video: Video) => void;
  onDelete: (video: Video) => void;
  onCheckbox: (e: React.MouseEvent, video: Video, idx: number) => void;
}

const VideoCard = memo(function VideoCard({
  video: v,
  isPlaying,
  isSelected,
  isDetailVideo,
  tags,
  category,
  idx,
  onPlay,
  onShowDetail,
  onAddToPlaylist,
  onDelete,
  onCheckbox,
}: VideoCardProps) {
  const isImage = v.media_type === 'image';
  const isAudio = v.media_type === 'audio';
  const handlePrimaryClick = () => onShowDetail(v);
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
    const el = cardRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && !checkedRef.current) {
          checkedRef.current = true;
          invoke<boolean>('path_exists', { path: v.path }).then((exists) => {
            if (!exists) setFileMissing(true);
          });
        }
      },
      { threshold: 0.1 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [v.path]);

  return (
    <div
      ref={cardRef}
      className={`group relative cursor-pointer rounded-lg overflow-hidden border-2 transition-all hover:shadow-md dark:hover:shadow-black/40 ${
        fileMissing
          ? 'border-red-500/60 opacity-60'
          : isSelected
            ? 'border-blue-400 dark:border-blue-500'
            : isPlaying
              ? 'border-blue-500'
              : isDetailVideo
                ? 'border-sky-400 dark:border-sky-500'
                : 'border-transparent hover:border-gray-200 dark:hover:border-gray-600'
      }`}
    >
      {fileMissing && (
        <div className="absolute inset-0 z-10 flex items-center justify-center pointer-events-none">
          <span className="bg-red-600/80 text-white text-xs font-semibold px-2 py-0.5 rounded shadow">
            ファイルなし
          </span>
        </div>
      )}
      {category && (
        <div className="h-1 shrink-0" style={{ backgroundColor: category.color }} />
      )}

      <div
        className="relative bg-gray-200 dark:bg-gray-700 aspect-video"
        onClick={handlePrimaryClick}
        onDoubleClick={(e) => { e.stopPropagation(); onPlay(v); }}
      >
        {v.thumbnail ? (
          <img
            src={convertFileSrc(v.thumbnail)}
            alt={v.title ?? ''}
            className={`w-full h-full ${isImage ? 'object-contain bg-black' : 'object-cover'}`}
            loading="lazy"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-gray-400 dark:text-gray-500 text-2xl">
            {isImage ? '🖼' : isAudio ? '♪' : '▶'}
          </div>
        )}
        {/* メディアタイプバッジ */}
        {(isImage || isAudio) && (
          <div className="absolute top-1 right-1 bg-black/60 text-white text-[10px] px-1 py-0.5 rounded pointer-events-none">
            {isImage ? '画像' : '音声'}
          </div>
        )}

        <div
          className={`absolute top-1 left-1 transition-opacity ${
            isSelected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
          }`}
          onClick={(e) => onCheckbox(e, v, idx)}
        >
          <div
            className={`w-5 h-5 rounded border-2 flex items-center justify-center text-white text-xs font-bold transition-colors ${
              isSelected
                ? 'bg-blue-500 border-blue-500'
                : 'bg-black/40 border-white/70 hover:bg-black/60'
            }`}
          >
            {isSelected && '✓'}
          </div>
        </div>

        {v.has_audio === 0 && (
          <div className="absolute top-1 left-1 pointer-events-none group-hover:opacity-0 transition-opacity">
            <div className="bg-black/60 rounded p-0.5">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="white" className="w-3.5 h-3.5">
                <path d="M9.547 3.062A.75.75 0 0 1 10 3.75v12.5a.75.75 0 0 1-1.264.546L4.703 13H3.167a.75.75 0 0 1-.7-.48A6.985 6.985 0 0 1 2 10c0-.887.165-1.737.468-2.52a.75.75 0 0 1 .699-.48h1.536l4.033-3.296a.75.75 0 0 1 .811-.142ZM13.28 7.22a.75.75 0 1 0-1.06 1.06L13.44 9.5l-1.22 1.22a.75.75 0 1 0 1.06 1.06l1.22-1.22 1.22 1.22a.75.75 0 1 0 1.06-1.06L15.56 9.5l1.22-1.22a.75.75 0 0 0-1.06-1.06L14.5 8.44l-1.22-1.22Z" />
              </svg>
            </div>
          </div>
        )}

        {isPlaying && (
          <div className="absolute top-1 right-1 bg-blue-500 text-white text-xs px-1 rounded">
            再生中
          </div>
        )}
        <div className="absolute bottom-1 right-1 opacity-0 group-hover:opacity-100 flex gap-1 transition-opacity">
          {onAddToPlaylist && (
            <button
              type="button"
              className="bg-black/60 hover:bg-black/80 text-white text-xs px-1.5 py-0.5 rounded"
              onClick={(e) => { e.stopPropagation(); onAddToPlaylist(v); }}
              title="プレイリストに追加"
            >
              +
            </button>
          )}
          <button
            type="button"
            className="bg-blue-600/80 hover:bg-blue-600 text-white text-xs px-1.5 py-0.5 rounded"
            onClick={(e) => { e.stopPropagation(); onPlay(v); }}
            title="再生"
          >
            ▶
          </button>
          <button
            type="button"
            className="bg-red-600/80 hover:bg-red-600 text-white text-xs px-1.5 py-0.5 rounded"
            onClick={(e) => { e.stopPropagation(); onDelete(v); }}
            title="動画を削除"
          >
            削除
          </button>
        </div>
      </div>

      {progressPercent !== null && progressPercent > 0 ? (
        <div className="h-1 bg-gray-200 dark:bg-gray-700">
          <div className="h-full bg-blue-500" style={{ width: `${progressPercent}%` }} />
        </div>
      ) : v.progress > 0 && progressPercent === null ? (
        <div className="h-1 bg-blue-500" />
      ) : null}

      <div className="p-1.5 bg-white dark:bg-gray-800" onClick={handlePrimaryClick} onDoubleClick={(e) => { e.stopPropagation(); onPlay(v); }}>
        <p className="text-xs truncate text-gray-800 dark:text-gray-200 mb-1">
          {v.title ?? v.path.split('/').pop()}
        </p>
        {tags.length > 0 && (
          <div className="flex flex-wrap gap-0.5">
            {tags.slice(0, 3).map((tag) => (
              <TagBadge key={tag.id} tag={tag} />
            ))}
            {tags.length > 3 && (
              <span className="text-[10px] text-gray-400 dark:text-gray-500">
                +{tags.length - 3}
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
});

interface Props {
  videos: Video[];
  currentVideoId: number | null;
  detailVideoId?: number | null;
  scrollResetKey?: string | number;
  onPlay: (video: Video) => void;
  onShowDetail: (video: Video) => void;
  onAddToPlaylist?: (video: Video) => void;
  selectedIds: Set<number>;
  onSelectionChange: (ids: Set<number>) => void;
}

const ITEM_MIN_WIDTH = 160;
const GAP = 16; // gap-4

export function LibraryGrid({
  videos,
  currentVideoId,
  detailVideoId,
  scrollResetKey,
  onPlay,
  onShowDetail,
  onAddToPlaylist,
  selectedIds,
  onSelectionChange,
}: Props) {
  // 個別セレクタ: tags が変わっても LibraryGrid は再レンダリングされない
  const videoTags = useTagStore((s) => s.videoTags);
  const categories = useTagStore((s) => s.categories);
  const [deleteTarget, setDeleteTarget] = useState<Video | null>(null);
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
      const cols = Math.max(1, Math.floor((el.clientWidth + GAP) / (ITEM_MIN_WIDTH + GAP)));
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
  }, []);

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
  });

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

  return (
    <>
      <div ref={scrollRef} className="h-full overflow-y-auto select-none">
        {videos.length === 0 ? (
          <p className="text-gray-400 mt-4 text-sm dark:text-gray-500">
            動画が見つかりません。ディレクトリをスキャンしてください。
          </p>
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
                    className="grid pb-4"
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
                          idx={idx}
                          onPlay={onPlay}
                          onShowDetail={onShowDetail}
                          onAddToPlaylist={onAddToPlaylist}
                          onDelete={setDeleteTarget}
                          onCheckbox={handleCheckbox}
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
    </>
  );
}
