import { useHomeStore } from "../../store/useHomeStore";
import type { Video } from "../../types";
import { Play } from "lucide-react";
import { Button } from "../ui";
import homeStyles from "./Home.module.css";
import cardStyles from "../Library/VideoCard.module.css";
import { MediaThumb } from "../Library/MediaThumb";

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
    <section className={homeStyles.section}>
      <h2 className={homeStyles.heading}>続きから整理</h2>
      <div className={homeStyles.resume}>
        <button type="button" className={cardStyles.tile} onClick={() => onOpen(video)}>
          <MediaThumb video={video} compact />
        </button>
        <div className={homeStyles.resumeText}>
          <p className={`${homeStyles.resumeFolder} ${homeStyles.truncate}`}>{dirName(video.path)}</p>
          <p className={`${homeStyles.muted} ${homeStyles.truncate}`}>
            最後に閲覧: {video.title ?? fileName(video.path)}
          </p>
          <p className={homeStyles.subtle}>
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
