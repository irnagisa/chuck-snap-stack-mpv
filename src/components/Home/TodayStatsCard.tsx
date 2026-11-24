import { useHomeStore } from "../../store/useHomeStore";
import homeStyles from "./Home.module.css";

export function TodayStatsCard() {
  const libraryStats = useHomeStore((s) => s.libraryStats);

  const todayAdded = libraryStats?.todayAdded ?? 0;
  const todayWatched = libraryStats?.todayWatched ?? 0;

  return (
    <section className={homeStyles.section}>
      <h2 className="text-sm font-bold text-gray-500 dark:text-gray-400 mb-3">今日の活動</h2>
      <div className="grid grid-cols-2 divide-x divide-gray-100 dark:divide-gray-800">
        <div className="flex flex-col items-center justify-center py-3">
          <span className="text-2xl font-bold tabular-nums">{todayAdded}</span>
          <span className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">追加</span>
        </div>
        <div className="flex flex-col items-center justify-center py-3">
          <span className="text-2xl font-bold tabular-nums">{todayWatched}</span>
          <span className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">視聴</span>
        </div>
      </div>
    </section>
  );
}
