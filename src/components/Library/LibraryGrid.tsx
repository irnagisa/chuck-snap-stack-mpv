import { convertFileSrc } from '@tauri-apps/api/core';
import type { Video } from '../../types';

interface Props {
  videos: Video[];
  currentVideoId: number | null;
  onPlay: (video: Video) => void;
}

export function LibraryGrid({ videos, currentVideoId, onPlay }: Props) {
  if (videos.length === 0) {
    return (
      <p className="text-gray-400 mt-4 text-sm dark:text-gray-500">
        動画が見つかりません。ディレクトリをスキャンしてください。
      </p>
    );
  }

  return (
    <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))' }}>
      {videos.map((v) => {
        const isPlaying = v.id === currentVideoId;
        const hasProgress = v.progress > 0;
        const progressPercent =
          v.duration && v.duration > 0
            ? Math.min((v.progress / v.duration) * 100, 100)
            : null; // duration 不明でも progress があれば別表示

        return (
          <div
            key={v.id}
            onClick={() => onPlay(v)}
            className={`cursor-pointer rounded-lg overflow-hidden border-2 transition-all hover:shadow-md dark:hover:shadow-black/40 ${
              isPlaying
                ? 'border-blue-500'
                : 'border-transparent hover:border-gray-200 dark:hover:border-gray-600'
            }`}
          >
            <div className="relative bg-gray-200 dark:bg-gray-700 aspect-video">
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
            </div>

            {/* プログレスバー: duration あり → 割合バー、なし → 再生済みドット */}
            {progressPercent !== null && progressPercent > 0 ? (
              <div className="h-1 bg-gray-200 dark:bg-gray-700">
                <div className="h-full bg-blue-500" style={{ width: `${progressPercent}%` }} />
              </div>
            ) : hasProgress && progressPercent === null ? (
              <div className="h-1 bg-blue-500" />
            ) : null}

            <div className="p-1.5 bg-white dark:bg-gray-800">
              <p className="text-xs truncate text-gray-800 dark:text-gray-200">
                {v.title ?? v.path.split('/').pop()}
              </p>
            </div>
          </div>
        );
      })}
    </div>
  );
}
