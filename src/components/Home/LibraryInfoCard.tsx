import { useEffect, useMemo } from "react";
import { useHomeStore, type DiskInfo } from "../../store/useHomeStore";
import { useInboxStore, buildStacks } from "../../store/useInboxStore";
import { useTagStore } from "../../store/useTagStore";

function StatTile({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex flex-col items-center justify-center py-3">
      <span className="text-xl font-bold tabular-nums">{value.toLocaleString()}</span>
      <span className="text-xs text-gray-500 dark:text-gray-400">{label}</span>
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
  const barColor = usedPct >= 90 ? "bg-red-500" : usedPct >= 75 ? "bg-yellow-500" : "bg-blue-500";
  return (
    <div className="mt-3 pt-3 border-t border-gray-100 dark:border-gray-800">
      <div className="flex justify-between text-xs text-gray-500 dark:text-gray-400 mb-1">
        <span>ストレージ</span>
        <span>{formatBytes(disk.usedBytes)} / {formatBytes(disk.totalBytes)}</span>
      </div>
      <div className="h-1.5 rounded-full bg-gray-100 dark:bg-gray-800 overflow-hidden">
        <div className={`h-full rounded-full transition-all ${barColor}`} style={{ width: `${usedPct}%` }} />
      </div>
      <div className="text-right text-xs text-gray-400 dark:text-gray-500 mt-0.5">
        空き {formatBytes(disk.availableBytes)}
      </div>
    </div>
  );
}

export function LibraryInfoCard() {
  const libraryStats = useHomeStore((s) => s.libraryStats);
  const diskInfo = useHomeStore((s) => s.diskInfo);
  const inboxVideos = useInboxStore((s) => s.videos);
  const tags = useTagStore((s) => s.tags);
  const categories = useTagStore((s) => s.categories);
  const videoTags = useTagStore((s) => s.videoTags);
  const fetchVideoTagsForIds = useTagStore((s) => s.fetchVideoTagsForIds);

  useEffect(() => {
    const newIds = inboxVideos.map((v) => v.id).filter((id) => !(id in videoTags));
    if (newIds.length > 0) {
      fetchVideoTagsForIds(newIds);
    }
    // videoTags is intentionally excluded: we only re-fetch when the inbox video list changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inboxVideos, fetchVideoTagsForIds]);

  const stackCount = useMemo(
    () => buildStacks(inboxVideos, videoTags, categories).length,
    [inboxVideos, videoTags, categories]
  );

  const videoCount = libraryStats?.videoCount ?? 0;
  const watchedCount = libraryStats?.watchedCount ?? 0;
  const unwatchedCount = Math.max(0, videoCount - watchedCount);
  const watchedPct = videoCount > 0 ? Math.round((watchedCount / videoCount) * 100) : 0;

  return (
    <section className="border border-gray-200 dark:border-gray-800 rounded-lg p-4">
      <h2 className="text-sm font-bold text-gray-500 dark:text-gray-400 mb-3">ライブラリ情報</h2>
      <div className="grid grid-cols-2 sm:grid-cols-4 divide-x divide-gray-100 dark:divide-gray-800">
        <StatTile label="画像" value={libraryStats?.imageCount ?? 0} />
        <StatTile label="動画" value={videoCount} />
        <StatTile label="Stack" value={stackCount} />
        <StatTile label="タグ" value={tags.length} />
      </div>
      {videoCount > 0 && (
        <div className="mt-3 pt-3 border-t border-gray-100 dark:border-gray-800">
          <div className="flex justify-between text-xs text-gray-500 dark:text-gray-400 mb-1">
            <span>視聴済み</span>
            <span>{watchedCount.toLocaleString()} / {videoCount.toLocaleString()} （未視聴 {unwatchedCount.toLocaleString()}）</span>
          </div>
          <div className="h-1.5 rounded-full bg-gray-100 dark:bg-gray-800 overflow-hidden">
            <div
              className="h-full rounded-full bg-indigo-500 transition-all"
              style={{ width: `${watchedPct}%` }}
            />
          </div>
          <div className="text-right text-xs text-gray-400 dark:text-gray-500 mt-0.5">
            {watchedPct}%
          </div>
        </div>
      )}
      {diskInfo && <DiskBar disk={diskInfo} />}
    </section>
  );
}
