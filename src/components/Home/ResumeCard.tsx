import { useHomeStore } from "../../store/useHomeStore";
import type { Video } from "../../types";
import { Play } from "lucide-react";
import { Button } from "../ui";

interface Props {
  onOpen: (video: Video) => void;
}

function dirName(path: string): string {
  const parts = path.replace(/\\/g, "/").split("/");
  return parts[parts.length - 2] ?? "";
}

function fileName(path: string): string {
  return path.replace(/\\/g, "/").split("/").pop() ?? path;
}

export function ResumeCard({ onOpen }: Props) {
  const lastViewed = useHomeStore((s) => s.lastViewed);

  if (!lastViewed) return null;
  const { video, lastViewedAt } = lastViewed;

  return (
    <section className="border border-gray-200 dark:border-gray-800 rounded-lg p-4">
      <h2 className="text-sm font-bold text-gray-500 dark:text-gray-400 mb-3">続きから整理</h2>
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <p className="font-bold truncate">{dirName(video.path)}</p>
          <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
            最後に閲覧: {video.title ?? fileName(video.path)}
          </p>
          <p className="text-xs text-gray-400 dark:text-gray-500">
            {new Date(lastViewedAt).toLocaleString()}
          </p>
        </div>
        <Button variant="primary" size="md" onClick={() => onOpen(video)}>
          <Play aria-hidden fill="currentColor" />
          再開
        </Button>
      </div>
    </section>
  );
}
