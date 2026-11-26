import { useState, useEffect, useRef, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useTagStore, buildCategoryTree, flattenCategoryTree, getCategoryPath } from '../../store/useTagStore';
import { useLibraryStore } from '../../store/useLibraryStore';
import { useInboxStore } from '../../store/useInboxStore';
import { useSettingsStore } from '../../store/useSettingsStore';
import { usePlayerStore } from '../../store/usePlayerStore';
import { toast } from '../../store/useToastStore';
import { TagBadge, tagColorStyle } from '../Library/TagBadge';
import { ColorSwatches, TAXONOMY_COLORS } from '../Library/ColorSwatches';
import { IconPicker, MediaIcon } from '../../lib/mediaIcons';
import type { Video, Tag } from '../../types';
import { ChevronDown, Plus, Search, Star, X } from "lucide-react";
import { Button, Input } from "../ui";
import styles from './VideoOrganizerPanel.module.css';

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
  /** 狭い場所 (ミニプレイヤー) 向けに説明文を省いて詰める */
  dense?: boolean;
}

export function VideoOrganizerPanel({ video, dense = false }: Props) {
  const { t } = useTranslation();
  const { tags, categories, videoTags, addTagToVideo, removeTagFromVideo, setVideoCategory, fetchVideoTags, createTag } =
    useTagStore();
  const { fetchVideos, updateVideo, watchDirs, moveVideoFile } = useLibraryStore();
  const { fetchInbox } = useInboxStore();
  const { categoryMode } = useSettingsStore();

  const [localRating, setLocalRating] = useState(video.rating ?? 0);
  const [hoverRating, setHoverRating] = useState(0);
  const [categoryId, setCategoryId] = useState<string>(video.category_id?.toString() ?? '');
  const moveFile = categoryMode === 'sync';
  const [tagInput, setTagInput] = useState('');
  const [newTagColor, setNewTagColor] = useState(TAXONOMY_COLORS[5]);
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
    // 再生中の動画ならプレイヤー側の値も合わせる
    usePlayerStore.getState().patchVideoFields(video.id, { rating: next });
    // 自動卒業が発生した場合に InboxView を更新する (非ブロッキング)
    fetchInbox().catch(() => {});
  };

  const handleAddTag = async (tag: Tag) => {
    await addTagToVideo(video.id, tag.id);
    setTagInput('');
    fetchInbox().catch(() => {});
  };

  const handleCreateAndAdd = async () => {
    if (!tagInput.trim()) return;
    const tag = await createTag(tagInput.trim(), newTagColor, newTagIcon);
    await addTagToVideo(video.id, tag.id);
    setTagInput('');
    fetchInbox().catch(() => {});
  };

  const handleRemoveTag = async (tagId: number) => {
    await removeTagFromVideo(video.id, tagId);
  };

  const handleCategoryChange = async (value: string) => {
    setCategoryId(value);
    const catId = value ? Number(value) : null;
    await setVideoCategory(video.id, catId);
    usePlayerStore.getState().patchVideoFields(video.id, { category_id: catId });

    if (moveFile) {
      const watchDir = findWatchDir(video.path, watchDirs);
      if (watchDir) {
        const catPath = catId !== null ? getCategoryPath(catId, categories) : null;
        const destDir = catPath ? `${watchDir}/${catPath}` : `${watchDir}/Unsorted`;
        const result = await moveVideoFile(video.id, destDir, video.path);
        if (result === null) {
          toast.error(t('syncMode.moveFileFailed'));
        } else {
          usePlayerStore.getState().patchVideoFields(video.id, { path: result });
        }
      }
    }

    await fetchVideos();
    fetchInbox().catch(() => {});
  };

  const shownRating = hoverRating || localRating;

  return (
    <div className={styles.root} data-dense={dense || undefined}>
      {/* 評価 */}
      <div className={styles.field}>
        <span className={styles.label}>{t('detail.rating')}</span>
        <div className={styles.stars} onMouseLeave={() => setHoverRating(0)}>
          {[1, 2, 3, 4, 5].map((star) => (
            <button
              key={star}
              type="button"
              className={styles.star}
              data-active={star <= shownRating || undefined}
              aria-label={t('detail.ratingStar', { count: star })}
              aria-pressed={star <= localRating}
              onMouseEnter={() => setHoverRating(star)}
              onClick={() => handleRatingClick(star)}
            >
              <Star aria-hidden fill="currentColor" />
            </button>
          ))}
        </div>
      </div>

      {/* カテゴリ */}
      <div className={styles.field}>
        <span className={styles.label}>{t('detail.category')}</span>
        <div className={styles.combo}>
          <div
            className={styles.trigger}
            data-focused={categoryInputFocused || undefined}
            onClick={() => setCategoryInputFocused(true)}
          >
            {selectedCategory && !categoryInputFocused ? (
              <>
                <span className={styles.iconBadge} style={tagColorStyle(selectedCategory.color)}>
                  <MediaIcon icon={selectedCategory.icon ?? 'folder'} className={styles.badgeIcon} />
                </span>
                <span className={styles.triggerText}>{selectedCategory.name}</span>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  title={t('detail.categoryClear')}
                  aria-label={t('detail.categoryClear')}
                  onClick={(e) => { e.stopPropagation(); handleCategoryChange(''); }}
                >
                  <X aria-hidden />
                </Button>
              </>
            ) : (
              <>
                <Search className={styles.triggerIcon} aria-hidden />
                <input
                  ref={categoryInputRef}
                  className={styles.triggerInput}
                  placeholder={t('detail.categorySearchPlaceholder')}
                  aria-label={t('detail.categoryPick')}
                  value={categoryInput}
                  onChange={(e) => setCategoryInput(e.target.value)}
                  onFocus={() => setCategoryInputFocused(true)}
                  onBlur={() => setTimeout(() => { setCategoryInputFocused(false); setCategoryInput(''); }, 150)}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') { setCategoryInput(''); setCategoryInputFocused(false); }
                  }}
                />
              </>
            )}
            <ChevronDown className={styles.chevron} aria-hidden />
          </div>
          {showCategorySuggestions && (
            <div className={styles.menu} role="listbox">
              {filteredCategories.length === 0 ? (
                <p className={styles.menuEmpty}>{t('detail.noCategoryOptions')}</p>
              ) : (
                filteredCategories.map(({ category: cat, depth }) => (
                  <button
                    key={cat.id}
                    type="button"
                    role="option"
                    aria-selected={selectedCategory?.id === cat.id}
                    className={styles.menuItem}
                    data-selected={selectedCategory?.id === cat.id || undefined}
                    style={{ paddingInlineStart: `calc(var(--space-2) + ${depth * 14}px)` }}
                    onClick={() => {
                      handleCategoryChange(cat.id.toString());
                      setCategoryInput('');
                      setCategoryInputFocused(false);
                    }}
                  >
                    <span className={styles.iconBadge} style={tagColorStyle(cat.color)}>
                      <MediaIcon icon={cat.icon ?? 'folder'} className={styles.badgeIcon} />
                    </span>
                    <span className={styles.menuText}>{cat.name}</span>
                  </button>
                ))
              )}
            </div>
          )}
        </div>
        {!dense && (
          <p className={styles.help}>
            {categoryMode === 'sync'
              ? t('bulkCategory.syncModeNote')
              : t('bulkCategory.virtualModeNote')}
          </p>
        )}
      </div>

      {/* タグ */}
      <div className={styles.field}>
        <span className={styles.label}>{t('detail.tags')}</span>
        <div className={styles.chips}>
          {currentTags.length > 0 ? (
            currentTags.map((tag) => (
              <TagBadge
                key={tag.id}
                tag={tag}
                showIcon
                onRemove={() => handleRemoveTag(tag.id)}
                removeLabel={t('detail.removeTag', { name: tag.name })}
              />
            ))
          ) : (
            <span className={styles.help}>{t('detail.noTags')}</span>
          )}
        </div>
        <div className={styles.combo}>
          <Input
            size="md"
            className={styles.fullWidth}
            icon={<Plus />}
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
            <div className={styles.menu} role="listbox">
              {filteredSuggestions.length === 0 && !tagInput && (
                <p className={styles.menuEmpty}>{t('detail.noTagsAvailable')}</p>
              )}
              {filteredSuggestions.map((tag) => (
                <button
                  key={tag.id}
                  type="button"
                  role="option"
                  aria-selected={false}
                  className={styles.menuItem}
                  onClick={() => handleAddTag(tag)}
                >
                  <span className={styles.iconBadge} style={tagColorStyle(tag.color)}>
                    <MediaIcon icon={tag.icon ?? 'tag'} className={styles.badgeIcon} />
                  </span>
                  <span className={styles.menuText}>{tag.name}</span>
                  {(tagUsageCounts[tag.id] ?? 0) > 0 && (
                    <span className={styles.count}>{t('detail.tagUsage', { count: tagUsageCounts[tag.id] })}</span>
                  )}
                </button>
              ))}
              {tagInput && !exactMatch && (
                // 新規作成: 色とアイコンを選んで作る (input の blur で閉じないよう mousedown を止める)
                <div className={styles.create} onMouseDown={(e) => e.preventDefault()}>
                  <div className={styles.createRow}>
                    <span className={styles.createLabel}>{t('detail.newTagColor')}</span>
                    <ColorSwatches value={newTagColor} onChange={setNewTagColor} label={t('detail.newTagColor')} />
                  </div>
                  <div className={styles.createRow}>
                    <span className={styles.createLabel}>{t('detail.newTagIcon')}</span>
                    <IconPicker value={newTagIcon} onChange={setNewTagIcon} />
                  </div>
                  <Button variant="soft" size="sm" fullWidth onClick={handleCreateAndAdd}>
                    <span className={styles.createPreview} style={tagColorStyle(newTagColor)}>
                      <MediaIcon icon={newTagIcon ?? 'tag'} className={styles.badgeIcon} />
                    </span>
                    {t('detail.createTag', { tag: tagInput })}
                  </Button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
