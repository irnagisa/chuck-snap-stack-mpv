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
  const { categories, createCategory, deleteCategory } = useTagStore();
  const { db, fetchVideos } = useLibraryStore();
  const [isAdding, setIsAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [newColor, setNewColor] = useState(COLORS[5]);

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

  return (
    <aside className="w-44 shrink-0 flex flex-col gap-0.5">
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

      {categories.map((cat) => (
        <div key={cat.id} className="group flex items-center gap-1">
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
            className="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-red-500 text-xs px-1 shrink-0"
            onClick={() => handleDelete(cat.id)}
            title="削除"
          >
            ×
          </button>
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
    </aside>
  );
}
