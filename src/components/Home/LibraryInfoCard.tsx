import { useHomeStore, type DiskInfo } from "../../store/useHomeStore";
import { useTagStore } from "../../store/useTagStore";
import homeStyles from "./Home.module.css";

function StatTile({ label, value }: { label: string; value: number }) {
  return (
    <div className={homeStyles.statTile}>
      <span className={homeStyles.statValue}>{value.toLocaleString()}</span>
      <span className={homeStyles.statLabel}>{label}</span>
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes >= 1_000_000_000_000) return `${(bytes / 1_000_000_000_000).toFixed(1)} TB`;
  if (bytes >= 1_000_000_000) return `${(bytes / 1_000_000_000).toFixed(1)} GB`;
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(0)} MB`;
  return `${(bytes / 1_000).toFixed(0)} KB`;
}

function DiskBar({ disk }: { disk: DiskInfo }) {
  const usedPct = disk.totalBytes > 0 ? (disk.usedBytes / disk.totalBytes) * 100 : 0;
  const level = usedPct >= 90 ? "danger" : usedPct >= 75 ? "warning" : undefined;
  return (
    <div className={homeStyles.meter}>
      <div className={homeStyles.meterHead}>
        <span>ストレージ</span>
        <span>{formatBytes(disk.usedBytes)} / {formatBytes(disk.totalBytes)}</span>
      </div>
      <div className={homeStyles.meterTrack}>
        <div className={homeStyles.meterBar} data-level={level} style={{ width: `${usedPct}%` }} />
      </div>
      <div className={homeStyles.meterFoot}>空き {formatBytes(disk.availableBytes)}</div>
    </div>
  );
}

export function LibraryInfoCard() {
  const libraryStats = useHomeStore((s) => s.libraryStats);
  const diskInfo = useHomeStore((s) => s.diskInfo);
  const tags = useTagStore((s) => s.tags);

  const videoCount = libraryStats?.videoCount ?? 0;
  const watchedCount = libraryStats?.watchedCount ?? 0;
  const unwatchedCount = Math.max(0, videoCount - watchedCount);
  const watchedPct = videoCount > 0 ? Math.round((watchedCount / videoCount) * 100) : 0;

  return (
    <section className={homeStyles.section}>
      <h2 className={homeStyles.heading}>ライブラリ情報</h2>
      <div className={`${homeStyles.stats} ${homeStyles.stats3}`}>
        <StatTile label="画像" value={libraryStats?.imageCount ?? 0} />
        <StatTile label="動画" value={videoCount} />
        <StatTile label="タグ" value={tags.length} />
      </div>
      {videoCount > 0 && (
        <div className={homeStyles.meter}>
          <div className={homeStyles.meterHead}>
            <span>視聴済み</span>
            <span>{watchedCount.toLocaleString()} / {videoCount.toLocaleString()} （未視聴 {unwatchedCount.toLocaleString()}）</span>
          </div>
          <div className={homeStyles.meterTrack}>
            <div className={homeStyles.meterBar} style={{ width: `${watchedPct}%` }} />
          </div>
          <div className={homeStyles.meterFoot}>{watchedPct}%</div>
        </div>
      )}
      {diskInfo && <DiskBar disk={diskInfo} />}
    </section>
  );
}
