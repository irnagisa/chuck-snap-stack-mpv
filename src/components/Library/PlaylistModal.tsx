import { useState, useEffect } from 'react';
import { convertFileSrc } from '@tauri-apps/api/core';
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
  arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { Playlist, Video } from '../../types';
import { usePlaylistStore } from '../../store/usePlaylistStore';
import { usePlayerStore } from '../../store/usePlayerStore';

interface SortableItemProps {
  video: Video;
  index: number;
  onPlay: (index: number) => void;
  onRemove: (videoId: number) => void;
}

function SortableItem({ video, index, onPlay, onRemove }: SortableItemProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: video.id,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="flex items-center gap-3 px-4 py-2 hover:bg-gray-50 dark:hover:bg-gray-800 group"
    >
      {/* ドラッグハンドル */}
      <button
        type="button"
        className="text-gray-300 dark:text-gray-600 hover:text-gray-500 dark:hover:text-gray-400 cursor-grab active:cursor-grabbing shrink-0 touch-none"
        {...attributes}
        {...listeners}
        title="ドラッグして並び替え"
      >
        ⠿
      </button>

      {/* 番号 */}
      <span className="text-xs text-gray-400 dark:text-gray-500 w-5 text-right shrink-0">
        {index + 1}
      </span>

      {/* サムネイル */}
      <div
        className="w-16 h-9 bg-gray-200 dark:bg-gray-700 rounded overflow-hidden shrink-0 cursor-pointer"
        onClick={() => onPlay(index)}
      >
        {video.thumbnail ? (
          <img
            src={convertFileSrc(video.thumbnail)}
            alt={video.title ?? ''}
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-gray-400 text-sm">▶</div>
        )}
      </div>

      {/* タイトル */}
      <span
        className="flex-1 text-sm text-gray-800 dark:text-gray-200 truncate cursor-pointer hover:text-blue-600 dark:hover:text-blue-400"
        onClick={() => onPlay(index)}
      >
        {video.title ?? video.path.split('/').pop()}
      </span>

      {/* 時間 */}
      {video.duration != null && (
        <span className="text-xs text-gray-400 dark:text-gray-500 shrink-0">
          {Math.floor(video.duration / 60)}:{String(Math.floor(video.duration % 60)).padStart(2, '0')}
        </span>
      )}

      {/* 削除ボタン */}
      <button
        type="button"
        className="opacity-0 group-hover:opacity-100 text-xs text-red-500 hover:text-red-400 shrink-0 transition-opacity"
        onClick={() => onRemove(video.id)}
        title="プレイリストから削除"
      >
        ×
      </button>
    </div>
  );
}

interface Props {
  playlist: Playlist;
  onClose: () => void;
}

export function PlaylistModal({ playlist, onClose }: Props) {
  const { fetchPlaylistVideos, removeVideoFromPlaylist, reorderPlaylistItems } = usePlaylistStore();
  const { playWithQueue } = usePlayerStore();
  const [videos, setVideos] = useState<Video[]>([]);
  const [loading, setLoading] = useState(true);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  );

  const loadVideos = async () => {
    setLoading(true);
    const result = await fetchPlaylistVideos(playlist.id);
    setVideos(result);
    setLoading(false);
  };

  useEffect(() => {
    loadVideos();
  }, [playlist.id]);

  const handlePlayAll = async () => {
    if (videos.length === 0) return;
    await playWithQueue(videos, 0);
    onClose();
  };

  const handlePlayOne = async (_video: Video, index: number) => {
    await playWithQueue(videos, index);
    onClose();
  };

  const handleRemove = async (videoId: number) => {
    await removeVideoFromPlaylist(playlist.id, videoId);
    setVideos((prev) => prev.filter((v) => v.id !== videoId));
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = videos.findIndex((v) => v.id === active.id);
    const newIndex = videos.findIndex((v) => v.id === over.id);
    const reordered = arrayMove(videos, oldIndex, newIndex);
    setVideos(reordered);
    await reorderPlaylistItems(playlist.id, reordered.map((v) => v.id));
  };

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-white dark:bg-gray-900 rounded-xl shadow-2xl w-[480px] max-h-[80vh] flex flex-col overflow-hidden">
        {/* ヘッダー */}
        <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700 flex items-center gap-3">
          <h2 className="flex-1 text-sm font-semibold text-gray-900 dark:text-gray-100 truncate">
            {playlist.name}
          </h2>
          <button
            type="button"
            disabled={videos.length === 0}
            className="px-3 py-1 text-xs bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white rounded shrink-0"
            onClick={handlePlayAll}
          >
            ▶ すべて再生
          </button>
          <button
            type="button"
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 text-lg leading-none"
            onClick={onClose}
          >
            ×
          </button>
        </div>

        {/* 動画リスト */}
        <div className="flex-1 overflow-y-auto">
          {loading && (
            <p className="text-xs text-gray-400 dark:text-gray-500 p-4">読み込み中...</p>
          )}
          {!loading && videos.length === 0 && (
            <p className="text-xs text-gray-400 dark:text-gray-500 p-4">
              動画がありません。ライブラリから追加してください。
            </p>
          )}
          {!loading && videos.length > 0 && (
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={handleDragEnd}
            >
              <SortableContext
                items={videos.map((v) => v.id)}
                strategy={verticalListSortingStrategy}
              >
                {videos.map((v, idx) => (
                  <SortableItem
                    key={v.id}
                    video={v}
                    index={idx}
                    onPlay={(index) => handlePlayOne(v, index)}
                    onRemove={handleRemove}
                  />
                ))}
              </SortableContext>
            </DndContext>
          )}
        </div>

        {!loading && (
          <div className="px-4 py-2 border-t border-gray-200 dark:border-gray-700 text-xs text-gray-400 dark:text-gray-500">
            {videos.length} 件
          </div>
        )}
      </div>
    </div>
  );
}
