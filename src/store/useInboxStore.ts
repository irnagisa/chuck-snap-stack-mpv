import { invoke } from '@tauri-apps/api/core';
import { create } from 'zustand';
import type { Video } from '../types';

export interface InboxStats {
  total: number;
  inboxCount: number;
  missingCategory: number;
  missingTags: number;
  missingRating: number;
  almostDone: number;
}

// Inbox videos grouped into a stack (display unit)
export interface InboxStack {
  stackType: 'source' | 'date' | 'missing_metadata' | 'almost_done';
  groupKey: string;
  label: string;
  count: number;
  videos: Video[];
}

interface InboxState {
  videos: Video[];
  stats: InboxStats | null;
  isLoading: boolean;
  // Quick Sort state
  activeStack: InboxStack | null;
  quickSortIndex: number;
}

interface InboxActions {
  fetchInbox: () => Promise<void>;
  graduateFromInbox: (videoIds: number[]) => Promise<void>;
  setActiveStack: (stack: InboxStack | null) => void;
  setQuickSortIndex: (index: number) => void;
}

function buildStacks(videos: Video[]): InboxStack[] {
  const stacks: InboxStack[] = [];

  // Source Stack — group by source_type
  const sourceGroups = new Map<string, Video[]>();
  for (const v of videos) {
    const key = v.source_type ?? 'unknown';
    if (!sourceGroups.has(key)) sourceGroups.set(key, []);
    sourceGroups.get(key)!.push(v);
  }
  const sourceLabels: Record<string, string> = {
    download: 'ダウンロード',
    import: 'インポート',
    dragdrop: 'ドラッグ&ドロップ',
    watcher: '自動検出',
    unknown: '不明',
  };
  for (const [key, vids] of sourceGroups.entries()) {
    stacks.push({
      stackType: 'source',
      groupKey: key,
      label: sourceLabels[key] ?? key,
      count: vids.length,
      videos: vids.slice(0, 10),
    });
  }

  // Date Stack — group by date
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const lastWeekStart = new Date(today);
  lastWeekStart.setDate(lastWeekStart.getDate() - 7);

  const dateGroups = new Map<string, { label: string; videos: Video[] }>();
  const dateOrder = ['today', 'yesterday', 'last_week', 'older'];
  dateGroups.set('today', { label: '今日', videos: [] });
  dateGroups.set('yesterday', { label: '昨日', videos: [] });
  dateGroups.set('last_week', { label: '先週', videos: [] });
  dateGroups.set('older', { label: 'それ以前', videos: [] });

  for (const v of videos) {
    const d = new Date(v.created_at);
    d.setHours(0, 0, 0, 0);
    if (d >= today) {
      dateGroups.get('today')!.videos.push(v);
    } else if (d >= yesterday) {
      dateGroups.get('yesterday')!.videos.push(v);
    } else if (d >= lastWeekStart) {
      dateGroups.get('last_week')!.videos.push(v);
    } else {
      dateGroups.get('older')!.videos.push(v);
    }
  }
  for (const key of dateOrder) {
    const g = dateGroups.get(key)!;
    if (g.videos.length > 0) {
      stacks.push({
        stackType: 'date',
        groupKey: key,
        label: g.label,
        count: g.videos.length,
        videos: g.videos.slice(0, 10),
      });
    }
  }

  // Missing Metadata Stack
  const missingCat = videos.filter((v) => v.category_id == null);
  const missingRating = videos.filter((v) => !v.rating);
  if (missingCat.length > 0) {
    stacks.push({
      stackType: 'missing_metadata',
      groupKey: 'category',
      label: 'カテゴリ未設定',
      count: missingCat.length,
      videos: missingCat.slice(0, 10),
    });
  }
  if (missingRating.length > 0) {
    stacks.push({
      stackType: 'missing_metadata',
      groupKey: 'rating',
      label: '評価未設定',
      count: missingRating.length,
      videos: missingRating.slice(0, 10),
    });
  }

  // Almost Done Stack (category + rating both set, just missing tags — from stats)
  const almostDone = videos.filter((v) => {
    const hasCategory = v.category_id != null;
    const hasRating = (v.rating ?? 0) > 0;
    return hasCategory && hasRating;
  });
  if (almostDone.length > 0) {
    stacks.push({
      stackType: 'almost_done',
      groupKey: 'almost_done',
      label: 'もう少し',
      count: almostDone.length,
      videos: almostDone.slice(0, 10),
    });
  }

  return stacks;
}

export const useInboxStore = create<InboxState & InboxActions>((set, get) => ({
  videos: [],
  stats: null,
  isLoading: false,
  activeStack: null,
  quickSortIndex: 0,

  fetchInbox: async () => {
    set({ isLoading: true });
    try {
      const [videos, stats] = await Promise.all([
        invoke<Video[]>('db_get_inbox_videos'),
        invoke<InboxStats>('db_get_inbox_stats'),
      ]);
      set({ videos, stats, isLoading: false });
    } catch (e) {
      console.error('[useInboxStore] fetchInbox error:', e);
      set({ isLoading: false });
    }
  },

  graduateFromInbox: async (videoIds: number[]) => {
    if (videoIds.length === 0) return;
    await invoke('db_graduate_from_inbox', { videoIds });
    await get().fetchInbox();
  },

  setActiveStack: (stack) => set({ activeStack: stack, quickSortIndex: 0 }),

  setQuickSortIndex: (index) => set({ quickSortIndex: index }),
}));

export { buildStacks };
