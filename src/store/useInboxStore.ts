import { invoke } from '@tauri-apps/api/core';
import { create } from 'zustand';
import type { Video, Tag, Category } from '../types';

export interface InboxStats {
  total: number;
  inboxCount: number;
  missingCategory: number;
  missingTags: number;
  missingRating: number;
  almostDone: number;
}

// Inbox videos grouped into a stack (display unit)
export type StackType = 'source' | 'date' | 'missing_metadata' | 'almost_done' | 'directory' | 'tag' | 'category';

export interface InboxStack {
  stackType: StackType;
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

function buildStacks(
  videos: Video[],
  videoTags: Record<number, Tag[]> = {},
  categories: Category[] = [],
): InboxStack[] {
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
  const missingTagsList = videos.filter((v) => (videoTags[v.id] ?? []).length === 0);
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
  if (missingTagsList.length > 0) {
    stacks.push({
      stackType: 'missing_metadata',
      groupKey: 'tags',
      label: 'タグ未設定',
      count: missingTagsList.length,
      videos: missingTagsList.slice(0, 10),
    });
  }

  // Almost Done Stack — 3条件のうち2つが揃っている (残り1つで自動卒業)
  const almostDone = videos.filter((v) => {
    const hasCategory = v.category_id != null;
    const hasRating = (v.rating ?? 0) > 0;
    const hasTags = (videoTags[v.id] ?? []).length > 0;
    const score = [hasCategory, hasRating, hasTags].filter(Boolean).length;
    return score === 2;
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

  // Directory Stack — group by immediate parent directory (only when 2+ distinct dirs)
  const dirGroups = new Map<string, { label: string; videos: Video[] }>();
  for (const v of videos) {
    const parts = v.path.replace(/\\/g, '/').split('/');
    const dirPath = parts.slice(0, -1).join('/');
    const dirName = parts[parts.length - 2] ?? dirPath;
    if (!dirGroups.has(dirPath)) {
      dirGroups.set(dirPath, { label: dirName, videos: [] });
    }
    dirGroups.get(dirPath)!.videos.push(v);
  }
  if (dirGroups.size > 1) {
    for (const [dirPath, g] of dirGroups.entries()) {
      stacks.push({
        stackType: 'directory',
        groupKey: dirPath,
        label: g.label,
        count: g.videos.length,
        videos: g.videos.slice(0, 10),
      });
    }
  }

  // Category Stack — group by category_id
  const catGroups = new Map<number, { label: string; videos: Video[] }>();
  for (const v of videos) {
    if (v.category_id == null) continue;
    const cat = categories.find((c) => c.id === v.category_id);
    const label = cat?.name ?? String(v.category_id);
    if (!catGroups.has(v.category_id)) catGroups.set(v.category_id, { label, videos: [] });
    catGroups.get(v.category_id)!.videos.push(v);
  }
  for (const [catId, { label, videos: vids }] of catGroups.entries()) {
    stacks.push({
      stackType: 'category',
      groupKey: String(catId),
      label,
      count: vids.length,
      videos: vids.slice(0, 10),
    });
  }

  // Tag Stack — group by tag (one stack per distinct tag)
  const tagGroups = new Map<number, { tag: Tag; videos: Video[] }>();
  for (const v of videos) {
    for (const tag of videoTags[v.id] ?? []) {
      if (!tagGroups.has(tag.id)) tagGroups.set(tag.id, { tag, videos: [] });
      tagGroups.get(tag.id)!.videos.push(v);
    }
  }
  for (const [, { tag, videos: vids }] of tagGroups.entries()) {
    stacks.push({
      stackType: 'tag',
      groupKey: String(tag.id),
      label: tag.name,
      count: vids.length,
      videos: vids.slice(0, 10),
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
