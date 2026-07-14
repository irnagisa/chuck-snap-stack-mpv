import { useEffect, useMemo, useState } from 'react';
import { useInboxStore, buildStacks, getTimeBucket, type InboxStack, type StackType, type TimeBucket } from '../../store/useInboxStore';
import { useModalStore } from '../../store/useModalStore';
import { usePlayerStore } from '../../store/usePlayerStore';
import { useTagStore } from '../../store/useTagStore';
import type { Video } from '../../types';
import type { Tag } from '../../types';
import StackCard from './StackCard';
import QuickSort from './QuickSort';

export default function InboxView() {
  const { videos, stats, isLoading, activeStack, fetchInbox, graduateFromInbox, setActiveStack, batchVideos, startBatch, clearBatch } =
    useInboxStore();
  const openDetailVideo = useModalStore((s) => s.openDetailVideo);
  const playWithQueue = usePlayerStore((s) => s.playWithQueue);
  const { videoTags, categories, fetchVideoTagsForIds, fetchCategories } = useTagStore();

  // Stabilize the video list passed to QuickSort so that tag-loading mid-session
  // does NOT change `current` and cause VideoOrganizerPanel to cycle through videos,
  // triggering "Maximum update depth exceeded".
  // videoTags is intentionally excluded from deps: the snapshot is refreshed only
  // when the actual video list or active stack changes, not when tags are loaded.
  const stackVideos = useMemo(() => {
    if (!activeStack) return [];
    if (activeStack.stackType === 'batch') return batchVideos ?? [];
    return videos.filter((v) => matchesStack(v, activeStack, videoTags));
  // videoTags intentionally omitted: prevents current video from changing as tags load mid-session
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videos, activeStack, batchVideos]);

  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  // フィルター: 非表示にするスタック種別 (空 = 全表示)
  const [hiddenTypes, setHiddenTypes] = useState<Set<StackType>>(new Set());
  const [collapsedBuckets, setCollapsedBuckets] = useState<Set<TimeBucket>>(new Set(['review', 'archive']));

  useEffect(() => {
    fetchInbox();
    fetchCategories();
  }, []);

  useEffect(() => {
    const newIds = videos.map((v) => v.id).filter((id) => !(id in videoTags));
    if (newIds.length > 0) {
      fetchVideoTagsForIds(newIds);
    }
    // videoTags is intentionally excluded: we only re-fetch when the videos list changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videos]);

  const bucketDefs: { key: TimeBucket; label: string; description: string }[] = [
    { key: 'active', label: 'アクティブ', description: '7日以内' },
    { key: 'review', label: '整理候補', description: '7〜30日' },
    { key: 'archive', label: 'アーカイブ', description: '30日以降' },
  ];

  const bucketVideos: Record<TimeBucket, Video[]> = {
    active: videos.filter((v) => getTimeBucket(v.created_at) === 'active'),
    review: videos.filter((v) => getTimeBucket(v.created_at) === 'review'),
    archive: videos.filter((v) => getTimeBucket(v.created_at) === 'archive'),
  };

  const bucketStacks: Record<TimeBucket, InboxStack[]> = {
    active: buildStacks(bucketVideos.active, videoTags, categories).filter((s) => !hiddenTypes.has(s.stackType)),
    review: buildStacks(bucketVideos.review, videoTags, categories).filter((s) => !hiddenTypes.has(s.stackType)),
    archive: buildStacks(bucketVideos.archive, videoTags, categories).filter((s) => !hiddenTypes.has(s.stackType)),
  };

  const hasAnyStacks = Object.values(bucketStacks).some((ss) => ss.length > 0);

  const handlePlay = (v: Video) => {
    playWithQueue([v], 0);
  };

  const handleStackGraduate = async (stack: InboxStack) => {
    const ids = videos
      .filter((v) => matchesStack(v, stack, videoTags))
      .map((v) => v.id);
    await graduateFromInbox(ids);
  };

  const toggleType = (type: StackType) => {
    setHiddenTypes((prev) => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  };

  const toggleBucket = (bucket: TimeBucket) => {
    setCollapsedBuckets((prev) => {
      const next = new Set(prev);
      if (next.has(bucket)) next.delete(bucket);
      else next.add(bucket);
      return next;
    });
  };

  if (activeStack) {
    return (
      <QuickSort
        stack={activeStack}
        videos={stackVideos}
        onBack={() => setActiveStack(null)}
        onPlay={handlePlay}
        onShowDetail={openDetailVideo}
        onGraduate={graduateFromInbox}
      />
    );
  }

  const filterDefs: { type: StackType; label: string; description: string }[] = [
    { type: 'source', label: '入手元', description: 'ダウンロード・ローカルなど入手元でグループ化' },
    { type: 'date', label: '日付', description: '追加日が同じファイルをグループ化' },
    { type: 'missing_metadata', label: '未設定項目', description: 'カテゴリ・評価などが未設定のファイル' },
    { type: 'almost_done', label: 'ほぼ完了', description: 'カテゴリも評価も設定済み（確認待ち）' },
    { type: 'directory', label: 'フォルダ', description: '同じフォルダ内のファイルをグループ化' },
    { type: 'category', label: 'カテゴリ', description: '同じカテゴリのファイルをグループ化' },
    { type: 'tag', label: 'タグ', description: '同じタグが付いたファイルをグループ化' },
  ];

  return (
    <div className="flex flex-col flex-1 min-h-0 min-w-0 overflow-hidden">
      {/* Inbox header + stats */}
      <div className="px-4 pt-3 pb-2 border-b border-gray-100 dark:border-gray-800 shrink-0">
        <div className="flex items-center gap-3 mb-2">
          <h2 className="text-base font-semibold">Inbox</h2>
          {isLoading && (
            <div className="w-3 h-3 border-[1.5px] border-gray-300 dark:border-gray-600 border-t-blue-500 rounded-full animate-spin" />
          )}
          {stats && (
            <span className="text-xs text-gray-500 dark:text-gray-400">
              {stats.inboxCount} 件の未整理ファイル
            </span>
          )}
          {stats && stats.inboxCount > 0 && (
            <div className="ml-auto flex items-center gap-1">
              <span className="text-[11px] text-gray-400 dark:text-gray-500">バッチ:</span>
              {([10, 20, 30] as const).map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => startBatch(n)}
                  disabled={isLoading}
                  className="text-[11px] px-2 py-0.5 rounded border border-purple-300 dark:border-purple-700 text-purple-600 dark:text-purple-400 hover:bg-purple-50 dark:hover:bg-purple-950/50 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                >
                  {n}件
                </button>
              ))}
            </div>
          )}
          <button
            type="button"
            className="text-xs px-2 py-1 rounded border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800"
            onClick={fetchInbox}
            disabled={isLoading}
          >
            {isLoading ? '更新中...' : '更新'}
          </button>
        </div>
        {stats && (
          <div className="flex gap-4 text-xs text-gray-500 dark:text-gray-400 mb-2">
            <span>全体: {stats.total.toLocaleString()}</span>
            <span className="text-amber-600 dark:text-amber-400">Inbox: {stats.inboxCount}</span>
            <span>カテゴリ未設定: {stats.missingCategory}</span>
            <span>評価未設定: {stats.missingRating}</span>
            <span className="text-green-600 dark:text-green-400">もう少し: {stats.almostDone}</span>
          </div>
        )}
        {/* Stack type filter chips */}
        <div className="flex flex-wrap gap-1">
          {filterDefs.map(({ type, label, description }) => {
            const active = !hiddenTypes.has(type);
            return (
              <button
                key={type}
                type="button"
                onClick={() => toggleType(type)}
                title={description}
                aria-pressed={active}
                className={`text-[11px] px-2 py-0.5 rounded-full border transition-colors ${
                  active
                    ? 'bg-blue-100 dark:bg-blue-900/50 border-blue-300 dark:border-blue-700 text-blue-700 dark:text-blue-300'
                    : 'bg-transparent border-gray-300 dark:border-gray-600 text-gray-400 dark:text-gray-500'
                }`}
              >
                {label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Bulk operation bar */}
      {selectedIds.size > 0 && (
        <div className="flex items-center gap-2 px-4 py-2 bg-blue-50 dark:bg-blue-950/50 border-b border-blue-200 dark:border-blue-800 shrink-0">
          <span className="text-xs font-medium text-blue-700 dark:text-blue-300">
            {selectedIds.size} 件選択中
          </span>
          <button
            type="button"
            className="ml-auto text-xs text-blue-500 hover:underline"
            onClick={() => setSelectedIds(new Set())}
          >
            選択解除
          </button>
        </div>
      )}

      {/* Loading bar */}
      <div className="h-[2px] shrink-0 overflow-hidden bg-transparent">
        {isLoading && (
          <div className="h-full w-1/4 bg-blue-500 inbox-loading-bar" />
        )}
      </div>

      {/* Workbench */}
      <div className="flex-1 overflow-y-auto px-4 py-3">
        {isLoading && videos.length === 0 && (
          <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400 mt-4">
            <div className="w-4 h-4 border-2 border-gray-300 dark:border-gray-600 border-t-blue-500 rounded-full animate-spin shrink-0" />
            <span>読み込み中...</span>
          </div>
        )}
        {!isLoading && videos.length === 0 && (
          <div className="flex flex-col items-center justify-center h-48 text-center">
            <p className="text-3xl mb-3">✓</p>
            <p className="text-sm font-medium text-gray-600 dark:text-gray-400 mb-1">Inbox は空です</p>
            <p className="text-xs text-gray-400 dark:text-gray-600 max-w-xs">
              動画・音楽・画像ファイルをスキャンしてライブラリに追加すると、未整理のファイルがここに表示されます。
            </p>
          </div>
        )}
        {(batchVideos !== null || hasAnyStacks) && (
          <div className="flex flex-col gap-6">
            {/* Batch card */}
            {batchVideos !== null && (() => {
              const batchStack: InboxStack = {
                stackType: 'batch',
                groupKey: 'batch',
                label: 'ランダムバッチ',
                count: batchVideos.length,
                videos: batchVideos,
              };
              return (
                <StackCard
                  key="batch"
                  stack={batchStack}
                  onOpen={() => setActiveStack(batchStack)}
                  onGraduate={async () => {
                    await graduateFromInbox(batchVideos.map((v) => v.id));
                    clearBatch();
                  }}
                  onPlay={handlePlay}
                  onShowDetail={openDetailVideo}
                  selectedIds={selectedIds}
                  onSelectionChange={setSelectedIds}
                />
              );
            })()}

            {/* Time bucket sections */}
            {bucketDefs.map(({ key, label, description }) => {
              const stacks = bucketStacks[key];
              if (stacks.length === 0) return null;
              const isCollapsed = collapsedBuckets.has(key);
              const vCount = bucketVideos[key].length;
              return (
                <div key={key} className="flex flex-col gap-3">
                  <button
                    type="button"
                    onClick={() => toggleBucket(key)}
                    className="flex items-center gap-2 w-full text-left"
                  >
                    <span className="h-px flex-1 bg-gray-200 dark:bg-gray-700" />
                    <span className="text-xs font-semibold text-gray-600 dark:text-gray-300 shrink-0">
                      {label}
                    </span>
                    <span className="text-[10px] text-gray-400 dark:text-gray-500 shrink-0">
                      {description} · {vCount}件
                    </span>
                    <span className="h-px flex-1 bg-gray-200 dark:bg-gray-700" />
                    <span className="text-[10px] text-gray-400 dark:text-gray-500 shrink-0 w-3 text-center">
                      {isCollapsed ? '▶' : '▼'}
                    </span>
                  </button>
                  {!isCollapsed && (
                    <div className="flex flex-col gap-3">
                      {stacks.map((stack) => (
                        <StackCard
                          key={`${stack.stackType}-${stack.groupKey}`}
                          stack={stack}
                          onOpen={() => setActiveStack(stack)}
                          onGraduate={() => handleStackGraduate(stack)}
                          onPlay={handlePlay}
                          onShowDetail={openDetailVideo}
                          selectedIds={selectedIds}
                          onSelectionChange={setSelectedIds}
                        />
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
        {!isLoading && videos.length > 0 && !hasAnyStacks && (
          <p className="text-sm text-gray-400 dark:text-gray-500 mt-4">
            表示するスタックがありません（フィルターをご確認ください）
          </p>
        )}
      </div>
    </div>
  );
}

function getDateKey(createdAt: string): string {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const lastWeekStart = new Date(today);
  lastWeekStart.setDate(lastWeekStart.getDate() - 7);

  const d = new Date(createdAt);
  d.setHours(0, 0, 0, 0);
  if (d >= today) return 'today';
  if (d >= yesterday) return 'yesterday';
  if (d >= lastWeekStart) return 'last_week';
  return 'older';
}

function getDirPath(videoPath: string): string {
  return videoPath.replace(/\\/g, '/').split('/').slice(0, -1).join('/');
}

function matchesStack(
  v: Video,
  stack: InboxStack,
  videoTags: Record<number, Tag[]>,
): boolean {
  if (stack.stackType === 'source') return (v.source_type ?? 'unknown') === stack.groupKey;
  if (stack.stackType === 'date') return getDateKey(v.created_at) === stack.groupKey;
  if (stack.stackType === 'missing_metadata') {
    if (stack.groupKey === 'category') return v.category_id == null;
    if (stack.groupKey === 'rating') return !v.rating;
    if (stack.groupKey === 'tags') return (videoTags[v.id] ?? []).length === 0;
  }
  if (stack.stackType === 'almost_done') return v.category_id != null && (v.rating ?? 0) > 0;
  if (stack.stackType === 'directory') return getDirPath(v.path) === stack.groupKey;
  if (stack.stackType === 'category') return String(v.category_id) === stack.groupKey;
  if (stack.stackType === 'tag') return (videoTags[v.id] ?? []).some((t) => String(t.id) === stack.groupKey);
  return false;
}
