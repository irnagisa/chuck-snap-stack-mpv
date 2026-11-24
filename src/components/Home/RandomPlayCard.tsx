import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { Video } from "../../types";
import { Play, Shuffle } from "lucide-react";
import { Button } from "../ui";
import homeStyles from "./Home.module.css";
import cardStyles from "../Library/VideoCard.module.css";
import { MediaThumb } from "../Library/MediaThumb";

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
    <section className={homeStyles.section}>
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
        <ul className={homeStyles.strip}>
          {videos.map((video) => (
            <li key={video.id} className={cardStyles.tile} onClick={() => onOpen(video)}>
              <MediaThumb video={video} compact>
                <button
                  type="button"
                  className={`${cardStyles.playButton} ${cardStyles.hoverOnly}`}
                  data-size="sm"
                  onClick={(e) => { e.stopPropagation(); onOpen(video); }}
                  aria-label="再生"
                  title="再生"
                >
                  <Play aria-hidden fill="currentColor" />
                </button>
              </MediaThumb>
              <p className={cardStyles.tileTitle} title={video.title ?? fileName(video.path)}>
                {video.title ?? fileName(video.path)}
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
