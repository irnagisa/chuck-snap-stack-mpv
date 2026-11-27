import { useEffect, useMemo, useState } from 'react';
import { useShallow } from 'zustand/shallow';
import { useInboxStore, markInboxViewShown, buildStacks, getTimeBucket, type InboxStack, type StackType, type TimeBucket } from '../../store/useInboxStore';
import { useModalStore } from '../../store/useModalStore';
import { usePlayerStore } from '../../store/usePlayerStore';
import { useTagStore } from '../../store/useTagStore';
import type { Video } from '../../types';
import type { Tag } from '../../types';
import StackCard from './StackCard';
import QuickSort from './QuickSort';
import { Button, cx } from "../ui";
import styles from "./Inbox.module.css";

export default function InboxView() {
  const { videos, stats, isLoading, activeStack, fetchInbox, graduateFromInbox, setActiveStack, batchVideos, startBatch, clearBatch } =
    useInboxStore(useShallow((s) => ({
      videos: s.videos,
      stats: s.stats,
      isLoading: s.isLoading,
      activeStack: s.activeStack,
      fetchInbox: s.fetchInbox,
      graduateFromInbox: s.graduateFromInbox,
      setActiveStack: s.setActiveStack,
      batchVideos: s.batchVideos,
      startBatch: s.startBatch,
      clearBatch: s.clearBatch,
    })));
  const openDetailVideo = useModalStore((s) => s.openDetailVideo);
  const playWithQueue = usePlayerStore((s) => s.playWithQueue);
  const { videoTags, categories, fetchVideoTagsForIds, fetchCategories } = useTagStore(useShallow((s) => ({
    videoTags: s.videoTags,
    categories: s.categories,
    fetchVideoTagsForIds: s.fetchVideoTagsForIds,
    fetchCategories: s.fetchCategories,
  })));

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

  // 開いている間は、裏での追加や整理の後に一覧ごと読み直してもらう
  useEffect(() => markInboxViewShown(), []);

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

  // 一覧を 1 回だけなめて期間ごとに分ける (再描画のたびに全件を 3 回 filter しない)
  const bucketVideos = useMemo(() => {
    const buckets: Record<TimeBucket, Video[]> = { active: [], review: [], archive: [] };
    for (const v of videos) buckets[getTimeBucket(v.created_at)].push(v);
    return buckets;
  }, [videos]);

  // QuickSort 中は一覧を出さないので組み立てない
  const bucketStacks = useMemo((): Record<TimeBucket, InboxStack[]> => {
    if (activeStack) return { active: [], review: [], archive: [] };
    const build = (vs: Video[]) =>
      buildStacks(vs, videoTags, categories).filter((s) => !hiddenTypes.has(s.stackType));
    return {
      active: build(bucketVideos.active),
      review: build(bucketVideos.review),
      archive: build(bucketVideos.archive),
    };
  }, [activeStack, bucketVideos, videoTags, categories, hiddenTypes]);

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
    <div className={styles.view}>
      {/* Inbox header + stats */}
      <div className={styles.header}>
        <div className={styles.titleRow}>
          <h2 className={styles.title}>Inbox</h2>
          {isLoading && (
            <div className={cx(styles.spinner, styles.spinnerSmall)} aria-hidden />
          )}
          {stats && (
            <span className={styles.countText}>
              {stats.inboxCount} 件の未整理ファイル
            </span>
          )}
          {stats && stats.inboxCount > 0 && (
            <div className={styles.batch}>
              <span className={styles.batchLabel}>バッチ:</span>
              {([10, 20, 30] as const).map((n) => (
                <Button
                  variant="secondary"
                  size="xs"
                  key={n}
                  onClick={() => startBatch(n)}
                  disabled={isLoading}
                >
                  {n}件
                </Button>
              ))}
            </div>
          )}
          <Button
            variant="secondary"
            size="sm"
            onClick={fetchInbox}
            disabled={isLoading}
          >
            {isLoading ? '更新中...' : '更新'}
          </Button>
        </div>
        {stats && (
          <div className={styles.stats}>
            <span>全体: {stats.total.toLocaleString()}</span>
            <span className={styles.statInbox}>Inbox: {stats.inboxCount}</span>
            <span>カテゴリ未設定: {stats.missingCategory}</span>
            <span>評価未設定: {stats.missingRating}</span>
            <span className={styles.statAlmost}>もう少し: {stats.almostDone}</span>
          </div>
        )}
        {/* Stack type filter chips */}
        <div className={styles.typeFilters}>
          {filterDefs.map(({ type, label, description }) => {
            const active = !hiddenTypes.has(type);
            return (
              <Button
                key={type}
                variant="ghost"
                size="xs"
                onClick={() => toggleType(type)}
                title={description}
                aria-pressed={active}
              >
                {label}
              </Button>
            );
          })}
        </div>
      </div>

      {/* Bulk operation bar */}
      {selectedIds.size > 0 && (
        <div className={styles.selection}>
          <span className={styles.selectionCount}>
            {selectedIds.size} 件選択中
          </span>
          <Button
            variant="soft"
            size="xs"
            className={styles.end}
            onClick={() => setSelectedIds(new Set())}
          >
            選択解除
          </Button>
        </div>
      )}

      {/* Loading bar */}
      <div className={styles.loadingTrack}>
        {isLoading && (
          <div className={styles.loadingBar} />
        )}
      </div>

      {/* Workbench */}
      <div className={styles.workbench}>
        {isLoading && videos.length === 0 && (
          <div className={styles.loading}>
            <div className={styles.spinner} aria-hidden />
            <span>読み込み中...</span>
          </div>
        )}
        {!isLoading && videos.length === 0 && (
          <div className={styles.empty}>
            <p className={styles.emptyIcon} aria-hidden>✓</p>
            <p className={styles.emptyTitle}>Inbox は空です</p>
            <p className={styles.emptyHelp}>
              動画・音楽・画像ファイルをスキャンしてライブラリに追加すると、未整理のファイルがここに表示されます。
            </p>
          </div>
        )}
        {(batchVideos !== null || hasAnyStacks) && (
          <div className={styles.buckets}>
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
                <div key={key} className={styles.bucket}>
                  <button
                    type="button"
                    onClick={() => toggleBucket(key)}
                    className={styles.bucketToggle}
                    aria-expanded={!isCollapsed}
                  >
                    <span className={styles.rule} aria-hidden />
                    <span className={styles.bucketLabel}>
                      {label}
                    </span>
                    <span className={styles.bucketMeta}>
                      {description} · {vCount}件
                    </span>
                    <span className={styles.rule} aria-hidden />
                    <span className={styles.bucketChevron} aria-hidden>
                      {isCollapsed ? '▶' : '▼'}
                    </span>
                  </button>
                  {!isCollapsed && (
                    <div className={styles.stacks}>
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
          <p className={styles.noStacks}>
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
