import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useTagStore, getCategoryPath } from '../../store/useTagStore';
import { useLibraryStore } from '../../store/useLibraryStore';
import { useSettingsStore } from '../../store/useSettingsStore';

interface Props {
  videoIds: number[];
  onClose: () => void;
  onDone: () => void;
}

function basename(path: string): string {
  return path.replace(/\\/g, '/').replace(/\/$/, '').split('/').pop() ?? path;
}

export function BulkMoveDirModal({ videoIds, onClose, onDone }: Props) {
  const { t } = useTranslation();
  const { categories } = useTagStore();
  const { watchDirs, videos, moveVideoFile, fetchVideos } = useLibraryStore();
  const { categoryMode } = useSettingsStore();
  const [targetDir, setTargetDir] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(0);

  const handleApply = async () => {
    if (!targetDir) return;
    setLoading(true);
    setDone(0);
    let failCount = 0;

    for (let i = 0; i < videoIds.length; i++) {
      const video = videos.find((v) => v.id === videoIds[i]);
      if (!video) { setDone(i + 1); continue; }

      let destDir = targetDir;
      if (categoryMode === 'sync') {
        const catPath = video.category_id != null
          ? getCategoryPath(video.category_id, categories)
          : null;
        destDir = catPath ? `${targetDir}/${catPath}` : `${targetDir}/Unsorted`;
      }

      const result = await moveVideoFile(video.id, destDir);
      if (result === null) failCount++;
      setDone(i + 1);
    }

    if (failCount > 0) {
      alert(t('bulkMoveDir.failed', { count: failCount }));
    }

    await fetchVideos();
    setLoading(false);
    onDone();
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" role="dialog" aria-modal="true" onClick={loading ? undefined : onClose}>
      <div
        className="bg-white dark:bg-gray-800 rounded-lg shadow-xl p-5 w-80 max-w-[90vw]"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-1">
          {t('bulkMoveDir.title')}
        </h2>
        <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
          {t('bulkMoveDir.desc', { count: videoIds.length })}
        </p>

        {watchDirs.length === 0 ? (
          <p className="text-xs text-gray-400 dark:text-gray-500 mb-4">{t('bulkMoveDir.empty')}</p>
        ) : (
          <div className="flex flex-col gap-0.5 mb-4 max-h-60 overflow-y-auto">
            {watchDirs.map((dir) => (
              <label
                key={dir}
                className="flex items-center gap-2 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700 px-2 py-1.5 rounded"
                title={dir}
              >
                <input
                  type="radio"
                  name="bulk-move-dir"
                  checked={targetDir === dir}
                  onChange={() => setTargetDir(dir)}
                />
                <span className="text-gray-400 dark:text-gray-500 shrink-0">📁</span>
                <span className="text-sm text-gray-800 dark:text-gray-200 truncate">{basename(dir)}</span>
              </label>
            ))}
          </div>
        )}

        <p className="text-xs text-gray-400 dark:text-gray-500 mb-3">
          {categoryMode === 'sync'
            ? t('bulkMoveDir.syncModeNote')
            : t('bulkMoveDir.virtualModeNote')}
        </p>

        {loading && (
          <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
            {t('bulkMoveDir.running', { done, total: videoIds.length })}
          </p>
        )}

        <div className="flex gap-2">
          <button
            type="button"
            disabled={loading || !targetDir}
            className="flex-1 px-3 py-2 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded disabled:opacity-50"
            onClick={handleApply}
          >
            {loading ? t('bulkMoveDir.applying') : t('bulkMoveDir.apply')}
          </button>
          <button
            type="button"
            disabled={loading}
            className="px-3 py-2 text-sm bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 rounded"
            onClick={onClose}
          >
            {t('bulkMoveDir.cancel')}
          </button>
        </div>
      </div>
    </div>
  );
}
