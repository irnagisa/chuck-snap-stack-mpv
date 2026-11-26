import { useHomeStore } from "../../store/useHomeStore";
import homeStyles from "./Home.module.css";

export function TodayStatsCard() {
  const libraryStats = useHomeStore((s) => s.libraryStats);

  const todayAdded = libraryStats?.todayAdded ?? 0;
  const todayWatched = libraryStats?.todayWatched ?? 0;

  return (
    <section className={homeStyles.section}>
      <h2 className={homeStyles.heading}>今日の活動</h2>
      <div className={homeStyles.stats}>
        <div className={homeStyles.statTile}>
          <span className={`${homeStyles.statValue} ${homeStyles.statValueLarge}`}>{todayAdded}</span>
          <span className={homeStyles.statLabel}>追加</span>
        </div>
        <div className={homeStyles.statTile}>
          <span className={`${homeStyles.statValue} ${homeStyles.statValueLarge}`}>{todayWatched}</span>
          <span className={homeStyles.statLabel}>視聴</span>
        </div>
      </div>
    </section>
  );
}
