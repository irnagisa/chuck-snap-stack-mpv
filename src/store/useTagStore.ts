import { create } from 'zustand';
import type Database from '@tauri-apps/plugin-sql';
import type { Tag, Category, TagCategory } from '../types';

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
  createCategory: (db: Database, name: string, color: string) => Promise<Category>;
  updateCategory: (db: Database, categoryId: number, name: string, color: string) => Promise<void>;
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
    await db.execute('INSERT OR IGNORE INTO tags (name, color) VALUES (?, ?)', [name, color]);
    const rows = await db.select<Tag[]>('SELECT * FROM tags WHERE name = ?', [name]);
    const tag = rows[0];
    // fetchTags() で全件再取得せず、取得済みの tag を直接ストアに追加してクエリを節約
    if (tag) {
      set((state) => {
        if (state.tags.some((t) => t.id === tag.id)) return state;
        return { tags: [...state.tags, tag].sort((a, b) => a.name.localeCompare(b.name)) };
      });
    }
    return tag;
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
    await db.execute('INSERT OR IGNORE INTO tag_categories (name) VALUES (?)', [name]);
    const rows = await db.select<TagCategory[]>('SELECT * FROM tag_categories WHERE name = ?', [name]);
    const tc = rows[0];
    if (tc) {
      set((state) => {
        if (state.tagCategories.some((c) => c.id === tc.id)) return state;
        return { tagCategories: [...state.tagCategories, tc].sort((a, b) => a.name.localeCompare(b.name)) };
      });
    }
    return tc;
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

  createCategory: async (db, name, color) => {
    await db.execute('INSERT OR IGNORE INTO categories (name, color) VALUES (?, ?)', [name, color]);
    const rows = await db.select<Category[]>('SELECT * FROM categories WHERE name = ?', [name]);
    const category = rows[0];
    if (category) {
      set((state) => {
        if (state.categories.some((c) => c.id === category.id)) return state;
        return { categories: [...state.categories, category].sort((a, b) => a.name.localeCompare(b.name)) };
      });
    }
    return category;
  },

  updateCategory: async (db, categoryId, name, color) => {
    await db.execute('UPDATE categories SET name = ?, color = ? WHERE id = ?', [name, color, categoryId]);
    await get().fetchCategories(db);
  },

  deleteCategory: async (db, categoryId) => {
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
