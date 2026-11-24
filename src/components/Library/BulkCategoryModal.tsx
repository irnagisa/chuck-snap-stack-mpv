import { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useTagStore, buildCategoryTree, flattenCategoryTree, getCategoryPath, type CategoryNode } from '../../store/useTagStore';
import { useLibraryStore } from '../../store/useLibraryStore';
import { useSettingsStore } from '../../store/useSettingsStore';
import { Search } from "lucide-react";
import { Button, Input, RadioGroup, RadioGroupItem } from "../ui";

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
  collapsedIds: Set<number>;
  onToggleCollapse: (id: number) => void;
}

function TreeNode({ node, depth, collapsedIds, onToggleCollapse }: TreeNodeProps) {
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
          <RadioGroupItem value={String(node.id)} />
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
          collapsedIds={collapsedIds}
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
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" role="dialog" aria-modal="true" onClick={onClose}>
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
          <Input
            size="sm"
            className="w-full mb-2"
            icon={<Search />}
            placeholder={t('detail.categorySearchPlaceholder')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onClear={() => setSearch('')}
          />
        )}

        <RadioGroup
          className="flex flex-col gap-0.5 mb-4 max-h-60 overflow-y-auto"
          aria-label={t('bulkCategory.title')}
          value={selectedCategoryId === 'unset' ? '' : selectedCategoryId === null ? 'none' : String(selectedCategoryId)}
          onValueChange={(v) => setSelectedCategoryId(v === 'none' ? null : Number(v))}
        >
          <label className="flex items-center gap-2 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700 px-2 py-1 rounded pl-7">
            <RadioGroupItem value="none" />
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
                  <RadioGroupItem value={String(cat.id)} />
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
                collapsedIds={collapsedIds}
                onToggleCollapse={toggleCollapse}
              />
            ))
          )}
        </RadioGroup>

        {categories.length === 0 && (
          <p className="text-xs text-gray-400 dark:text-gray-500 mb-4">{t('bulkCategory.empty')}</p>
        )}

        <p className="text-xs text-gray-400 dark:text-gray-500 mb-3">
          {categoryMode === 'sync'
            ? t('bulkCategory.syncModeNote')
            : t('bulkCategory.virtualModeNote')}
        </p>

        <div className="flex gap-2">
          <Button
            variant="primary"
            size="md"
            className="flex-1"
            disabled={loading || selectedCategoryId === 'unset'}
            onClick={handleApply}
          >
            {loading ? t('bulkCategory.applying') : t('bulkCategory.apply')}
          </Button>
          <Button
            variant="secondary"
            size="md"
            disabled={loading}
            onClick={onClose}
          >
            {t('bulkCategory.cancel')}
          </Button>
        </div>
      </div>
    </div>
  );
}
