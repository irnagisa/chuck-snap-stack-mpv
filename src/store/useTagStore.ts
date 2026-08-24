import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';
import type { Tag, Category, TagCategory } from '../types';

export interface CategoryNode extends Category {
  children: CategoryNode[];
}

export function buildCategoryTree(categories: Category[]): CategoryNode[] {
  const map = new Map<number, CategoryNode>();
  const roots: CategoryNode[] = [];
  for (const cat of categories) {
    map.set(cat.id, { ...cat, children: [] });
  }
  for (const cat of categories) {
    const node = map.get(cat.id)!;
    if (cat.parent_id === null) {
      roots.push(node);
    } else {
      const parent = map.get(cat.parent_id);
      if (parent) {
        parent.children.push(node);
      } else {
        roots.push(node); // 孤立ノード → ルート扱い
      }
    }
  }
  return roots;
}

export function flattenCategoryTree(nodes: CategoryNode[], depth = 0): { category: Category; depth: number }[] {
  const result: { category: Category; depth: number }[] = [];
  for (const node of nodes) {
    result.push({ category: node, depth });
    result.push(...flattenCategoryTree(node.children, depth + 1));
  }
  return result;
}

export function getCategoryDescendantIds(categoryId: number, categories: Category[]): number[] {
  const result: number[] = [categoryId];
  for (const cat of categories) {
    if (cat.parent_id === categoryId) {
      result.push(...getCategoryDescendantIds(cat.id, categories));
    }
  }
  return result;
}

export function getCategoryPath(categoryId: number | null, categories: Category[]): string | null {
  if (categoryId === null) return null;
  const cat = categories.find((c) => c.id === categoryId);
  if (!cat) return null;
  if (cat.parent_id === null) return cat.name;
  const parentPath = getCategoryPath(cat.parent_id, categories);
  return parentPath ? `${parentPath}/${cat.name}` : cat.name;
}

interface TagState {
  tags: Tag[];
  categories: Category[];
  tagCategories: TagCategory[];
  videoTags: Record<number, Tag[]>;
}

interface TagActions {
  init: () => Promise<void>;
  fetchTags: () => Promise<void>;
  fetchCategories: () => Promise<void>;
  fetchTagCategories: () => Promise<void>;
  fetchVideoTagsForIds: (videoIds: number[]) => Promise<void>;
  fetchVideoTags: (videoId: number) => Promise<void>;
  createTag: (name: string, color: string, icon?: string | null) => Promise<Tag>;
  updateTag: (tagId: number, name: string, color: string, tagCategoryId?: number | null, icon?: string | null) => Promise<void>;
  deleteTag: (tagId: number) => Promise<void>;
  setTagCategory: (tagId: number, tagCategoryId: number | null) => Promise<void>;
  createTagCategory: (name: string) => Promise<TagCategory>;
  updateTagCategory: (id: number, name: string) => Promise<void>;
  deleteTagCategory: (id: number) => Promise<void>;
  createCategory: (name: string, color: string, parentId?: number | null, icon?: string | null) => Promise<Category>;
  updateCategory: (categoryId: number, name: string, color: string, parentId?: number | null, icon?: string | null) => Promise<void>;
  deleteCategory: (categoryId: number) => Promise<void>;
  addTagToVideo: (videoId: number, tagId: number) => Promise<void>;
  removeTagFromVideo: (videoId: number, tagId: number) => Promise<void>;
  setVideoCategory: (videoId: number, categoryId: number | null) => Promise<void>;
  addTagToMultiple: (videoIds: number[], tagId: number) => Promise<void>;
  setCategoryMultiple: (videoIds: number[], categoryId: number | null) => Promise<void>;
}

export const useTagStore = create<TagState & TagActions>((set, get) => ({
  tags: [],
  categories: [],
  tagCategories: [],
  videoTags: {},

  init: async () => {
    await Promise.all([
      get().fetchTagCategories(),
      get().fetchTags(),
      get().fetchCategories(),
    ]);
  },

  fetchTags: async () => {
    const tags = await invoke<Tag[]>('db_fetch_tags');
    set({ tags });
  },

  fetchCategories: async () => {
    const categories = await invoke<Category[]>('db_fetch_categories');
    set({ categories });
  },

  fetchTagCategories: async () => {
    const tagCategories = await invoke<TagCategory[]>('db_fetch_tag_categories');
    set({ tagCategories });
  },

  fetchVideoTagsForIds: async (videoIds) => {
    const safeIds = videoIds.filter((id) => Number.isFinite(id));
    if (safeIds.length === 0) return;
    const rows = await invoke<{ videoId: number; id: number; name: string; color: string; icon: string | null; tagCategoryId: number | null; createdAt: string }[]>(
      'db_fetch_video_tags_for_ids',
      { videoIds: safeIds }
    );
    // Initialize all requested IDs with [] so `id in videoTags` is true even for tagless videos.
    // This prevents InboxView's useEffect([videos]) from re-fetching them on every render.
    const fetched: Record<number, Tag[]> = {};
    for (const id of safeIds) fetched[id] = [];
    for (const row of rows) {
      fetched[row.videoId].push({
        id: row.id,
        name: row.name,
        color: row.color,
        icon: row.icon,
        tag_category_id: row.tagCategoryId,
        created_at: row.createdAt,
      });
    }
    // Merge into existing state instead of replacing — preserves tags loaded by fetchVideoTags.
    set((state) => ({ videoTags: { ...state.videoTags, ...fetched } }));
  },

  fetchVideoTags: async (videoId) => {
    const tags = await invoke<Tag[]>('db_fetch_video_tags', { videoId });
    set((state) => ({ videoTags: { ...state.videoTags, [videoId]: tags } }));
  },

  createTag: async (name, color, icon) => {
    const tag = await invoke<Tag>('db_create_tag', { name, color, icon: icon ?? null });
    set((state) => {
      if (state.tags.some((t) => t.id === tag.id)) return state;
      const tags = [...state.tags];
      const idx = tags.findIndex((t) => t.name.localeCompare(name) > 0);
      if (idx === -1) tags.push(tag); else tags.splice(idx, 0, tag);
      return { tags };
    });
    return tag;
  },

  updateTag: async (tagId, name, color, tagCategoryId, icon) => {
    await invoke('db_update_tag', { tagId, name, color, tagCategoryId: tagCategoryId ?? null, icon: icon ?? null });
    await get().fetchTags();
    const currentIds = Object.keys(get().videoTags).map(Number).filter(Number.isFinite);
    if (currentIds.length > 0) {
      await get().fetchVideoTagsForIds(currentIds);
    }
  },

  deleteTag: async (tagId) => {
    await invoke('db_delete_tag', { tagId });
    await get().fetchTags();
    set((state) => {
      const next = { ...state.videoTags };
      for (const vid in next) {
        next[Number(vid)] = next[Number(vid)].filter((t) => t.id !== tagId);
      }
      return { videoTags: next };
    });
  },

  setTagCategory: async (tagId, tagCategoryId) => {
    await invoke('db_set_tag_category', { tagId, tagCategoryId });
    await get().fetchTags();
  },

  createTagCategory: async (name) => {
    const tc = await invoke<TagCategory>('db_create_tag_category', { name });
    set((state) => {
      if (state.tagCategories.some((c) => c.id === tc.id)) return state;
      const tagCategories = [...state.tagCategories];
      const idx = tagCategories.findIndex((c) => c.name.localeCompare(name) > 0);
      if (idx === -1) tagCategories.push(tc); else tagCategories.splice(idx, 0, tc);
      return { tagCategories };
    });
    return tc;
  },

  updateTagCategory: async (id, name) => {
    await invoke('db_update_tag_category', { id, name });
    await get().fetchTagCategories();
  },

  deleteTagCategory: async (id) => {
    await invoke('db_delete_tag_category', { id });
    await get().fetchTagCategories();
    await get().fetchTags();
  },

  createCategory: async (name, color, parentId, icon) => {
    const category = await invoke<Category>('db_create_category', { name, color, parentId: parentId ?? null, icon: icon ?? null });
    set((state) => {
      if (state.categories.some((c) => c.id === category.id)) return state;
      const categories = [...state.categories];
      const idx = categories.findIndex((c) => c.name.localeCompare(name) > 0);
      if (idx === -1) categories.push(category); else categories.splice(idx, 0, category);
      return { categories };
    });
    return category;
  },

  updateCategory: async (categoryId, name, color, parentId, icon) => {
    await invoke('db_update_category', { categoryId, name, color, parentId: parentId ?? null, icon: icon ?? null });
    await get().fetchCategories();
  },

  deleteCategory: async (categoryId) => {
    await invoke('db_delete_category', { categoryId });
    await get().fetchCategories();
  },

  addTagToVideo: async (videoId, tagId) => {
    await invoke('db_add_tag_to_video', { videoId, tagId });
    await get().fetchVideoTags(videoId);
  },

  removeTagFromVideo: async (videoId, tagId) => {
    await invoke('db_remove_tag_from_video', { videoId, tagId });
    set((state) => ({
      videoTags: {
        ...state.videoTags,
        [videoId]: (state.videoTags[videoId] ?? []).filter((t) => t.id !== tagId),
      },
    }));
  },

  setVideoCategory: async (videoId, categoryId) => {
    await invoke('db_set_video_category', { videoId, categoryId });
  },

  addTagToMultiple: async (videoIds, tagId) => {
    if (videoIds.length === 0) return;
    await invoke('db_add_tag_to_multiple', { videoIds, tagId });
    const cachedIds = Object.keys(get().videoTags).map(Number).filter(Number.isFinite);
    // 対象IDをキャッシュ済みIDに合算してリフレッシュ（タグなしビデオが選択対象の場合にも更新されるようにする）
    const allIds = [...new Set([...cachedIds, ...videoIds])];
    if (allIds.length > 0) {
      await get().fetchVideoTagsForIds(allIds);
    }
  },

  setCategoryMultiple: async (videoIds, categoryId) => {
    if (videoIds.length === 0) return;
    await invoke('db_set_category_multiple', { videoIds, categoryId });
  },
}));
