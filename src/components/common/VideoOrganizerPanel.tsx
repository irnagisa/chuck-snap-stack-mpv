import { useState, useEffect, useRef, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useTagStore, buildCategoryTree, flattenCategoryTree, getCategoryPath } from '../../store/useTagStore';
import { useLibraryStore } from '../../store/useLibraryStore';
import { useSettingsStore } from '../../store/useSettingsStore';
import { TagBadge } from '../Library/TagBadge';
import { IconPicker, MediaIcon } from '../../lib/mediaIcons';
import type { Video, Tag } from '../../types';

const COLORS = [
  '#ef4444', '#f97316', '#eab308', '#22c55e',
  '#06b6d4', '#3b82f6', '#8b5cf6', '#ec4899', '#6b7280',
];

function findWatchDir(filePath: string, watchDirs: string[]): string | null {
  const normalized = filePath.replace(/\\/g, '/');
  for (const dir of watchDirs) {
    const d = dir.replace(/\\/g, '/').replace(/\/$/, '');
    if (normalized.startsWith(d + '/')) return d;
  }
  return null;
}

interface Props {
  video: Video;
}

export function VideoOrganizerPanel({ video }: Props) {
  const { t } = useTranslation();
  const { tags, categories, videoTags, addTagToVideo, removeTagFromVideo, setVideoCategory, fetchVideoTags, createTag } =
    useTagStore();
  const { fetchVideos, updateVideo, watchDirs, moveVideoFile } = useLibraryStore();
  const { categoryMode } = useSettingsStore();

  const [localRating, setLocalRating] = useState(video.rating ?? 0);
  const [categoryId, setCategoryId] = useState<string>(video.category_id?.toString() ?? '');
  const moveFile = categoryMode === 'sync';
  const [tagInput, setTagInput] = useState('');
  const [newTagColor, setNewTagColor] = useState(COLORS[5]);
  const [newTagIcon, setNewTagIcon] = useState<string | null>('tag');
  const [tagInputFocused, setTagInputFocused] = useState(false);
  const [categoryInput, setCategoryInput] = useState('');
  const [categoryInputFocused, setCategoryInputFocused] = useState(false);
  const categoryInputRef = useRef<HTMLInputElement>(null);

  const currentTags = videoTags[video.id] ?? [];

  useEffect(() => {
    fetchVideoTags(video.id);
    setLocalRating(video.rating ?? 0);
    setCategoryId(video.category_id?.toString() ?? '');
  }, [video.id]);

  useEffect(() => {
    if (categoryInputFocused) categoryInputRef.current?.focus();
  }, [categoryInputFocused]);

  const tagUsageCounts = useMemo(() => {
    const counts: Record<number, number> = {};
    for (const vtags of Object.values(videoTags)) {
      for (const tag of vtags) {
        counts[tag.id] = (counts[tag.id] ?? 0) + 1;
      }
    }
    return counts;
  }, [videoTags]);

  const selectedCategory = categoryId ? (categories.find((c) => c.id === Number(categoryId)) ?? null) : null;
  const flatCategories = useMemo(() => flattenCategoryTree(buildCategoryTree(categories)), [categories]);
  const filteredCategories = useMemo(() => {
    if (!categoryInput) return flatCategories;
    return flatCategories.filter(({ category }) =>
      category.name.toLowerCase().includes(categoryInput.toLowerCase())
    );
  }, [flatCategories, categoryInput]);
  const showCategorySuggestions = categoryInputFocused || categoryInput.length > 0;

  const filteredSuggestions = useMemo(() => {
    const unassigned = tags.filter((tag) => !currentTags.some((ct) => ct.id === tag.id));
    const filtered = tagInput
      ? unassigned.filter((tag) => tag.name.toLowerCase().includes(tagInput.toLowerCase()))
      : unassigned;
    return filtered.sort((a, b) => (tagUsageCounts[b.id] ?? 0) - (tagUsageCounts[a.id] ?? 0));
  }, [tags, currentTags, tagInput, tagUsageCounts]);

  const exactMatch = tags.some((tag) => tag.name.toLowerCase() === tagInput.toLowerCase());
  const showSuggestions = tagInputFocused || tagInput.length > 0;

  const handleRatingClick = async (star: number) => {
    const next = star === localRating ? 0 : star;
    setLocalRating(next);
    await updateVideo(video.id, { rating: next });
  };

  const handleAddTag = async (tag: Tag) => {
    await addTagToVideo(video.id, tag.id);
    setTagInput('');
  };

  const handleCreateAndAdd = async () => {
    if (!tagInput.trim()) return;
    const tag = await createTag(tagInput.trim(), newTagColor, newTagIcon);
    await addTagToVideo(video.id, tag.id);
    setTagInput('');
  };

  const handleRemoveTag = async (tagId: number) => {
    await removeTagFromVideo(video.id, tagId);
  };

  const handleCategoryChange = async (value: string) => {
    setCategoryId(value);
    const catId = value ? Number(value) : null;
    await setVideoCategory(video.id, catId);

    if (moveFile) {
      const watchDir = findWatchDir(video.path, watchDirs);
      if (watchDir) {
        const catPath = catId !== null ? getCategoryPath(catId, categories) : null;
        const destDir = catPath ? `${watchDir}/${catPath}` : `${watchDir}/Unsorted`;
        const result = await moveVideoFile(video.id, destDir);
        if (result === null) {
          alert(t('syncMode.moveFileFailed'));
        }
      }
    }

    await fetchVideos();
  };

  return (
    <div className="flex flex-col gap-4">
      {/* 評価 */}
      <div>
        <label className="block text-xs font-medium text-gray-400 dark:text-gray-500 mb-1.5">
          {t('detail.rating')}
        </label>
        <div className="flex gap-1">
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
        <label className="block text-xs font-medium text-gray-400 dark:text-gray-500 mb-1.5">
          {t('detail.category')}
        </label>
        <div className="relative">
          <div
            className={`w-full flex items-center gap-2 px-2.5 rounded-lg bg-white dark:bg-gray-800 cursor-pointer transition-colors ${
              categoryInputFocused
                ? 'border border-blue-500 dark:border-blue-400 ring-1 ring-blue-500/20 dark:ring-blue-400/20'
                : 'border border-gray-300 dark:border-gray-600 hover:border-gray-400 dark:hover:border-gray-500'
            }`}
            onClick={() => setCategoryInputFocused(true)}
          >
            {selectedCategory && (
              <span
                className="w-2 h-2 rounded-full shrink-0"
                style={{ backgroundColor: selectedCategory.color }}
              />
            )}
            {selectedCategory && !categoryInputFocused ? (
              <span className="flex-1 min-w-0 text-sm text-gray-900 dark:text-gray-100 py-1.5 truncate select-none">
                {selectedCategory.name}
              </span>
            ) : (
              <input
                ref={categoryInputRef}
                className="flex-1 min-w-0 text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 bg-transparent outline-none py-1.5"
                placeholder={t('detail.categorySearchPlaceholder')}
                value={categoryInput}
                onChange={(e) => setCategoryInput(e.target.value)}
                onFocus={() => setCategoryInputFocused(true)}
                onBlur={() => setTimeout(() => { setCategoryInputFocused(false); setCategoryInput(''); }, 150)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') { setCategoryInput(''); setCategoryInputFocused(false); }
                }}
              />
            )}
            {selectedCategory && !categoryInputFocused && (
              <button
                type="button"
                className="shrink-0 text-gray-400 hover:text-gray-500 dark:hover:text-gray-300 p-0.5 leading-none"
                title="カテゴリを解除して Inbox に戻す"
                onClick={(e) => { e.stopPropagation(); handleCategoryChange(''); }}
              >
                <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                  <path d="M18 6L6 18M6 6l12 12" />
                </svg>
              </button>
            )}
            <span className="pointer-events-none shrink-0 text-gray-400 dark:text-gray-500">
              <svg viewBox="0 0 10 6" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-3 h-3">
                <path d="M1 1l4 4 4-4" />
              </svg>
            </span>
          </div>
          {showCategorySuggestions && (
            <div className="absolute z-10 mt-1 w-full bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded shadow-lg max-h-48 overflow-y-auto">
              {filteredCategories.length === 0 ? (
                <p className="px-3 py-2 text-xs text-gray-400 dark:text-gray-500">{t('detail.noCategoryOptions')}</p>
              ) : (
                filteredCategories.map(({ category: cat, depth }) => (
                  <button
                    key={cat.id}
                    type="button"
                    className="w-full text-left px-3 py-1.5 text-sm hover:bg-gray-50 dark:hover:bg-gray-700 flex items-center gap-2"
                    style={{ paddingLeft: `${12 + depth * 16}px` }}
                    onClick={() => {
                      handleCategoryChange(cat.id.toString());
                      setCategoryInput('');
                      setCategoryInputFocused(false);
                    }}
                  >
                    <span className="shrink-0" style={{ color: cat.color }}>
                      <MediaIcon icon={cat.icon ?? 'folder'} className="w-3.5 h-3.5" />
                    </span>
                    <span className="flex-1">{cat.name}</span>
                  </button>
                ))
              )}
            </div>
          )}
        </div>
        <p className="text-xs text-gray-400 dark:text-gray-500 mt-1.5">
          {categoryMode === 'sync'
            ? t('bulkCategory.syncModeNote')
            : t('bulkCategory.virtualModeNote')}
        </p>
      </div>

      {/* タグ */}
      <div>
        <label className="block text-xs font-medium text-gray-400 dark:text-gray-500 mb-1.5">
          {t('detail.tags')}
        </label>
        <div className="flex flex-wrap gap-1.5 mb-2.5 min-h-6">
          {currentTags.length > 0 ? (
            currentTags.map((tag) => (
              <TagBadge key={tag.id} tag={tag} onRemove={() => handleRemoveTag(tag.id)} />
            ))
          ) : (
            <span className="text-xs text-gray-400 dark:text-gray-500">{t('detail.noTags')}</span>
          )}
        </div>
        <div className="relative">
          <input
            className="w-full px-3 py-1.5 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400"
            placeholder={t('detail.tagSearchPlaceholder')}
            value={tagInput}
            onChange={(e) => setTagInput(e.target.value)}
            onFocus={() => setTagInputFocused(true)}
            onBlur={() => setTimeout(() => setTagInputFocused(false), 150)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && tagInput && !exactMatch) handleCreateAndAdd();
              if (e.key === 'Escape') { setTagInput(''); setTagInputFocused(false); }
            }}
          />
          {showSuggestions && (
            <div className="absolute z-10 mt-1 w-full bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded shadow-lg max-h-48 overflow-y-auto">
              {filteredSuggestions.length === 0 && !tagInput && (
                <p className="px-3 py-2 text-xs text-gray-400 dark:text-gray-500">{t('detail.noTagsAvailable')}</p>
              )}
              {filteredSuggestions.map((tag) => (
                <button
                  key={tag.id}
                  type="button"
                  className="w-full text-left px-3 py-1.5 text-sm hover:bg-gray-50 dark:hover:bg-gray-700 flex items-center gap-2"
                  onClick={() => handleAddTag(tag)}
                >
                  <span className="shrink-0" style={{ color: tag.color }}>
                    <MediaIcon icon={tag.icon ?? 'tag'} className="w-3.5 h-3.5" />
                  </span>
                  <span className="flex-1">{tag.name}</span>
                  {(tagUsageCounts[tag.id] ?? 0) > 0 && (
                    <span className="text-xs text-gray-400 dark:text-gray-500 shrink-0">
                      {tagUsageCounts[tag.id]}件
                    </span>
                  )}
                </button>
              ))}
              {tagInput && !exactMatch && (
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
                  <div className="flex items-center gap-1.5 mb-1.5">
                    <span className="text-xs text-gray-500 dark:text-gray-400">アイコン:</span>
                    <IconPicker value={newTagIcon} onChange={setNewTagIcon} />
                  </div>
                  <button
                    type="button"
                    className="w-full text-left text-sm text-blue-600 dark:text-blue-400 hover:underline"
                    onClick={handleCreateAndAdd}
                  >
                    {t('detail.createTag', { tag: tagInput })}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
