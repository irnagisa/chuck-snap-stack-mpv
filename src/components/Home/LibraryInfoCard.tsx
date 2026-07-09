import { useEffect, useMemo } from "react";
import { useHomeStore } from "../../store/useHomeStore";
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

export function LibraryInfoCard() {
  const libraryStats = useHomeStore((s) => s.libraryStats);
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

  return (
    <section className="border border-gray-200 dark:border-gray-800 rounded-lg p-4">
      <h2 className="text-sm font-bold text-gray-500 dark:text-gray-400 mb-3">ライブラリ情報</h2>
      <div className="grid grid-cols-2 sm:grid-cols-4 divide-x divide-gray-100 dark:divide-gray-800">
        <StatTile label="画像" value={libraryStats?.imageCount ?? 0} />
        <StatTile label="動画" value={libraryStats?.videoCount ?? 0} />
        <StatTile label="Stack" value={stackCount} />
        <StatTile label="タグ" value={tags.length} />
      </div>
    </section>
  );
}
