import { useEffect, useState } from 'react';
import { useInboxStore, buildStacks, type InboxStack, type StackType } from '../../store/useInboxStore';
import { useModalStore } from '../../store/useModalStore';
import { usePlayerStore } from '../../store/usePlayerStore';
import { useTagStore } from '../../store/useTagStore';
import type { Video } from '../../types';
import type { Tag } from '../../types';
import StackCard from './StackCard';
import QuickSort from './QuickSort';

export default function InboxView() {
  const { videos, stats, isLoading, activeStack, fetchInbox, graduateFromInbox, setActiveStack } =
    useInboxStore();
  const openDetailVideo = useModalStore((s) => s.openDetailVideo);
  const playWithQueue = usePlayerStore((s) => s.playWithQueue);
  const { videoTags, categories, fetchVideoTagsForIds, fetchCategories } = useTagStore();

  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  // フィルター: 非表示にするスタック種別 (空 = 全表示)
  const [hiddenTypes, setHiddenTypes] = useState<Set<StackType>>(new Set());

  useEffect(() => {
    fetchInbox();
    fetchCategories();
  }, []);

  useEffect(() => {
    if (videos.length > 0) {
      fetchVideoTagsForIds(videos.map((v) => v.id));
    }
  }, [videos]);

  const stacks = buildStacks(videos, videoTags, categories).filter(
    (s) => !hiddenTypes.has(s.stackType),
  );

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

  if (activeStack) {
    const stackVideos = videos.filter((v) => matchesStack(v, activeStack, videoTags));
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

  const filterDefs: { type: StackType; label: string }[] = [
    { type: 'source', label: '入手元' },
    { type: 'date', label: '日付' },
    { type: 'missing_metadata', label: '未設定項目' },
    { type: 'almost_done', label: 'ほぼ完了' },
    { type: 'directory', label: 'フォルダ' },
    { type: 'category', label: 'カテゴリ' },
    { type: 'tag', label: 'タグ' },
  ];

  return (
    <div className="flex flex-col flex-1 min-h-0 min-w-0 overflow-hidden">
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
          {filterDefs.map(({ type, label }) => {
            const active = !hiddenTypes.has(type);
            return (
              <button
                key={type}
                type="button"
                onClick={() => toggleType(type)}
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
        {!isLoading && videos.length > 0 && stacks.length === 0 && (
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
