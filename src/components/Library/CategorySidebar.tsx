import { useState } from 'react';
import { useTagStore } from '../../store/useTagStore';
import { useLibraryStore } from '../../store/useLibraryStore';

const COLORS = [
  '#ef4444', '#f97316', '#eab308', '#22c55e',
  '#06b6d4', '#3b82f6', '#8b5cf6', '#ec4899',
];

interface Props {
  selectedCategoryId: number | null;
  onSelectCategory: (id: number | null) => void;
}

export function CategorySidebar({ selectedCategoryId, onSelectCategory }: Props) {
  const {
    categories, tags, tagCategories,
    createCategory, updateCategory, deleteCategory,
    updateTag, deleteTag,
    createTagCategory, updateTagCategory, deleteTagCategory,
  } = useTagStore();
  const { db, fetchVideos } = useLibraryStore();

  const [isAdding, setIsAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [newColor, setNewColor] = useState(COLORS[5]);

  const [editingId, setEditingId] = useState<number | null>(null);
  const [editName, setEditName] = useState('');
  const [editColor, setEditColor] = useState(COLORS[5]);

  // タグ編集状態
  const [editingTagId, setEditingTagId] = useState<number | null>(null);
  const [editTagName, setEditTagName] = useState('');
  const [editTagColor, setEditTagColor] = useState(COLORS[5]);
  const [editTagCategoryId, setEditTagCategoryId] = useState<number | null>(null);

  // タグカテゴリ追加状態
  const [isAddingTagCat, setIsAddingTagCat] = useState(false);
  const [newTagCatName, setNewTagCatName] = useState('');

  // タグカテゴリ編集状態
  const [editingTagCatId, setEditingTagCatId] = useState<number | null>(null);
  const [editTagCatName, setEditTagCatName] = useState('');

  const handleAdd = async () => {
    if (!db || !newName.trim()) return;
    await createCategory(db, newName.trim(), newColor);
    setNewName('');
    setIsAdding(false);
  };

  const handleDelete = async (id: number) => {
    if (!db) return;
    if (selectedCategoryId === id) onSelectCategory(null);
    await deleteCategory(db, id);
    await fetchVideos();
  };

  const startEdit = (id: number, name: string, color: string) => {
    setEditingId(id);
    setEditName(name);
    setEditColor(color);
  };

  const handleEditSave = async () => {
    if (!db || !editingId || !editName.trim()) return;
    await updateCategory(db, editingId, editName.trim(), editColor);
    await fetchVideos();
    setEditingId(null);
  };

  const startEditTag = (id: number, name: string, color: string, tagCategoryId: number | null) => {
    setEditingTagId(id);
    setEditTagName(name);
    setEditTagColor(color);
    setEditTagCategoryId(tagCategoryId);
  };

  const handleEditTagSave = async () => {
    if (!db || !editingTagId || !editTagName.trim()) return;
    await updateTag(db, editingTagId, editTagName.trim(), editTagColor, editTagCategoryId);
    setEditingTagId(null);
  };

  const handleDeleteTag = async (tagId: number) => {
    if (!db) return;
    await deleteTag(db, tagId);
  };

  const handleAddTagCat = async () => {
    if (!db || !newTagCatName.trim()) return;
    await createTagCategory(db, newTagCatName.trim());
    setNewTagCatName('');
    setIsAddingTagCat(false);
  };

  const handleEditTagCatSave = async () => {
    if (!db || !editingTagCatId || !editTagCatName.trim()) return;
    await updateTagCategory(db, editingTagCatId, editTagCatName.trim());
    setEditingTagCatId(null);
  };

  const handleDeleteTagCat = async (id: number) => {
    if (!db) return;
    await deleteTagCategory(db, id);
  };

  // タグをカテゴリ別にグループ化
  const tagsByCategory = tagCategories.map((tc) => ({
    category: tc,
    tags: tags.filter((t) => t.tag_category_id === tc.id),
  }));
  const uncategorizedTags = tags.filter((t) => t.tag_category_id === null);

  const renderTagRow = (tag: typeof tags[0]) => (
    <div key={tag.id}>
      {editingTagId === tag.id ? (
        <div className="flex flex-col gap-1.5 px-1 py-1 bg-gray-50 dark:bg-gray-800 rounded">
          <input
            autoFocus
            className="text-xs px-2 py-1 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100"
            value={editTagName}
            onChange={(e) => setEditTagName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleEditTagSave();
              if (e.key === 'Escape') setEditingTagId(null);
            }}
          />
          <div className="flex gap-1 flex-wrap">
            {COLORS.map((c) => (
              <button
                key={c}
                type="button"
                className={`w-4 h-4 rounded-full transition-transform ${
                  editTagColor === c ? 'scale-125 ring-2 ring-offset-1 ring-gray-400 dark:ring-offset-gray-800' : ''
                }`}
                style={{ backgroundColor: c }}
                onClick={() => setEditTagColor(c)}
              />
            ))}
          </div>
          <select
            className="text-xs px-1 py-0.5 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300"
            value={editTagCategoryId ?? ''}
            onChange={(e) => setEditTagCategoryId(e.target.value === '' ? null : Number(e.target.value))}
          >
            <option value="">カテゴリなし</option>
            {tagCategories.map((tc) => (
              <option key={tc.id} value={tc.id}>{tc.name}</option>
            ))}
          </select>
          <div className="flex gap-1">
            <button
              type="button"
              className="text-xs px-2 py-0.5 bg-blue-600 hover:bg-blue-700 text-white rounded"
              onClick={handleEditTagSave}
            >
              保存
            </button>
            <button
              type="button"
              className="text-xs px-2 py-0.5 text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
              onClick={() => setEditingTagId(null)}
            >
              キャンセル
            </button>
          </div>
        </div>
      ) : (
        <div className="group flex items-center gap-0.5">
          <span className="flex-1 px-2 py-1 text-xs flex items-center gap-1.5 text-gray-700 dark:text-gray-300">
            <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: tag.color }} />
            <span className="truncate">{tag.name}</span>
          </span>
          <button
            type="button"
            className="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-blue-500 text-xs px-0.5 shrink-0"
            onClick={() => startEditTag(tag.id, tag.name, tag.color, tag.tag_category_id)}
            title="編集"
          >
            ✎
          </button>
          <button
            type="button"
            className="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-red-500 text-xs px-0.5 shrink-0"
            onClick={() => handleDeleteTag(tag.id)}
            title="削除"
          >
            ×
          </button>
        </div>
      )}
    </div>
  );

  return (
    <aside className="flex flex-col gap-0.5 w-full min-w-0">
      <h2 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1 px-2">
        カテゴリ
      </h2>

      <button
        type="button"
        className={`text-left px-2 py-1.5 rounded text-xs transition-colors ${
          selectedCategoryId === null
            ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300 font-medium'
            : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800'
        }`}
        onClick={() => onSelectCategory(null)}
      >
        すべて
      </button>

      <button
        type="button"
        className={`text-left px-2 py-1.5 rounded text-xs transition-colors ${
          selectedCategoryId === -1
            ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300 font-medium'
            : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800'
        }`}
        onClick={() => onSelectCategory(-1)}
      >
        未設定
      </button>

      {categories.map((cat) => (
        <div key={cat.id}>
          {editingId === cat.id ? (
            <div className="flex flex-col gap-1.5 px-1 py-1 bg-gray-50 dark:bg-gray-800 rounded">
              <input
                autoFocus
                className="text-xs px-2 py-1 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleEditSave();
                  if (e.key === 'Escape') setEditingId(null);
                }}
              />
              <div className="flex gap-1 flex-wrap">
                {COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    className={`w-4 h-4 rounded-full transition-transform ${
                      editColor === c ? 'scale-125 ring-2 ring-offset-1 ring-gray-400 dark:ring-offset-gray-800' : ''
                    }`}
                    style={{ backgroundColor: c }}
                    onClick={() => setEditColor(c)}
                  />
                ))}
              </div>
              <div className="flex gap-1">
                <button
                  type="button"
                  className="text-xs px-2 py-0.5 bg-blue-600 hover:bg-blue-700 text-white rounded"
                  onClick={handleEditSave}
                >
                  保存
                </button>
                <button
                  type="button"
                  className="text-xs px-2 py-0.5 text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
                  onClick={() => setEditingId(null)}
                >
                  キャンセル
                </button>
              </div>
            </div>
          ) : (
            <div className="group flex items-center gap-0.5">
              <button
                type="button"
                className={`flex-1 text-left px-2 py-1.5 rounded text-xs flex items-center gap-1.5 transition-colors ${
                  selectedCategoryId === cat.id
                    ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300 font-medium'
                    : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800'
                }`}
                onClick={() => onSelectCategory(cat.id)}
              >
                <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: cat.color }} />
                <span className="truncate">{cat.name}</span>
              </button>
              <button
                type="button"
                className="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-blue-500 text-xs px-0.5 shrink-0"
                onClick={() => startEdit(cat.id, cat.name, cat.color)}
                title="編集"
              >
                ✎
              </button>
              <button
                type="button"
                className="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-red-500 text-xs px-0.5 shrink-0"
                onClick={() => handleDelete(cat.id)}
                title="削除"
              >
                ×
              </button>
            </div>
          )}
        </div>
      ))}

      {isAdding ? (
        <div className="mt-1 flex flex-col gap-1.5 px-1">
          <input
            autoFocus
            className="text-xs px-2 py-1 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
            placeholder="カテゴリ名"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleAdd();
              if (e.key === 'Escape') setIsAdding(false);
            }}
          />
          <div className="flex gap-1 flex-wrap">
            {COLORS.map((c) => (
              <button
                key={c}
                type="button"
                className={`w-4 h-4 rounded-full transition-transform ${
                  newColor === c ? 'scale-125 ring-2 ring-offset-1 ring-gray-400 dark:ring-offset-gray-900' : ''
                }`}
                style={{ backgroundColor: c }}
                onClick={() => setNewColor(c)}
              />
            ))}
          </div>
          <div className="flex gap-1">
            <button
              type="button"
              className="text-xs px-2 py-0.5 bg-blue-600 hover:bg-blue-700 text-white rounded"
              onClick={handleAdd}
            >
              追加
            </button>
            <button
              type="button"
              className="text-xs px-2 py-0.5 text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
              onClick={() => { setIsAdding(false); setNewName(''); }}
            >
              キャンセル
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          className="text-left px-2 py-1 text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
          onClick={() => setIsAdding(true)}
        >
          + 追加
        </button>
      )}

      {/* タグ管理 (カテゴリ別グループ表示) */}
      {tags.length > 0 || tagCategories.length > 0 ? (
        <>
          <div className="mt-3 mb-1 border-t border-gray-200 dark:border-gray-700" />
          <div className="flex items-center justify-between px-2 mb-1">
            <h2 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">
              タグ
            </h2>
            <button
              type="button"
              className="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
              title="タググループを追加"
              onClick={() => setIsAddingTagCat(true)}
            >
              + グループ
            </button>
          </div>

          {isAddingTagCat && (
            <div className="flex flex-col gap-1 px-1 mb-1">
              <input
                autoFocus
                className="text-xs px-2 py-1 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
                placeholder="グループ名"
                value={newTagCatName}
                onChange={(e) => setNewTagCatName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleAddTagCat();
                  if (e.key === 'Escape') { setIsAddingTagCat(false); setNewTagCatName(''); }
                }}
              />
              <div className="flex gap-1">
                <button
                  type="button"
                  className="text-xs px-2 py-0.5 bg-blue-600 hover:bg-blue-700 text-white rounded"
                  onClick={handleAddTagCat}
                >
                  追加
                </button>
                <button
                  type="button"
                  className="text-xs px-2 py-0.5 text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
                  onClick={() => { setIsAddingTagCat(false); setNewTagCatName(''); }}
                >
                  キャンセル
                </button>
              </div>
            </div>
          )}

          {/* カテゴリ別タググループ */}
          {tagsByCategory.map(({ category, tags: groupTags }) => (
            <div key={category.id} className="mb-1">
              <div className="group flex items-center gap-0.5 px-1">
                {editingTagCatId === category.id ? (
                  <div className="flex flex-col gap-1 flex-1 py-0.5">
                    <input
                      autoFocus
                      className="text-xs px-2 py-0.5 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100"
                      value={editTagCatName}
                      onChange={(e) => setEditTagCatName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleEditTagCatSave();
                        if (e.key === 'Escape') setEditingTagCatId(null);
                      }}
                    />
                    <div className="flex gap-1">
                      <button type="button" className="text-xs px-2 py-0.5 bg-blue-600 hover:bg-blue-700 text-white rounded" onClick={handleEditTagCatSave}>保存</button>
                      <button type="button" className="text-xs px-2 py-0.5 text-gray-500 hover:text-gray-700 dark:hover:text-gray-300" onClick={() => setEditingTagCatId(null)}>キャンセル</button>
                    </div>
                  </div>
                ) : (
                  <>
                    <span className="flex-1 text-xs font-medium text-gray-500 dark:text-gray-400 truncate">
                      {category.name}
                    </span>
                    <button
                      type="button"
                      className="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-blue-500 text-xs px-0.5 shrink-0"
                      onClick={() => { setEditingTagCatId(category.id); setEditTagCatName(category.name); }}
                      title="グループ名を編集"
                    >
                      ✎
                    </button>
                    <button
                      type="button"
                      className="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-red-500 text-xs px-0.5 shrink-0"
                      onClick={() => handleDeleteTagCat(category.id)}
                      title="グループを削除"
                    >
                      ×
                    </button>
                  </>
                )}
              </div>
              <div className="pl-2">
                {groupTags.length === 0 ? (
                  <span className="text-xs text-gray-400 dark:text-gray-600 px-2 py-0.5 block">タグなし</span>
                ) : (
                  groupTags.map(renderTagRow)
                )}
              </div>
            </div>
          ))}

          {/* カテゴリなしのタグ */}
          {uncategorizedTags.length > 0 && (
            <div className="mb-1">
              {tagCategories.length > 0 && (
                <div className="px-1 mb-0.5">
                  <span className="text-xs font-medium text-gray-400 dark:text-gray-500">その他</span>
                </div>
              )}
              <div className={tagCategories.length > 0 ? 'pl-2' : ''}>
                {uncategorizedTags.map(renderTagRow)}
              </div>
            </div>
          )}
        </>
      ) : null}
    </aside>
  );
}
