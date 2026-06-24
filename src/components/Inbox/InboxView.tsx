import { useEffect, useState } from 'react';
import { useInboxStore, buildStacks, type InboxStack } from '../../store/useInboxStore';
import { useModalStore } from '../../store/useModalStore';
import { usePlayerStore } from '../../store/usePlayerStore';
import type { Video } from '../../types';
import StackCard from './StackCard';
import QuickSort from './QuickSort';

export default function InboxView() {
  const { videos, stats, isLoading, activeStack, fetchInbox, graduateFromInbox, setActiveStack } =
    useInboxStore();
  const openDetailVideo = useModalStore((s) => s.openDetailVideo);
  const playWithQueue = usePlayerStore((s) => s.playWithQueue);

  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());

  useEffect(() => {
    fetchInbox();
  }, []);

  const stacks = buildStacks(videos);

  const handlePlay = (v: Video) => {
    playWithQueue([v], 0);
  };

  const handleStackGraduate = async (stack: InboxStack) => {
    const ids = videos
      .filter((v) => {
        if (stack.stackType === 'source') return (v.source_type ?? 'unknown') === stack.groupKey;
        if (stack.stackType === 'date') return getDateKey(v.created_at) === stack.groupKey;
        if (stack.stackType === 'missing_metadata') {
          if (stack.groupKey === 'category') return v.category_id == null;
          if (stack.groupKey === 'rating') return !v.rating;
        }
        if (stack.stackType === 'almost_done') return v.category_id != null && (v.rating ?? 0) > 0;
        return false;
      })
      .map((v) => v.id);
    await graduateFromInbox(ids);
  };

  const handleBulkGraduate = async () => {
    await graduateFromInbox(Array.from(selectedIds));
    setSelectedIds(new Set());
  };

  if (activeStack) {
    const stackVideos = videos.filter((v) => {
      const s = activeStack;
      if (s.stackType === 'source') return (v.source_type ?? 'unknown') === s.groupKey;
      if (s.stackType === 'date') return getDateKey(v.created_at) === s.groupKey;
      if (s.stackType === 'missing_metadata') {
        if (s.groupKey === 'category') return v.category_id == null;
        if (s.groupKey === 'rating') return !v.rating;
      }
      if (s.stackType === 'almost_done') return v.category_id != null && (v.rating ?? 0) > 0;
      return false;
    });
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

  return (
    <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
      {/* Inbox header + stats */}
      <div className="px-4 pt-3 pb-2 border-b border-gray-100 dark:border-gray-800 shrink-0">
        <div className="flex items-center gap-3 mb-2">
          <h2 className="text-base font-semibold">Inbox</h2>
          {stats && (
            <span className="text-xs text-gray-500 dark:text-gray-400">
              {stats.inboxCount} 件の未整理ファイル
            </span>
          )}
          <button
            type="button"
            className="ml-auto text-xs px-2 py-1 rounded border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800"
            onClick={fetchInbox}
            disabled={isLoading}
          >
            {isLoading ? '更新中...' : '更新'}
          </button>
        </div>
        {stats && (
          <div className="flex gap-4 text-xs text-gray-500 dark:text-gray-400">
            <span>全体: {stats.total.toLocaleString()}</span>
            <span className="text-amber-600 dark:text-amber-400">Inbox: {stats.inboxCount}</span>
            <span>カテゴリ未設定: {stats.missingCategory}</span>
            <span>評価未設定: {stats.missingRating}</span>
            <span className="text-green-600 dark:text-green-400">もう少し: {stats.almostDone}</span>
          </div>
        )}
      </div>

      {/* Bulk operation bar */}
      {selectedIds.size > 0 && (
        <div className="flex items-center gap-2 px-4 py-2 bg-blue-50 dark:bg-blue-950/50 border-b border-blue-200 dark:border-blue-800 shrink-0">
          <span className="text-xs font-medium text-blue-700 dark:text-blue-300">
            {selectedIds.size} 件選択中
          </span>
          <button
            type="button"
            className="px-2.5 py-1 text-xs bg-green-600 hover:bg-green-700 text-white rounded"
            onClick={handleBulkGraduate}
          >
            整理完了にする
          </button>
          <button
            type="button"
            className="ml-auto text-xs text-blue-500 hover:underline"
            onClick={() => setSelectedIds(new Set())}
          >
            選択解除
          </button>
        </div>
      )}

      {/* Workbench */}
      <div className="flex-1 overflow-y-auto px-4 py-3">
        {isLoading && videos.length === 0 && (
          <p className="text-sm text-gray-500 dark:text-gray-400">読み込み中...</p>
        )}
        {!isLoading && videos.length === 0 && (
          <div className="flex flex-col items-center justify-center h-48 text-gray-400 dark:text-gray-600">
            <p className="text-2xl mb-2">✓</p>
            <p className="text-sm">Inbox は空です</p>
          </div>
        )}
        {stacks.length > 0 && (
          <div className="flex flex-col gap-4">
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
