import { useEffect } from "react";
import { useHomeStore } from "../../store/useHomeStore";
import { NewItemsCard } from "./NewItemsCard";
import { ResumeCard } from "./ResumeCard";
import { RecentlyAddedCard } from "./RecentlyAddedCard";
import { RecentFoldersCard } from "./RecentFoldersCard";
import { LibraryInfoCard } from "./LibraryInfoCard";
import { TodayStatsCard } from "./TodayStatsCard";
import { RandomPlayCard } from "./RandomPlayCard";
import { WatcherStatusCard } from "./WatcherStatusCard";
import type { Video } from "../../types";
import styles from "./Home.module.css";

interface Props {
  /** ライブラリを新着だけに絞り込んで開く */
  onShowNew: () => void;
  onOpenVideo: (video: Video) => void;
  onOpenFolder: (dir: string) => void;
}

export function HomeView({ onShowNew, onOpenVideo, onOpenFolder }: Props) {
  const fetchHomeData = useHomeStore((s) => s.fetchHomeData);

  useEffect(() => {
    fetchHomeData();
  }, [fetchHomeData]);

  return (
    <div className={styles.view}>
      <div className={styles.column}>
        <NewItemsCard onShow={onShowNew} />
        <TodayStatsCard />
        <RandomPlayCard onOpen={onOpenVideo} />
        <ResumeCard onOpen={onOpenVideo} />
        <RecentlyAddedCard onOpen={onOpenVideo} />
        <RecentFoldersCard onSelect={onOpenFolder} />
        <LibraryInfoCard />
        <WatcherStatusCard />
      </div>
    </div>
  );
}
