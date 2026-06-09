import { create } from 'zustand';
import type Database from '@tauri-apps/plugin-sql';
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
  init: (db: Database) => Promise<void>;
  fetchTags: (db: Database) => Promise<void>;
  fetchCategories: (db: Database) => Promise<void>;
  fetchTagCategories: (db: Database) => Promise<void>;
  fetchVideoTagsForIds: (db: Database, videoIds: number[]) => Promise<void>;
  fetchVideoTags: (db: Database, videoId: number) => Promise<void>;
  createTag: (db: Database, name: string, color: string) => Promise<Tag>;
  updateTag: (db: Database, tagId: number, name: string, color: string, tagCategoryId?: number | null) => Promise<void>;
  deleteTag: (db: Database, tagId: number) => Promise<void>;
  setTagCategory: (db: Database, tagId: number, tagCategoryId: number | null) => Promise<void>;
  createTagCategory: (db: Database, name: string) => Promise<TagCategory>;
  updateTagCategory: (db: Database, id: number, name: string) => Promise<void>;
  deleteTagCategory: (db: Database, id: number) => Promise<void>;
  createCategory: (db: Database, name: string, color: string, parentId?: number | null) => Promise<Category>;
  updateCategory: (db: Database, categoryId: number, name: string, color: string, parentId?: number | null) => Promise<void>;
  deleteCategory: (db: Database, categoryId: number) => Promise<void>;
  addTagToVideo: (db: Database, videoId: number, tagId: number) => Promise<void>;
  removeTagFromVideo: (db: Database, videoId: number, tagId: number) => Promise<void>;
  setVideoCategory: (db: Database, videoId: number, categoryId: number | null) => Promise<void>;
  addTagToMultiple: (db: Database, videoIds: number[], tagId: number) => Promise<void>;
  setCategoryMultiple: (db: Database, videoIds: number[], categoryId: number | null) => Promise<void>;
}

export const useTagStore = create<TagState & TagActions>((set, get) => ({
  tags: [],
  categories: [],
  tagCategories: [],
  videoTags: {},

  init: async (db) => {
    await get().fetchTagCategories(db);
    await get().fetchTags(db);
    await get().fetchCategories(db);
    // videoTags are populated by fetchVideos → fetchVideoTagsForIds; no full scan needed here
  },

  fetchTags: async (db) => {
    const tags = await db.select<Tag[]>('SELECT * FROM tags ORDER BY name');
    set({ tags });
  },

  fetchCategories: async (db) => {
    const categories = await db.select<Category[]>('SELECT * FROM categories ORDER BY name');
    set({ categories });
  },

  fetchTagCategories: async (db) => {
    const tagCategories = await db.select<TagCategory[]>('SELECT * FROM tag_categories ORDER BY name');
    set({ tagCategories });
  },

  fetchVideoTagsForIds: async (db, videoIds) => {
    if (videoIds.length === 0) {
      set({ videoTags: {} });
      return;
    }
    const ph = videoIds.map(() => '?').join(', ');
    const rows = await db.select<{ video_id: number; id: number; name: string; color: string; tag_category_id: number | null; created_at: string }[]>(
      `SELECT vt.video_id, t.id, t.name, t.color, t.tag_category_id, t.created_at
       FROM video_tags vt JOIN tags t ON vt.tag_id = t.id
       WHERE vt.video_id IN (${ph})`,
      videoIds
    );
    const videoTags: Record<number, Tag[]> = {};
    for (const row of rows) {
      if (!videoTags[row.video_id]) videoTags[row.video_id] = [];
      videoTags[row.video_id].push({
        id: row.id,
        name: row.name,
        color: row.color,
        tag_category_id: row.tag_category_id,
        created_at: row.created_at,
      });
    }
    set({ videoTags });
  },

  fetchVideoTags: async (db, videoId) => {
    const tags = await db.select<Tag[]>(
      `SELECT t.* FROM tags t
       JOIN video_tags vt ON t.id = vt.tag_id
       WHERE vt.video_id = ?
       ORDER BY t.name`,
      [videoId]
    );
    set((state) => ({ videoTags: { ...state.videoTags, [videoId]: tags } }));
  },

  createTag: async (db, name, color) => {
    const result = await db.execute('INSERT OR IGNORE INTO tags (name, color) VALUES (?, ?)', [name, color]);
    if (result.rowsAffected > 0 && result.lastInsertId != null) {
      // 新規挿入: lastInsertId で SELECT を省略
      const tag: Tag = { id: result.lastInsertId, name, color, tag_category_id: null, created_at: new Date().toISOString() };
      set((state) => {
        if (state.tags.some((t) => t.id === tag.id)) return state;
        // ソート済み位置に挿入 (append + sort より効率的)
        const tags = [...state.tags];
        const idx = tags.findIndex((t) => t.name.localeCompare(name) > 0);
        if (idx === -1) tags.push(tag); else tags.splice(idx, 0, tag);
        return { tags };
      });
      return tag;
    } else {
      // 既存 (IGNORE): 1回 SELECT で取得
      const rows = await db.select<Tag[]>('SELECT * FROM tags WHERE name = ?', [name]);
      return rows[0];
    }
  },

  updateTag: async (db, tagId, name, color, tagCategoryId) => {
    if (tagCategoryId !== undefined) {
      await db.execute('UPDATE tags SET name = ?, color = ?, tag_category_id = ? WHERE id = ?', [name, color, tagCategoryId, tagId]);
    } else {
      await db.execute('UPDATE tags SET name = ?, color = ? WHERE id = ?', [name, color, tagId]);
    }
    await get().fetchTags(db);
    // Refresh tags for current page videos
    const currentIds = Object.keys(get().videoTags).map(Number);
    if (currentIds.length > 0) {
      await get().fetchVideoTagsForIds(db, currentIds);
    }
  },

  deleteTag: async (db, tagId) => {
    await db.execute('DELETE FROM tags WHERE id = ?', [tagId]);
    await get().fetchTags(db);
    set((state) => {
      const next = { ...state.videoTags };
      for (const vid in next) {
        next[Number(vid)] = next[Number(vid)].filter((t) => t.id !== tagId);
      }
      return { videoTags: next };
    });
  },

  setTagCategory: async (db, tagId, tagCategoryId) => {
    await db.execute('UPDATE tags SET tag_category_id = ? WHERE id = ?', [tagCategoryId, tagId]);
    await get().fetchTags(db);
  },

  createTagCategory: async (db, name) => {
    const result = await db.execute('INSERT OR IGNORE INTO tag_categories (name) VALUES (?)', [name]);
    if (result.rowsAffected > 0 && result.lastInsertId != null) {
      const tc: TagCategory = { id: result.lastInsertId, name, created_at: new Date().toISOString() };
      set((state) => {
        if (state.tagCategories.some((c) => c.id === tc.id)) return state;
        const tagCategories = [...state.tagCategories];
        const idx = tagCategories.findIndex((c) => c.name.localeCompare(name) > 0);
        if (idx === -1) tagCategories.push(tc); else tagCategories.splice(idx, 0, tc);
        return { tagCategories };
      });
      return tc;
    } else {
      const rows = await db.select<TagCategory[]>('SELECT * FROM tag_categories WHERE name = ?', [name]);
      return rows[0];
    }
  },

  updateTagCategory: async (db, id, name) => {
    await db.execute('UPDATE tag_categories SET name = ? WHERE id = ?', [name, id]);
    await get().fetchTagCategories(db);
  },

  deleteTagCategory: async (db, id) => {
    await db.execute('UPDATE tags SET tag_category_id = NULL WHERE tag_category_id = ?', [id]);
    await db.execute('DELETE FROM tag_categories WHERE id = ?', [id]);
    await get().fetchTagCategories(db);
    await get().fetchTags(db);
  },

  createCategory: async (db, name, color, parentId) => {
    const pid = parentId ?? null;
    const result = await db.execute(
      'INSERT OR IGNORE INTO categories (name, color, parent_id) VALUES (?, ?, ?)',
      [name, color, pid]
    );
    if (result.rowsAffected > 0 && result.lastInsertId != null) {
      const category: Category = { id: result.lastInsertId, name, color, parent_id: pid, created_at: new Date().toISOString() };
      set((state) => {
        if (state.categories.some((c) => c.id === category.id)) return state;
        const categories = [...state.categories];
        const idx = categories.findIndex((c) => c.name.localeCompare(name) > 0);
        if (idx === -1) categories.push(category); else categories.splice(idx, 0, category);
        return { categories };
      });
      return category;
    } else {
      const rows = await db.select<Category[]>('SELECT * FROM categories WHERE name = ?', [name]);
      return rows[0];
    }
  },

  updateCategory: async (db, categoryId, name, color, parentId) => {
    if (parentId !== undefined) {
      await db.execute(
        'UPDATE categories SET name = ?, color = ?, parent_id = ? WHERE id = ?',
        [name, color, parentId, categoryId]
      );
    } else {
      await db.execute('UPDATE categories SET name = ?, color = ? WHERE id = ?', [name, color, categoryId]);
    }
    await get().fetchCategories(db);
  },

  deleteCategory: async (db, categoryId) => {
    // 子カテゴリをルートに昇格（parent_id = NULL）
    await db.execute('UPDATE categories SET parent_id = NULL WHERE parent_id = ?', [categoryId]);
    await db.execute('UPDATE videos SET category_id = NULL WHERE category_id = ?', [categoryId]);
    await db.execute('DELETE FROM categories WHERE id = ?', [categoryId]);
    await get().fetchCategories(db);
  },

  addTagToVideo: async (db, videoId, tagId) => {
    await db.execute(
      'INSERT OR IGNORE INTO video_tags (video_id, tag_id) VALUES (?, ?)',
      [videoId, tagId]
    );
    await get().fetchVideoTags(db, videoId);
  },

  removeTagFromVideo: async (db, videoId, tagId) => {
    await db.execute(
      'DELETE FROM video_tags WHERE video_id = ? AND tag_id = ?',
      [videoId, tagId]
    );
    set((state) => ({
      videoTags: {
        ...state.videoTags,
        [videoId]: (state.videoTags[videoId] ?? []).filter((t) => t.id !== tagId),
      },
    }));
  },

  setVideoCategory: async (db, videoId, categoryId) => {
    await db.execute('UPDATE videos SET category_id = ? WHERE id = ?', [categoryId, videoId]);
  },

  addTagToMultiple: async (db, videoIds, tagId) => {
    if (videoIds.length === 0) return;
    // N+1 クエリを避けるため VALUES (...), (...) でバッチ INSERT
    const placeholders = videoIds.map(() => '(?, ?)').join(', ');
    const params: number[] = [];
    for (const videoId of videoIds) {
      params.push(videoId, tagId);
    }
    await db.execute(
      `INSERT OR IGNORE INTO video_tags (video_id, tag_id) VALUES ${placeholders}`,
      params
    );
    // Refresh tags for current page videos
    const currentIds = Object.keys(get().videoTags).map(Number);
    if (currentIds.length > 0) {
      await get().fetchVideoTagsForIds(db, currentIds);
    }
  },

  setCategoryMultiple: async (db, videoIds, categoryId) => {
    if (videoIds.length === 0) return;
    // N+1 クエリを避けるため IN (...) でバッチ UPDATE
    const ph = videoIds.map(() => '?').join(', ');
    await db.execute(
      `UPDATE videos SET category_id = ? WHERE id IN (${ph})`,
      [categoryId, ...videoIds]
    );
  },
}));
