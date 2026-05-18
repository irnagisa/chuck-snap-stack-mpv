import { create } from 'zustand';
import type Database from '@tauri-apps/plugin-sql';
import type { Tag, Category } from '../types';

interface TagState {
  tags: Tag[];
  categories: Category[];
  videoTags: Record<number, Tag[]>;
}

interface TagActions {
  init: (db: Database) => Promise<void>;
  fetchTags: (db: Database) => Promise<void>;
  fetchCategories: (db: Database) => Promise<void>;
  fetchAllVideoTags: (db: Database) => Promise<void>;
  fetchVideoTags: (db: Database, videoId: number) => Promise<void>;
  createTag: (db: Database, name: string, color: string) => Promise<Tag>;
  updateTag: (db: Database, tagId: number, name: string, color: string) => Promise<void>;
  deleteTag: (db: Database, tagId: number) => Promise<void>;
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
  videoTags: {},

  init: async (db) => {
    await get().fetchTags(db);
    await get().fetchCategories(db);
    await get().fetchAllVideoTags(db);
  },

  fetchTags: async (db) => {
    const tags = await db.select<Tag[]>('SELECT * FROM tags ORDER BY name');
    set({ tags });
  },

  fetchCategories: async (db) => {
    const categories = await db.select<Category[]>('SELECT * FROM categories ORDER BY name');
    set({ categories });
  },

  fetchAllVideoTags: async (db) => {
    const rows = await db.select<{ video_id: number; id: number; name: string; color: string; created_at: string }[]>(
      `SELECT vt.video_id, t.id, t.name, t.color, t.created_at
       FROM video_tags vt JOIN tags t ON vt.tag_id = t.id`
    );
    const videoTags: Record<number, Tag[]> = {};
    for (const row of rows) {
      if (!videoTags[row.video_id]) videoTags[row.video_id] = [];
      videoTags[row.video_id].push({
        id: row.id,
        name: row.name,
        color: row.color,
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
    await get().fetchTags(db);
    return tag;
  },

  updateTag: async (db, tagId, name, color) => {
    await db.execute('UPDATE tags SET name = ?, color = ? WHERE id = ?', [name, color, tagId]);
    await get().fetchTags(db);
    await get().fetchAllVideoTags(db);
  },

  deleteTag: async (db, tagId) => {
    await db.execute('DELETE FROM tags WHERE id = ?', [tagId]);
    await get().fetchTags(db);
    const videoTags = { ...get().videoTags };
    for (const vid in videoTags) {
      videoTags[Number(vid)] = videoTags[Number(vid)].filter((t) => t.id !== tagId);
    }
    set({ videoTags });
  },

  createCategory: async (db, name, color) => {
    await db.execute('INSERT OR IGNORE INTO categories (name, color) VALUES (?, ?)', [name, color]);
    const rows = await db.select<Category[]>('SELECT * FROM categories WHERE name = ?', [name]);
    const category = rows[0];
    await get().fetchCategories(db);
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
    for (const videoId of videoIds) {
      await db.execute(
        'INSERT OR IGNORE INTO video_tags (video_id, tag_id) VALUES (?, ?)',
        [videoId, tagId]
      );
    }
    await get().fetchAllVideoTags(db);
  },

  setCategoryMultiple: async (db, videoIds, categoryId) => {
    for (const videoId of videoIds) {
      await db.execute('UPDATE videos SET category_id = ? WHERE id = ?', [categoryId, videoId]);
    }
  },
}));
