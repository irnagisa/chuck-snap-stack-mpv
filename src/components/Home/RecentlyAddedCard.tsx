import { useHomeStore } from "../../store/useHomeStore";
import type { Video } from "../../types";
import homeStyles from "./Home.module.css";
import cardStyles from "../Library/VideoCard.module.css";
import { MediaThumb } from "../Library/MediaThumb";

interface Props {
  onOpen: (video: Video) => void;
}

export function RecentlyAddedCard({ onOpen }: Props) {
  const recentVideos = useHomeStore((s) => s.recentVideos);

  if (recentVideos.length === 0) return null;

  return (
    <section className={homeStyles.section}>
      <h2 className={homeStyles.heading}>最近追加</h2>
      <div className={homeStyles.strip}>
        {recentVideos.map((v) => (
          <button type="button" key={v.id} className={cardStyles.tile} onClick={() => onOpen(v)}>
            <MediaThumb video={v} compact />
            <p className={cardStyles.tileTitle} title={v.title ?? undefined}>
              {v.title ?? v.path.split("/").pop()}
            </p>
          </button>
        ))}
      </div>
    </section>
  );
}
