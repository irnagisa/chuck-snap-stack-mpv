import { useEffect, useState } from "react";
import { invoke, convertFileSrc } from "@tauri-apps/api/core";
import { formatTime } from "../../utils/time";
import type { Video } from "../../types";
import { Play, Shuffle } from "lucide-react";
import { Button } from "../ui";

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
        <Button size="xs" variant="ghost" onClick={fetchRandom} disabled={isLoading}>
          <Shuffle aria-hidden />
          別の動画
        </Button>
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
              <Button size="xs" variant="primary" className="self-start" onClick={() => onOpen(video)}>
                <Play aria-hidden fill="currentColor" />
                再生
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
