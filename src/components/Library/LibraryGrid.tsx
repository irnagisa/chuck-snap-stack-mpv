import { useState } from 'react';
import { convertFileSrc } from '@tauri-apps/api/core';
import type { Video } from '../../types';
import { useTagStore } from '../../store/useTagStore';
import { TagBadge } from './TagBadge';
import { DeleteVideoModal } from './DeleteVideoModal';

interface Props {
  videos: Video[];
  currentVideoId: number | null;
  onPlay: (video: Video) => void;
  onShowDetail: (video: Video) => void;
  onAddToPlaylist?: (video: Video) => void;
}

export function LibraryGrid({ videos, currentVideoId, onPlay, onShowDetail, onAddToPlaylist }: Props) {
  const { videoTags, categories } = useTagStore();
  const [deleteTarget, setDeleteTarget] = useState<Video | null>(null);
  const categoryMap = Object.fromEntries(categories.map((c) => [c.id, c]));

  if (videos.length === 0) {
    return (
      <p className="text-gray-400 mt-4 text-sm dark:text-gray-500">
        動画が見つかりません。ディレクトリをスキャンしてください。
      </p>
    );
  }

  return (
    <>
    <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))' }}>
      {videos.map((v) => {
        const isPlaying = v.id === currentVideoId;
        const hasProgress = v.progress > 0;
        const progressPercent =
          v.duration && v.duration > 0
            ? Math.min((v.progress / v.duration) * 100, 100)
            : null;
        const tags = videoTags[v.id] ?? [];
        const category = v.category_id != null ? categoryMap[v.category_id] : null;

        return (
          <div
            key={v.id}
            className={`group cursor-pointer rounded-lg overflow-hidden border-2 transition-all hover:shadow-md dark:hover:shadow-black/40 ${
              isPlaying
                ? 'border-blue-500'
                : 'border-transparent hover:border-gray-200 dark:hover:border-gray-600'
            }`}
          >
            {/* カテゴリカラーストライプ */}
            {category && (
              <div className="h-1 shrink-0" style={{ backgroundColor: category.color }} />
            )}

            <div
              className="relative bg-gray-200 dark:bg-gray-700 aspect-video"
              onClick={() => onPlay(v)}
            >
              {v.thumbnail ? (
                <img
                  src={convertFileSrc(v.thumbnail)}
                  alt={v.title ?? ''}
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-gray-400 dark:text-gray-500 text-2xl">
                  ▶
                </div>
              )}
              {isPlaying && (
                <div className="absolute top-1 right-1 bg-blue-500 text-white text-xs px-1 rounded">
                  再生中
                </div>
              )}
              {/* ホバー時ボタン群 */}
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
                  className="bg-black/60 hover:bg-black/80 text-white text-xs px-1.5 py-0.5 rounded"
                  onClick={(e) => { e.stopPropagation(); onShowDetail(v); }}
                  title="動画の詳細を表示"
                >
                  詳細
                </button>
                <button
                  type="button"
                  className="bg-red-600/80 hover:bg-red-600 text-white text-xs px-1.5 py-0.5 rounded"
                  onClick={(e) => { e.stopPropagation(); setDeleteTarget(v); }}
                  title="動画を削除"
                >
                  削除
                </button>
              </div>
            </div>

            {/* プログレスバー */}
            {progressPercent !== null && progressPercent > 0 ? (
              <div className="h-1 bg-gray-200 dark:bg-gray-700">
                <div className="h-full bg-blue-500" style={{ width: `${progressPercent}%` }} />
              </div>
            ) : hasProgress && progressPercent === null ? (
              <div className="h-1 bg-blue-500" />
            ) : null}

            <div className="p-1.5 bg-white dark:bg-gray-800" onClick={() => onPlay(v)}>
              <p className="text-xs truncate text-gray-800 dark:text-gray-200 mb-1">
                {v.title ?? v.path.split('/').pop()}
              </p>
              {tags.length > 0 && (
                <div className="flex flex-wrap gap-0.5">
                  {tags.slice(0, 3).map((tag) => (
                    <TagBadge key={tag.id} tag={tag} />
                  ))}
                  {tags.length > 3 && (
                    <span className="text-[10px] text-gray-400 dark:text-gray-500">+{tags.length - 3}</span>
                  )}
                </div>
              )}
            </div>
          </div>
        );
      })}
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
