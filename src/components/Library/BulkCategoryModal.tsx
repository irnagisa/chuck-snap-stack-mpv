import { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useTagStore, buildCategoryTree, flattenCategoryTree, getCategoryPath, type CategoryNode } from '../../store/useTagStore';
import { useLibraryStore } from '../../store/useLibraryStore';
import { useSettingsStore } from '../../store/useSettingsStore';

interface Props {
  videoIds: number[];
  onClose: () => void;
  onDone: () => void;
}

function findWatchDir(filePath: string, watchDirs: string[]): string | null {
  const normalized = filePath.replace(/\\/g, '/');
  for (const dir of watchDirs) {
    const d = dir.replace(/\\/g, '/').replace(/\/$/, '');
    if (normalized.startsWith(d + '/')) return d;
  }
  return null;
}

interface TreeNodeProps {
  node: CategoryNode;
  depth: number;
  selectedCategoryId: number | null | 'unset';
  collapsedIds: Set<number>;
  onSelect: (id: number) => void;
  onToggleCollapse: (id: number) => void;
}

function TreeNode({ node, depth, selectedCategoryId, collapsedIds, onSelect, onToggleCollapse }: TreeNodeProps) {
  const hasChildren = node.children.length > 0;
  const isCollapsed = collapsedIds.has(node.id);

  return (
    <div>
      <div
        className="flex items-center gap-1 hover:bg-gray-50 dark:hover:bg-gray-700 px-2 py-1 rounded"
        style={{ paddingLeft: `${8 + depth * 12}px` }}
      >
        <button
          type="button"
          className={`w-4 h-4 shrink-0 flex items-center justify-center text-gray-400 dark:text-gray-500 transition-transform ${!hasChildren ? 'invisible' : ''}`}
          onClick={() => onToggleCollapse(node.id)}
          tabIndex={-1}
        >
          <svg
            viewBox="0 0 6 10"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={`w-2.5 h-2.5 transition-transform duration-150 ${isCollapsed ? '' : 'rotate-90'}`}
          >
            <path d="M1 1l4 4-4 4" />
          </svg>
        </button>
        <label className="flex items-center gap-2 cursor-pointer flex-1 min-w-0">
          <input
            type="radio"
            name="bulk-category"
            checked={selectedCategoryId === node.id}
            onChange={() => onSelect(node.id)}
          />
          <span
            className="inline-block w-2.5 h-2.5 rounded-full shrink-0"
            style={{ backgroundColor: node.color }}
          />
          <span className="text-sm text-gray-800 dark:text-gray-200 truncate">{node.name}</span>
        </label>
      </div>
      {!isCollapsed && node.children.map((child) => (
        <TreeNode
          key={child.id}
          node={child}
          depth={depth + 1}
          selectedCategoryId={selectedCategoryId}
          collapsedIds={collapsedIds}
          onSelect={onSelect}
          onToggleCollapse={onToggleCollapse}
        />
      ))}
    </div>
  );
}

export function BulkCategoryModal({ videoIds, onClose, onDone }: Props) {
  const { t } = useTranslation();
  const { categories, setCategoryMultiple } = useTagStore();
  const { fetchVideos, watchDirs, videos, moveVideoFile } = useLibraryStore();
  const { categoryMode } = useSettingsStore();
  const [selectedCategoryId, setSelectedCategoryId] = useState<number | null | 'unset'>('unset');
  const [search, setSearch] = useState('');
  const [collapsedIds, setCollapsedIds] = useState<Set<number>>(new Set());
  // Sync モード: 常に移動 / Virtual モード: 移動しない
  const moveFiles = categoryMode === 'sync';
  const [loading, setLoading] = useState(false);

  const tree = useMemo(() => buildCategoryTree(categories), [categories]);
  const flatAll = useMemo(() => flattenCategoryTree(tree), [tree]);

  const filteredFlat = useMemo(() => {
    if (!search) return null;
    const q = search.toLowerCase();
    return flatAll.filter(({ category }) => category.name.toLowerCase().includes(q));
  }, [flatAll, search]);

  const toggleCollapse = (id: number) => {
    setCollapsedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleApply = async () => {
    if (selectedCategoryId === 'unset') return;
    setLoading(true);
    try {
      await setCategoryMultiple(videoIds, selectedCategoryId);

      if (moveFiles) {
        const catPath = typeof selectedCategoryId === 'number'
          ? getCategoryPath(selectedCategoryId, categories)
          : null;
        let failCount = 0;
        for (const videoId of videoIds) {
          const video = videos.find((v) => v.id === videoId);
          if (!video) continue;
          const watchDir = findWatchDir(video.path, watchDirs);
          if (!watchDir) continue;
          const destDir = catPath ? `${watchDir}/${catPath}` : `${watchDir}/Unsorted`;
          const result = await moveVideoFile(videoId, destDir);
          if (result === null) failCount++;
        }
        if (failCount > 0) {
          alert(t('syncMode.moveFilesFailed', { count: failCount }));
        }
      }

      await fetchVideos();
      onDone();
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onClose}>
      <div
        className="bg-white dark:bg-gray-800 rounded-lg shadow-xl p-5 w-72 max-w-[90vw]"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-1">
          {t('bulkCategory.title')}
        </h2>
        <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
          {t('bulkCategory.desc', { count: videoIds.length })}
        </p>

        {categories.length > 0 && (
          <div className="relative mb-2">
            <input
              type="text"
              className="w-full px-2.5 py-1.5 pl-7 text-xs border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
              placeholder={t('detail.categorySearchPlaceholder')}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <svg
              className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 pointer-events-none"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            >
              <circle cx="11" cy="11" r="8" />
              <path d="M21 21l-4.35-4.35" />
            </svg>
          </div>
        )}

        <div className="flex flex-col gap-0.5 mb-4 max-h-60 overflow-y-auto">
          <label className="flex items-center gap-2 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700 px-2 py-1 rounded pl-7">
            <input
              type="radio"
              name="bulk-category"
              checked={selectedCategoryId === null}
              onChange={() => setSelectedCategoryId(null)}
            />
            <span className="text-sm text-gray-500 dark:text-gray-400">{t('bulkCategory.none')}</span>
          </label>

          {filteredFlat ? (
            filteredFlat.length === 0 ? (
              <p className="px-2 py-2 text-xs text-gray-400 dark:text-gray-500">{t('detail.noCategoryOptions')}</p>
            ) : (
              filteredFlat.map(({ category: cat, depth }) => (
                <label
                  key={cat.id}
                  className="flex items-center gap-2 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700 px-2 py-1 rounded"
                  style={{ paddingLeft: `${28 + depth * 12}px` }}
                >
                  <input
                    type="radio"
                    name="bulk-category"
                    checked={selectedCategoryId === cat.id}
                    onChange={() => setSelectedCategoryId(cat.id)}
                  />
                  <span
                    className="inline-block w-2.5 h-2.5 rounded-full shrink-0"
                    style={{ backgroundColor: cat.color }}
                  />
                  <span className="text-sm text-gray-800 dark:text-gray-200">{cat.name}</span>
                </label>
              ))
            )
          ) : (
            tree.map((node) => (
              <TreeNode
                key={node.id}
                node={node}
                depth={0}
                selectedCategoryId={selectedCategoryId}
                collapsedIds={collapsedIds}
                onSelect={setSelectedCategoryId}
                onToggleCollapse={toggleCollapse}
              />
            ))
          )}
        </div>

        {categories.length === 0 && (
          <p className="text-xs text-gray-400 dark:text-gray-500 mb-4">{t('bulkCategory.empty')}</p>
        )}

        <p className="text-xs text-gray-400 dark:text-gray-500 mb-3">
          {categoryMode === 'sync'
            ? t('bulkCategory.syncModeNote')
            : t('bulkCategory.virtualModeNote')}
        </p>

        <div className="flex gap-2">
          <button
            type="button"
            disabled={loading || selectedCategoryId === 'unset'}
            className="flex-1 px-3 py-2 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded disabled:opacity-50"
            onClick={handleApply}
          >
            {loading ? t('bulkCategory.applying') : t('bulkCategory.apply')}
          </button>
          <button
            type="button"
            disabled={loading}
            className="px-3 py-2 text-sm bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 rounded"
            onClick={onClose}
          >
            {t('bulkCategory.cancel')}
          </button>
        </div>
      </div>
    </div>
  );
}
