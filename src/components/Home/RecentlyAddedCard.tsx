import { convertFileSrc } from "@tauri-apps/api/core";
import { useHomeStore } from "../../store/useHomeStore";
import { formatTime } from "../../utils/time";
import type { Video } from "../../types";

interface Props {
  onOpen: (video: Video) => void;
}

export function RecentlyAddedCard({ onOpen }: Props) {
  const recentVideos = useHomeStore((s) => s.recentVideos);

  if (recentVideos.length === 0) return null;

  return (
    <section className="border border-gray-200 dark:border-gray-800 rounded-lg p-4">
      <h2 className="text-sm font-bold text-gray-500 dark:text-gray-400 mb-3">最近追加</h2>
      <div className="flex gap-2 overflow-x-auto pb-1">
        {recentVideos.map((v) => (
          <button
            type="button"
            key={v.id}
            className="relative shrink-0 w-32 aspect-video bg-gray-200 dark:bg-gray-700 rounded overflow-hidden"
            onClick={() => onOpen(v)}
          >
            {v.thumbnail ? (
              <img
                src={convertFileSrc(v.thumbnail)}
                alt={v.title ?? ""}
                className="w-full h-full object-cover"
                loading="lazy"
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-gray-400 dark:text-gray-500 text-2xl">
                {v.media_type === "image" ? "🖼" : v.media_type === "audio" ? "♪" : "▶"}
              </div>
            )}
            {v.duration != null && v.media_type !== "image" && (
              <span className="absolute bottom-1 right-1 px-1 rounded bg-black/70 text-white text-[10px] leading-4 tabular-nums">
                {formatTime(v.duration)}
              </span>
            )}
          </button>
        ))}
      </div>
    </section>
  );
}
