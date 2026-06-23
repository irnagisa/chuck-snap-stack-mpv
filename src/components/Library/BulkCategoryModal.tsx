import { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useTagStore, buildCategoryTree, flattenCategoryTree, getCategoryPath } from '../../store/useTagStore';
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

export function BulkCategoryModal({ videoIds, onClose, onDone }: Props) {
  const { t } = useTranslation();
  const { categories, setCategoryMultiple } = useTagStore();
  const { fetchVideos, watchDirs, videos, moveVideoFile } = useLibraryStore();
  const { categoryMode } = useSettingsStore();
  const flatCategories = useMemo(() => flattenCategoryTree(buildCategoryTree(categories)), [categories]);
  const [selectedCategoryId, setSelectedCategoryId] = useState<number | null | 'unset'>('unset');
  // Sync モード: 常に移動 / Virtual モード: 移動しない
  const moveFiles = categoryMode === 'sync';
  const [loading, setLoading] = useState(false);

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
          const destDir = catPath ? `${watchDir}/${catPath}` : watchDir;
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

        <div className="flex flex-col gap-1.5 mb-4 max-h-60 overflow-y-auto">
          <label className="flex items-center gap-2 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700 px-2 py-1 rounded">
            <input
              type="radio"
              name="bulk-category"
              checked={selectedCategoryId === null}
              onChange={() => setSelectedCategoryId(null)}
            />
            <span className="text-sm text-gray-500 dark:text-gray-400">{t('bulkCategory.none')}</span>
          </label>

          {flatCategories.map(({ category: cat, depth }) => (
            <label
              key={cat.id}
              className="flex items-center gap-2 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700 px-2 py-1 rounded"
              style={{ paddingLeft: `${8 + depth * 12}px` }}
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
          ))}
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
