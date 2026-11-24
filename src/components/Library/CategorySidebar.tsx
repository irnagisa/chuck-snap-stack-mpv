import { useState, useMemo, useEffect, useRef } from 'react';
import React from 'react';
import { useTranslation } from 'react-i18next';
import { useTagStore, buildCategoryTree, flattenCategoryTree, getCategoryDescendantIds } from '../../store/useTagStore';
import { useLibraryStore } from '../../store/useLibraryStore';
import { toast } from '../../store/useToastStore';
import { Select, Button, Input } from '../ui';
import { MediaIcon, IconPicker } from '../../lib/mediaIcons';
import { ChevronRight, FolderMinus, LayoutGrid, Pencil, Plus, Search, Trash2 } from "lucide-react";
import { ColorSwatches, TAXONOMY_COLORS as COLORS } from './ColorSwatches';
import { tagColorStyle } from './TagBadge';
import styles from './CategorySidebar.module.css';

/** 名前・色・アイコン (+ 追加の項目) を編集する小さなフォーム。追加と編集で共通 */
function Editor({
  name, onNameChange, placeholder,
  color, onColorChange, icon, onIconChange,
  extra, submitLabel, cancelLabel, onSubmit, onCancel, indent = 0,
}: {
  name: string;
  onNameChange: (v: string) => void;
  placeholder?: string;
  color?: string;
  onColorChange?: (v: string) => void;
  icon?: string | null;
  onIconChange?: (v: string | null) => void;
  extra?: React.ReactNode;
  submitLabel: string;
  cancelLabel: string;
  onSubmit: () => void;
  onCancel: () => void;
  indent?: number;
}) {
  return (
    <div className={styles.editor} style={{ marginInlineStart: indent }}>
      <Input
        size="sm"
        className={styles.fullWidth}
        autoFocus
        placeholder={placeholder}
        value={name}
        onChange={(e) => onNameChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') onSubmit();
          if (e.key === 'Escape') onCancel();
        }}
      />
      {color !== undefined && onColorChange && <ColorSwatches value={color} onChange={onColorChange} />}
      {onIconChange && <IconPicker value={icon ?? null} onChange={onIconChange} />}
      {extra}
      <div className={styles.editorActions}>
        <Button variant="ghost" size="xs" onClick={onCancel}>{cancelLabel}</Button>
        <Button variant="primary" size="xs" disabled={!name.trim()} onClick={onSubmit}>{submitLabel}</Button>
      </div>
    </div>
  );
}

/** 行の右側に hover で出る操作ボタン */
function RowActions({ children }: { children: React.ReactNode }) {
  return <div className={styles.rowActions}>{children}</div>;
}

interface Props {
  selectedCategoryId: number | null;
  onSelectCategory: (id: number | null) => void;
  selectedTagIds: number[];
  onToggleTag: (id: number) => void;
}

export function CategorySidebar({ selectedCategoryId, onSelectCategory, selectedTagIds, onToggleTag }: Props) {
  const { t } = useTranslation();
  const {
    categories, tags, tagCategories,
    createCategory, updateCategory, deleteCategory,
    updateTag, deleteTag,
    createTagCategory, updateTagCategory, deleteTagCategory,
  } = useTagStore();
  const { fetchVideos } = useLibraryStore();

  const [addingParentId, setAddingParentId] = useState<number | null | undefined>(undefined);
  const [newName, setNewName] = useState('');
  const [newColor, setNewColor] = useState(COLORS[5]);
  const [newParentId, setNewParentId] = useState<number | null>(null);
  const [newIcon, setNewIcon] = useState<string | null>('folder');

  const [editingId, setEditingId] = useState<number | null>(null);
  const [editName, setEditName] = useState('');
  const [editColor, setEditColor] = useState(COLORS[5]);
  const [editParentId, setEditParentId] = useState<number | null>(null);
  const [editIcon, setEditIcon] = useState<string | null>('folder');

  const [editingTagId, setEditingTagId] = useState<number | null>(null);
  const [editTagName, setEditTagName] = useState('');
  const [editTagColor, setEditTagColor] = useState(COLORS[5]);
  const [editTagCategoryId, setEditTagCategoryId] = useState<number | null>(null);
  const [editTagIcon, setEditTagIcon] = useState<string | null>('tag');

  const [isAddingTagCat, setIsAddingTagCat] = useState(false);
  const [newTagCatName, setNewTagCatName] = useState('');

  const [editingTagCatId, setEditingTagCatId] = useState<number | null>(null);
  const [editTagCatName, setEditTagCatName] = useState('');

  const [search, setSearch] = useState('');
  const [collapsedIds, setCollapsedIds] = useState<Set<number>>(new Set());
  const [collapsedTagCatIds, setCollapsedTagCatIds] = useState<Set<number>>(new Set());
  const collapsedInitialized = useRef(false);

  const [splitRatio, setSplitRatio] = useState(0.5);
  const sectionsRef = useRef<HTMLDivElement>(null);
  const isDragging = useRef(false);
  const dragStartY = useRef(0);
  const dragStartRatio = useRef(0.5);

  const handleDividerMouseDown = (e: React.MouseEvent) => {
    isDragging.current = true;
    dragStartY.current = e.clientY;
    dragStartRatio.current = splitRatio;
    e.preventDefault();
  };

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging.current || !sectionsRef.current) return;
      const containerHeight = sectionsRef.current.getBoundingClientRect().height;
      const delta = e.clientY - dragStartY.current;
      const newRatio = Math.max(0.1, Math.min(0.9, dragStartRatio.current + delta / containerHeight));
      setSplitRatio(newRatio);
    };
    const handleMouseUp = () => { isDragging.current = false; };
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, []);

  useEffect(() => {
    if (!collapsedInitialized.current && categories.length > 0) {
      collapsedInitialized.current = true;
      const parentIds = new Set<number>(
        categories
          .filter(cat => categories.some(c => c.parent_id === cat.id))
          .map(cat => cat.id)
      );
      if (parentIds.size > 0) setCollapsedIds(parentIds);
    }
  }, [categories]);

  const searchLower = search.toLowerCase();

  const categoryTree = useMemo(() => buildCategoryTree(categories), [categories]);
  const flatCategories = useMemo(() => flattenCategoryTree(categoryTree), [categoryTree]);

  const editParentOptions = useMemo(() => {
    if (editingId === null) return flatCategories;
    const excluded = new Set(getCategoryDescendantIds(editingId, categories));
    return flatCategories.filter(({ category }) => !excluded.has(category.id));
  }, [editingId, flatCategories, categories]);

  const visibleCategoryIds = useMemo(() => {
    if (!searchLower) return null;
    const matched = new Set<number>();
    for (const cat of categories) {
      if (cat.name.toLowerCase().includes(searchLower)) {
        matched.add(cat.id);
        let pid = cat.parent_id;
        while (pid !== null) {
          matched.add(pid);
          pid = categories.find((c) => c.id === pid)?.parent_id ?? null;
        }
      }
    }
    return matched;
  }, [searchLower, categories]);

  const handleAdd = async () => {
    if (!newName.trim()) return;
    await createCategory(newName.trim(), newColor, newParentId, newIcon);
    setNewName('');
    setAddingParentId(undefined);
    setNewParentId(null);
    setNewIcon('folder');
  };

  const handleDelete = async (id: number) => {
    if (selectedCategoryId === id) onSelectCategory(null);
    try {
      await deleteCategory(id);
      await fetchVideos();
    } catch (e) {
      toast.error(String(e));
    }
  };

  const startEdit = (id: number, name: string, color: string, parentId: number | null, icon: string | null) => {
    setEditingId(id);
    setEditName(name);
    setEditColor(color);
    setEditParentId(parentId);
    setEditIcon(icon);
  };

  const handleEditSave = async () => {
    if (!editingId || !editName.trim()) return;
    await updateCategory(editingId, editName.trim(), editColor, editParentId, editIcon);
    await fetchVideos();
    setEditingId(null);
  };

  const startEditTag = (id: number, name: string, color: string, tagCategoryId: number | null, icon: string | null) => {
    setEditingTagId(id);
    setEditTagName(name);
    setEditTagColor(color);
    setEditTagCategoryId(tagCategoryId);
    setEditTagIcon(icon);
  };

  const handleEditTagSave = async () => {
    if (!editingTagId || !editTagName.trim()) return;
    await updateTag(editingTagId, editTagName.trim(), editTagColor, editTagCategoryId, editTagIcon);
    setEditingTagId(null);
  };

  const handleDeleteTag = async (tagId: number) => {
    await deleteTag(tagId);
  };

  const handleAddTagCat = async () => {
    if (!newTagCatName.trim()) return;
    await createTagCategory(newTagCatName.trim());
    setNewTagCatName('');
    setIsAddingTagCat(false);
  };

  const handleEditTagCatSave = async () => {
    if (!editingTagCatId || !editTagCatName.trim()) return;
    await updateTagCategory(editingTagCatId, editTagCatName.trim());
    setEditingTagCatId(null);
  };

  const handleDeleteTagCat = async (id: number) => {
    await deleteTagCategory(id);
  };

  // タグをカテゴリ別にグループ化 (tag → item でシャドーイング回避)
  const tagsByCategory = tagCategories.map((tc) => ({
    category: tc,
    tags: tags.filter((item) => item.tag_category_id === tc.id),
  }));
  const uncategorizedTags = tags.filter((item) => item.tag_category_id === null);

  const filteredTagsByCategory = searchLower
    ? tagsByCategory
        .map(({ category, tags: groupTags }) => {
          const catMatches = category.name.toLowerCase().includes(searchLower);
          const filteredTags = catMatches
            ? groupTags
            : groupTags.filter((item) => item.name.toLowerCase().includes(searchLower));
          return { category, tags: filteredTags };
        })
        .filter(({ category, tags: groupTags }) =>
          category.name.toLowerCase().includes(searchLower) || groupTags.length > 0
        )
    : tagsByCategory;

  const filteredUncategorizedTags = searchLower
    ? uncategorizedTags.filter((item) => item.name.toLowerCase().includes(searchLower))
    : uncategorizedTags;

  const renderTagRow = (tag: typeof tags[0]) =>
    editingTagId === tag.id ? (
      <Editor
        key={tag.id}
        name={editTagName}
        onNameChange={setEditTagName}
        color={editTagColor}
        onColorChange={setEditTagColor}
        icon={editTagIcon}
        onIconChange={setEditTagIcon}
        extra={
          <Select
            fullWidth
            aria-label={t('category.group')}
            value={editTagCategoryId == null ? '' : String(editTagCategoryId)}
            onValueChange={(v) => setEditTagCategoryId(v === '' ? null : Number(v))}
            options={[
              { value: '', label: t('category.none') },
              ...tagCategories.map((tc) => ({ value: String(tc.id), label: tc.name })),
            ]}
          />
        }
        submitLabel={t('category.save')}
        cancelLabel={t('category.cancel')}
        onSubmit={handleEditTagSave}
        onCancel={() => setEditingTagId(null)}
      />
    ) : (
      <div key={tag.id} className={styles.rowWrap}>
        <button
          type="button"
          className={styles.row}
          data-selected={selectedTagIds.includes(tag.id) || undefined}
          style={tagColorStyle(tag.color)}
          aria-pressed={selectedTagIds.includes(tag.id)}
          onClick={() => onToggleTag(tag.id)}
        >
          <span className={styles.iconBadge}>
            <MediaIcon icon={tag.icon ?? 'tag'} className={styles.badgeIcon} />
          </span>
          <span className={styles.rowText}>{tag.name}</span>
        </button>
        <RowActions>
          <Button variant="ghost" size="icon-sm" aria-label={t('category.edit')} title={t('category.edit')}
            onClick={() => startEditTag(tag.id, tag.name, tag.color, tag.tag_category_id, tag.icon)}
          >
            <Pencil aria-hidden />
          </Button>
          <Button variant="danger-soft" size="icon-sm" aria-label={t('category.delete')} title={t('category.delete')}
            onClick={() => handleDeleteTag(tag.id)}
          >
            <Trash2 aria-hidden />
          </Button>
        </RowActions>
      </div>
    );

  const renderCategoryRows = () => {
    const rows: React.ReactNode[] = [];
    const subtreeHiddenIds = new Set<number>();

    for (const { category: cat, depth } of flatCategories) {
      if (cat.parent_id !== null && subtreeHiddenIds.has(cat.parent_id)) {
        subtreeHiddenIds.add(cat.id);
        continue;
      }

      if (visibleCategoryIds !== null && !visibleCategoryIds.has(cat.id)) continue;
      const indent = depth * 14;

      const hasChildren = categories.some(c => c.parent_id === cat.id);
      const isCollapsed = collapsedIds.has(cat.id);
      if (hasChildren && isCollapsed) subtreeHiddenIds.add(cat.id);

      if (editingId === cat.id) {
        rows.push(
          <Editor
            key={`edit-${cat.id}`}
            indent={indent}
            name={editName}
            onNameChange={setEditName}
            color={editColor}
            onColorChange={setEditColor}
            icon={editIcon}
            onIconChange={setEditIcon}
            extra={
              <Select
                fullWidth
                aria-label={t('category.parent')}
                value={editParentId == null ? '' : String(editParentId)}
                onValueChange={(v) => setEditParentId(v === '' ? null : Number(v))}
                options={[
                  { value: '', label: t('category.rootParent') },
                  ...editParentOptions.map(({ category: opt, depth: d }) => ({
                    value: String(opt.id),
                    label: `${'　'.repeat(d)}${opt.name}`,
                  })),
                ]}
              />
            }
            submitLabel={t('category.save')}
            cancelLabel={t('category.cancel')}
            onSubmit={handleEditSave}
            onCancel={() => setEditingId(null)}
          />
        );
      } else {
        rows.push(
          <div key={cat.id} className={styles.rowWrap} style={{ paddingInlineStart: indent }}>
            {/* 子があれば開閉ボタン、なければ同じ幅の空き */}
            {hasChildren ? (
              <button
                type="button"
                className={styles.toggle}
                data-open={!isCollapsed || undefined}
                onClick={() => setCollapsedIds(prev => {
                  const next = new Set(prev);
                  if (next.has(cat.id)) next.delete(cat.id); else next.add(cat.id);
                  return next;
                })}
                aria-label={isCollapsed ? t('category.expand') : t('category.collapse')}
                title={isCollapsed ? t('category.expand') : t('category.collapse')}
              >
                <ChevronRight aria-hidden />
              </button>
            ) : (
              <span className={styles.toggleSpacer} data-child={depth > 0 || undefined} />
            )}
            <button
              type="button"
              className={styles.row}
              data-selected={selectedCategoryId === cat.id || undefined}
              style={tagColorStyle(cat.color)}
              aria-current={selectedCategoryId === cat.id || undefined}
              onClick={() => onSelectCategory(cat.id)}
            >
              <span className={styles.iconBadge}>
                <MediaIcon icon={cat.icon ?? 'folder'} className={styles.badgeIcon} />
              </span>
              <span className={styles.rowText}>{cat.name}</span>
            </button>
            <RowActions>
              <Button variant="ghost" size="icon-sm" aria-label={t('category.addChild')} title={t('category.addChild')}
                onClick={() => {
                  setCollapsedIds(prev => { const next = new Set(prev); next.delete(cat.id); return next; });
                  setAddingParentId(cat.id);
                  setNewParentId(cat.id);
                  setNewName('');
                  setNewColor(COLORS[5]);
                  setNewIcon('folder');
                }}
              >
                <Plus aria-hidden />
              </Button>
              <Button variant="ghost" size="icon-sm" aria-label={t('category.edit')} title={t('category.edit')}
                onClick={() => startEdit(cat.id, cat.name, cat.color, cat.parent_id, cat.icon)}
              >
                <Pencil aria-hidden />
              </Button>
              <Button variant="danger-soft" size="icon-sm" aria-label={t('category.delete')} title={t('category.delete')}
                onClick={() => handleDelete(cat.id)}
              >
                <Trash2 aria-hidden />
              </Button>
            </RowActions>
          </div>
        );
      }

      if (addingParentId === cat.id && !isCollapsed) {
        rows.push(
          <Editor
            key={`add-child-${cat.id}`}
            indent={indent + 20}
            name={newName}
            onNameChange={setNewName}
            placeholder={t('category.subnamePlaceholder')}
            color={newColor}
            onColorChange={setNewColor}
            icon={newIcon}
            onIconChange={setNewIcon}
            submitLabel={t('category.add')}
            cancelLabel={t('category.cancel')}
            onSubmit={handleAdd}
            onCancel={() => { setAddingParentId(undefined); setNewName(''); }}
          />
        );
      }
    }
    return rows;
  };

  const hasTagsSection = (tags.length > 0 || tagCategories.length > 0) && (!searchLower || filteredTagsByCategory.some(g => g.tags.length > 0 || g.category.name.toLowerCase().includes(searchLower)) || filteredUncategorizedTags.length > 0);

  return (
    <aside className={styles.root}>
      <Input
        size="xs"
        className={styles.search}
        icon={<Search />}
        placeholder={t('category.searchPlaceholder')}
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        onClear={() => setSearch('')}
      />

      <div
        ref={sectionsRef}
        className={styles.sections}
        style={hasTagsSection
          ? { display: 'grid', gridTemplateRows: `${splitRatio}fr 12px ${1 - splitRatio}fr` }
          : { display: 'flex', flexDirection: 'column' }}
      >
        {/* ---- カテゴリ ---- */}
        <div className={styles.pane}>
          <div className={styles.sectionHead}>
            <h2 className={styles.sectionTitle}>{t('category.title')}</h2>
            {categories.length > 0 && <span className={styles.count}>{categories.length}</span>}
            <Button
              variant="ghost"
              size="icon-sm"
              title={t('category.add')}
              aria-label={t('category.add')}
              onClick={() => { setAddingParentId(null); setNewParentId(null); setNewName(''); setNewColor(COLORS[5]); setNewIcon('folder'); }}
            >
              <Plus aria-hidden />
            </Button>
          </div>

          <div className={styles.rowWrap}>
            <button
              type="button"
              className={styles.row}
              data-selected={selectedCategoryId === null || undefined}
              aria-current={selectedCategoryId === null || undefined}
              onClick={() => onSelectCategory(null)}
            >
              <span className={styles.iconBadge} data-neutral="">
                <LayoutGrid className={styles.badgeIcon} aria-hidden />
              </span>
              <span className={styles.rowText}>{t('category.all')}</span>
            </button>
          </div>
          <div className={styles.rowWrap}>
            <button
              type="button"
              className={styles.row}
              data-selected={selectedCategoryId === -1 || undefined}
              aria-current={selectedCategoryId === -1 || undefined}
              onClick={() => onSelectCategory(-1)}
            >
              <span className={styles.iconBadge} data-neutral="">
                <FolderMinus className={styles.badgeIcon} aria-hidden />
              </span>
              <span className={styles.rowText}>{t('category.uncategorized')}</span>
            </button>
          </div>

          {categories.length > 0 && <div className={styles.separator} />}
          {renderCategoryRows()}

          {addingParentId === null && (
            <Editor
              name={newName}
              onNameChange={setNewName}
              placeholder={t('category.namePlaceholder')}
              color={newColor}
              onColorChange={setNewColor}
              icon={newIcon}
              onIconChange={setNewIcon}
              submitLabel={t('category.add')}
              cancelLabel={t('category.cancel')}
              onSubmit={handleAdd}
              onCancel={() => { setAddingParentId(undefined); setNewName(''); }}
            />
          )}
        </div>

        {hasTagsSection && (
          <div
            className={styles.divider}
            onMouseDown={handleDividerMouseDown}
            role="separator"
            aria-orientation="horizontal"
          >
            <span className={styles.dividerGrip} />
          </div>
        )}

        {/* ---- タグ ---- */}
        {hasTagsSection && (
          <div className={styles.pane}>
            <div className={styles.sectionHead}>
              <h2 className={styles.sectionTitle}>{t('category.tagsTitle')}</h2>
              {tags.length > 0 && <span className={styles.count}>{tags.length}</span>}
              <Button
                variant="ghost"
                size="icon-sm"
                title={t('category.addGroup')}
                aria-label={t('category.addGroup')}
                onClick={() => setIsAddingTagCat(true)}
              >
                <Plus aria-hidden />
              </Button>
            </div>

            {isAddingTagCat && (
              <Editor
                name={newTagCatName}
                onNameChange={setNewTagCatName}
                placeholder={t('category.groupNamePlaceholder')}
                submitLabel={t('category.add')}
                cancelLabel={t('category.cancel')}
                onSubmit={handleAddTagCat}
                onCancel={() => { setIsAddingTagCat(false); setNewTagCatName(''); }}
              />
            )}

            {filteredTagsByCategory.map(({ category, tags: groupTags }) => {
              const collapsed = collapsedTagCatIds.has(category.id);
              return (
                <div key={category.id} className={styles.group}>
                  {editingTagCatId === category.id ? (
                    <Editor
                      name={editTagCatName}
                      onNameChange={setEditTagCatName}
                      submitLabel={t('category.save')}
                      cancelLabel={t('category.cancel')}
                      onSubmit={handleEditTagCatSave}
                      onCancel={() => setEditingTagCatId(null)}
                    />
                  ) : (
                    <div className={styles.groupHead}>
                      <button
                        type="button"
                        className={styles.groupToggle}
                        data-open={!collapsed || undefined}
                        onClick={() => setCollapsedTagCatIds(prev => {
                          const next = new Set(prev);
                          if (next.has(category.id)) next.delete(category.id); else next.add(category.id);
                          return next;
                        })}
                        aria-expanded={!collapsed}
                      >
                        <ChevronRight aria-hidden />
                        <span className={styles.groupName}>{category.name}</span>
                        <span className={styles.groupCount}>{groupTags.length}</span>
                      </button>
                      <RowActions>
                        <Button variant="ghost" size="icon-sm" aria-label={t('category.editGroup')} title={t('category.editGroup')}
                          onClick={() => { setEditingTagCatId(category.id); setEditTagCatName(category.name); }}
                        >
                          <Pencil aria-hidden />
                        </Button>
                        <Button variant="danger-soft" size="icon-sm" aria-label={t('category.deleteGroup')} title={t('category.deleteGroup')}
                          onClick={() => handleDeleteTagCat(category.id)}
                        >
                          <Trash2 aria-hidden />
                        </Button>
                      </RowActions>
                    </div>
                  )}
                  {!collapsed && (
                    <div className={styles.groupBody}>
                      {groupTags.length === 0 ? (
                        <span className={styles.empty}>{t('category.noTags')}</span>
                      ) : (
                        groupTags.map(renderTagRow)
                      )}
                    </div>
                  )}
                </div>
              );
            })}

            {filteredUncategorizedTags.length > 0 && (
              <div className={styles.group}>
                {tagCategories.length > 0 && (
                  <div className={styles.groupHead}>
                    <span className={styles.groupLabel}>{t('category.others')}</span>
                  </div>
                )}
                <div className={tagCategories.length > 0 ? styles.groupBody : undefined}>
                  {filteredUncategorizedTags.map(renderTagRow)}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </aside>
  );
}
