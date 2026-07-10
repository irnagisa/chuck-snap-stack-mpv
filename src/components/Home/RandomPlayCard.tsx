import { useEffect, useState } from "react";
import { invoke, convertFileSrc } from "@tauri-apps/api/core";
import { formatTime } from "../../utils/time";
import type { Video } from "../../types";

interface Props {
  onOpen: (video: Video) => void;
}

export function RandomPlayCard({ onOpen }: Props) {
  const [videos, setVideos] = useState<Video[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  async function fetchRandom() {
    setIsLoading(true);
    try {
      const vs = await invoke<Video[]>("db_get_random_video");
      setVideos(vs);
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    fetchRandom();
  }, []);

  const fileName = (path: string) => path.split("/").pop() ?? path;

  return (
    <section className="border border-gray-200 dark:border-gray-800 rounded-lg p-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-bold text-gray-500 dark:text-gray-400">ランダム再生</h2>
        <button
          onClick={fetchRandom}
          disabled={isLoading}
          className="flex items-center gap-1 text-xs text-gray-400 dark:text-gray-500
                     hover:text-gray-600 dark:hover:text-gray-300 disabled:opacity-40 transition-colors"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="16 3 21 3 21 8" />
            <line x1="4" y1="20" x2="21" y2="3" />
            <polyline points="21 16 21 21 16 21" />
            <line x1="15" y1="15" x2="21" y2="21" />
          </svg>
          別の動画
        </button>
      </div>

      {isLoading && videos.length === 0 && (
        <div className="h-24 flex items-center justify-center text-sm text-gray-400 dark:text-gray-500">
          読み込み中...
        </div>
      )}

      {!isLoading && videos.length === 0 && (
        <div className="h-24 flex items-center justify-center text-sm text-gray-400 dark:text-gray-500">
          動画が見つかりません
        </div>
      )}

      {videos.length > 0 && (
        <ul className="flex gap-3 overflow-x-auto pb-1">
          {videos.map((video) => (
            <li key={video.id} className="flex flex-col shrink-0 w-36 gap-1.5">
              {/* サムネイル */}
              <div className="relative w-full aspect-video bg-gray-200 dark:bg-gray-700 rounded overflow-hidden">
                {video.thumbnail ? (
                  <img
                    src={convertFileSrc(video.thumbnail)}
                    alt={video.title ?? ""}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-gray-400 dark:text-gray-500 text-xl">
                    {video.media_type === "audio" ? "♪" : "▶"}
                  </div>
                )}
                {video.duration != null && (
                  <span className="absolute bottom-0.5 right-0.5 px-1 rounded bg-black/70 text-white text-[9px] leading-4 tabular-nums">
                    {formatTime(video.duration)}
                  </span>
                )}
              </div>

              {/* タイトル + 再生ボタン */}
              <p className="text-xs font-medium leading-snug line-clamp-2 text-gray-800 dark:text-gray-200">
                {video.title ?? fileName(video.path)}
              </p>
              <button
                onClick={() => onOpen(video)}
                className="self-start flex items-center gap-1 px-2 py-1 text-xs font-medium rounded
                           bg-blue-600 hover:bg-blue-700 text-white transition-colors"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="w-3 h-3" viewBox="0 0 24 24" fill="currentColor">
                  <polygon points="5 3 19 12 5 21 5 3" />
                </svg>
                再生
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
