import { useState, useEffect } from 'react';
import { useTagStore } from '../../store/useTagStore';
import { useLibraryStore } from '../../store/useLibraryStore';
import { TagBadge } from './TagBadge';
import type { Video, Tag } from '../../types';

const COLORS = [
  '#ef4444', '#f97316', '#eab308', '#22c55e',
  '#06b6d4', '#3b82f6', '#8b5cf6', '#ec4899', '#6b7280',
];

interface Props {
  video: Video;
  onClose: () => void;
}

export function VideoTagsModal({ video, onClose }: Props) {
  const { tags, categories, videoTags, addTagToVideo, removeTagFromVideo, setVideoCategory, fetchVideoTags, createTag } =
    useTagStore();
  const { db, fetchVideos } = useLibraryStore();
  const [tagInput, setTagInput] = useState('');
  const [newTagColor, setNewTagColor] = useState(COLORS[5]);
  const [categoryId, setCategoryId] = useState<string>(video.category_id?.toString() ?? '');

  const currentTags = videoTags[video.id] ?? [];

  useEffect(() => {
    if (db) fetchVideoTags(db, video.id);
  }, [db, video.id]);

  const filteredSuggestions = tagInput
    ? tags.filter(
        (t) =>
          !currentTags.some((ct) => ct.id === t.id) &&
          t.name.toLowerCase().includes(tagInput.toLowerCase())
      )
    : [];

  const exactMatch = tags.some((t) => t.name.toLowerCase() === tagInput.toLowerCase());

  const handleAddTag = async (tag: Tag) => {
    if (!db) return;
    await addTagToVideo(db, video.id, tag.id);
    setTagInput('');
  };

  const handleCreateAndAdd = async () => {
    if (!db || !tagInput.trim()) return;
    const tag = await createTag(db, tagInput.trim(), newTagColor);
    await addTagToVideo(db, video.id, tag.id);
    setTagInput('');
  };

  const handleRemoveTag = async (tagId: number) => {
    if (!db) return;
    await removeTagFromVideo(db, video.id, tagId);
  };

  const handleCategoryChange = async (value: string) => {
    if (!db) return;
    setCategoryId(value);
    await setVideoCategory(db, video.id, value ? Number(value) : null);
    await fetchVideos();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={onClose}
    >
      <div
        className="bg-white dark:bg-gray-900 rounded-xl shadow-xl p-5 w-full max-w-md mx-4"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between mb-4">
          <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100 truncate pr-4">
            {video.title ?? video.path.split('/').pop()}
          </h2>
          <button
            type="button"
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 shrink-0 text-lg leading-none"
            onClick={onClose}
          >
            ✕
          </button>
        </div>

        {/* Category */}
        <div className="mb-4">
          <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5">
            カテゴリ
          </label>
          <select
            className="w-full px-3 py-1.5 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 text-sm text-gray-900 dark:text-gray-100"
            value={categoryId}
            onChange={(e) => handleCategoryChange(e.target.value)}
          >
            <option value="">なし</option>
            {categories.map((cat) => (
              <option key={cat.id} value={cat.id}>
                {cat.name}
              </option>
            ))}
          </select>
        </div>

        {/* Tags */}
        <div>
          <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5">
            タグ
          </label>
          <div className="flex flex-wrap gap-1 mb-2 min-h-6">
            {currentTags.length > 0 ? (
              currentTags.map((tag) => (
                <TagBadge key={tag.id} tag={tag} onRemove={() => handleRemoveTag(tag.id)} />
              ))
            ) : (
              <span className="text-xs text-gray-400 dark:text-gray-500">タグなし</span>
            )}
          </div>

          {/* Input + suggestions */}
          <div className="relative">
            <input
              className="w-full px-3 py-1.5 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400"
              placeholder="タグを検索 / 新規作成..."
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && tagInput && !exactMatch) handleCreateAndAdd();
                if (e.key === 'Escape') setTagInput('');
              }}
            />
            {tagInput && (
              <div className="absolute z-10 mt-1 w-full bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded shadow-lg max-h-48 overflow-y-auto">
                {filteredSuggestions.map((tag) => (
                  <button
                    key={tag.id}
                    type="button"
                    className="w-full text-left px-3 py-1.5 text-sm hover:bg-gray-50 dark:hover:bg-gray-700 flex items-center gap-2"
                    onClick={() => handleAddTag(tag)}
                  >
                    <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: tag.color }} />
                    {tag.name}
                  </button>
                ))}
                {!exactMatch && (
                  <div className="px-3 py-2 border-t border-gray-100 dark:border-gray-700">
                    <div className="flex items-center gap-1.5 mb-1.5">
                      <span className="text-xs text-gray-500 dark:text-gray-400">色:</span>
                      {COLORS.map((c) => (
                        <button
                          key={c}
                          type="button"
                          className={`w-4 h-4 rounded-full transition-transform ${
                            newTagColor === c
                              ? 'scale-125 ring-2 ring-offset-1 ring-gray-400 dark:ring-offset-gray-800'
                              : ''
                          }`}
                          style={{ backgroundColor: c }}
                          onClick={() => setNewTagColor(c)}
                        />
                      ))}
                    </div>
                    <button
                      type="button"
                      className="w-full text-left text-sm text-blue-600 dark:text-blue-400 hover:underline"
                      onClick={handleCreateAndAdd}
                    >
                      「{tagInput}」を新規作成して追加
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
