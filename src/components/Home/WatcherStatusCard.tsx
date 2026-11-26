import { useHomeStore } from "../../store/useHomeStore";
import homeStyles from "./Home.module.css";

export function WatcherStatusCard() {
  const watchingPaths = useHomeStore((s) => s.watchingPaths);

  const isActive = watchingPaths.length > 0;

  return (
    <section className={homeStyles.section}>
      <div className={homeStyles.watcherHead}>
        <span className={homeStyles.watcherDot} data-active={isActive || undefined} aria-hidden />
        <h2 className={homeStyles.heading}>ファイルウォッチャー</h2>
        <span className={homeStyles.watcherStatus}>
          {isActive ? `${watchingPaths.length} フォルダ監視中` : "停止中"}
        </span>
      </div>
      {isActive && (
        <ul className={homeStyles.watchPaths}>
          {watchingPaths.map((p) => (
            <li key={p} className={homeStyles.truncate} title={p}>
              {p}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
