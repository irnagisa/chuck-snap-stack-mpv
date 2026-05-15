import { useState, useEffect, useRef } from 'react';
import { convertFileSrc } from '@tauri-apps/api/core';
import { useTagStore } from '../../store/useTagStore';
import { useLibraryStore } from '../../store/useLibraryStore';
import { usePlayerStore } from '../../store/usePlayerStore';
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

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function VideoDetailModal({ video, onClose }: Props) {
  const { tags, categories, videoTags, addTagToVideo, removeTagFromVideo, setVideoCategory, fetchVideoTags, createTag } =
    useTagStore();
  const { db, fetchVideos, updateVideo } = useLibraryStore();
  const { play } = usePlayerStore();

  const [localTitle, setLocalTitle] = useState(video.title ?? video.path.split('/').pop() ?? '');
  const [localRating, setLocalRating] = useState(video.rating ?? 0);
  const [categoryId, setCategoryId] = useState<string>(video.category_id?.toString() ?? '');
  const [tagInput, setTagInput] = useState('');
  const [newTagColor, setNewTagColor] = useState(COLORS[5]);
  const titleRef = useRef<HTMLInputElement>(null);

  const currentTags = videoTags[video.id] ?? [];

  useEffect(() => {
    if (db) fetchVideoTags(db, video.id);
  }, [db, video.id]);

  const progressPercent =
    video.duration && video.duration > 0
      ? Math.min((video.progress / video.duration) * 100, 100)
      : null;

  const filteredSuggestions = tagInput
    ? tags.filter(
        (t) =>
          !currentTags.some((ct) => ct.id === t.id) &&
          t.name.toLowerCase().includes(tagInput.toLowerCase())
      )
    : [];

  const exactMatch = tags.some((t) => t.name.toLowerCase() === tagInput.toLowerCase());

  const handleTitleSave = async () => {
    const trimmed = localTitle.trim();
    if (!trimmed || trimmed === (video.title ?? video.path.split('/').pop())) return;
    await updateVideo(video.id, { title: trimmed });
  };

  const handleRatingClick = async (star: number) => {
    const next = star === localRating ? 0 : star;
    setLocalRating(next);
    await updateVideo(video.id, { rating: next });
  };

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

  const handlePlay = () => {
    play(video);
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={onClose}
    >
      <div
        className="bg-white dark:bg-gray-900 rounded-xl shadow-xl w-full max-w-3xl mx-4 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">動画詳細</h2>
          <button
            type="button"
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 text-lg leading-none"
            onClick={onClose}
          >
            ✕
          </button>
        </div>

        {/* Body */}
        <div className="flex gap-5 p-5">
          {/* Left: thumbnail + play */}
          <div className="flex flex-col gap-2 shrink-0 w-48">
            <div className="relative aspect-video bg-gray-200 dark:bg-gray-700 rounded overflow-hidden">
              {video.thumbnail ? (
                <img
                  src={convertFileSrc(video.thumbnail)}
                  alt={localTitle}
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-gray-400 dark:text-gray-500 text-3xl">
                  ▶
                </div>
              )}
            </div>
            {progressPercent !== null && progressPercent > 0 && (
              <div className="h-1 bg-gray-200 dark:bg-gray-700 rounded">
                <div className="h-full bg-blue-500 rounded" style={{ width: `${progressPercent}%` }} />
              </div>
            )}
            <button
              type="button"
              className="w-full py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-sm rounded font-medium"
              onClick={handlePlay}
            >
              ▶ 再生
            </button>
          </div>

          {/* Right: info */}
          <div className="flex-1 min-w-0 flex flex-col gap-3">
            {/* タイトル */}
            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
                タイトル
              </label>
              <input
                ref={titleRef}
                className="w-full px-2 py-1 text-sm text-gray-900 dark:text-gray-100 bg-transparent border border-transparent hover:border-gray-300 dark:hover:border-gray-600 focus:border-blue-500 dark:focus:border-blue-400 rounded outline-none transition-colors"
                value={localTitle}
                onChange={(e) => setLocalTitle(e.target.value)}
                onBlur={handleTitleSave}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.currentTarget.blur(); } }}
              />
            </div>

            {/* パス */}
            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
                パス
              </label>
              <p className="text-xs text-gray-500 dark:text-gray-400 break-all">{video.path}</p>
            </div>

            {/* 再生時間 / 進捗 */}
            <div className="flex gap-4">
              {video.duration != null && (
                <div>
                  <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-0.5">
                    再生時間
                  </label>
                  <p className="text-sm text-gray-800 dark:text-gray-200">{formatDuration(video.duration)}</p>
                </div>
              )}
              {video.progress > 0 && (
                <div>
                  <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-0.5">
                    視聴位置
                  </label>
                  <p className="text-sm text-gray-800 dark:text-gray-200">{formatDuration(video.progress)}</p>
                </div>
              )}
              <div>
                <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-0.5">
                  追加日時
                </label>
                <p className="text-sm text-gray-800 dark:text-gray-200">
                  {new Date(video.created_at).toLocaleDateString('ja-JP')}
                </p>
              </div>
            </div>

            {/* 評価 */}
            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
                評価
              </label>
              <div className="flex gap-0.5">
                {[1, 2, 3, 4, 5].map((star) => (
                  <button
                    key={star}
                    type="button"
                    className={`text-xl leading-none transition-colors ${
                      star <= localRating
                        ? 'text-yellow-400'
                        : 'text-gray-300 dark:text-gray-600 hover:text-yellow-300'
                    }`}
                    onClick={() => handleRatingClick(star)}
                  >
                    ★
                  </button>
                ))}
              </div>
            </div>

            {/* カテゴリ */}
            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
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

            {/* タグ */}
            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
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
      </div>
    </div>
  );
}
