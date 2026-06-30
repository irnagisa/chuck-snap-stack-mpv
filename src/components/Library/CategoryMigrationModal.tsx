import { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useTagStore, getCategoryPath } from '../../store/useTagStore';
import { useLibraryStore } from '../../store/useLibraryStore';

interface Props {
  /** モード切替が完了したときのコールバック */
  onDone: () => void;
  /** キャンセル時のコールバック */
  onCancel: () => void;
}

function findWatchDir(filePath: string, watchDirs: string[]): string | null {
  const normalized = filePath.replace(/\\/g, '/');
  for (const dir of watchDirs) {
    const d = dir.replace(/\\/g, '/').replace(/\/$/, '');
    if (normalized.startsWith(d + '/')) return d;
  }
  return null;
}

type Phase = 'confirm' | 'running' | 'done';

export function CategoryMigrationModal({ onDone, onCancel }: Props) {
  const { t } = useTranslation();
  const { categories } = useTagStore();
  const { videos, watchDirs, moveVideoFile } = useLibraryStore();

  // カテゴリが設定されているがウォッチディレクトリに属するビデオ
  const targets = useMemo(() => {
    return videos.filter((v) => {
      if (v.category_id === null || v.category_id === undefined) return false;
      const watchDir = findWatchDir(v.path, watchDirs);
      if (!watchDir) return false;
      const catPath = getCategoryPath(v.category_id, categories);
      if (!catPath) return false;
      const expected = `${watchDir}/${catPath}`;
      // 既に期待されるディレクトリにあるファイルは除外
      const normalized = v.path.replace(/\\/g, '/');
      const dirOfFile = normalized.substring(0, normalized.lastIndexOf('/'));
      const expectedNorm = expected.replace(/\\/g, '/').replace(/\/$/, '');
      return dirOfFile !== expectedNorm;
    });
  }, [videos, watchDirs, categories]);

  const [phase, setPhase] = useState<Phase>('confirm');
  const [done, setDone] = useState(0);
  const [movedCount, setMovedCount] = useState(0);
  const [skippedCount, setSkippedCount] = useState(0);
  const [failedCount, setFailedCount] = useState(0);

  const handleStartMigration = async () => {
    setPhase('running');
    let moved = 0;
    let failed = 0;
    let skipped = 0;

    for (let i = 0; i < targets.length; i++) {
      const video = targets[i];
      const watchDir = findWatchDir(video.path, watchDirs);
      if (!watchDir) {
        skipped++;
        setDone(i + 1);
        continue;
      }
      const catPath = video.category_id !== null && video.category_id !== undefined
        ? getCategoryPath(video.category_id, categories)
        : null;
      const destDir = catPath ? `${watchDir}/${catPath}` : `${watchDir}/Unsorted`;

      const result = await moveVideoFile(video.id, destDir);
      if (result !== null) {
        moved++;
      } else {
        failed++;
      }
      setDone(i + 1);
    }

    setMovedCount(moved);
    setSkippedCount(skipped);
    setFailedCount(failed);
    setPhase('done');
  };

  const handleSkipMigration = () => {
    // 移行せずに Sync モードに切り替え
    onDone();
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-60" onClick={phase === 'confirm' ? onCancel : undefined}>
      <div
        className="bg-white dark:bg-gray-800 rounded-lg shadow-xl p-5 w-96 max-w-[90vw]"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-2">
          {t('categoryMigration.title')}
        </h2>

        {phase === 'confirm' && (
          <>
            <p className="text-xs text-gray-600 dark:text-gray-400 mb-2">
              {t('categoryMigration.desc')}
            </p>
            <p className="text-xs text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 rounded p-2 mb-2">
              {t('categoryMigration.warning')}
            </p>
            <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
              {t('categoryMigration.watchDirNote')}
            </p>

            {targets.length > 0 ? (
              <p className="text-xs font-medium text-gray-700 dark:text-gray-300 mb-4">
                {targets.length} 件のファイルを移動します
              </p>
            ) : (
              <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">
                移動が必要なファイルはありません
              </p>
            )}

            <div className="flex flex-col gap-2">
              {targets.length > 0 && (
                <button
                  type="button"
                  className="w-full px-3 py-2 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded"
                  onClick={handleStartMigration}
                >
                  {t('categoryMigration.startButton')}
                </button>
              )}
              <button
                type="button"
                className="w-full px-3 py-2 text-sm bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 rounded"
                onClick={handleSkipMigration}
              >
                {targets.length > 0 ? t('categoryMigration.skipButton') : 'Sync モードに切り替え'}
              </button>
              <button
                type="button"
                className="w-full px-3 py-2 text-sm text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 rounded"
                onClick={onCancel}
              >
                {t('categoryMigration.cancelButton')}
              </button>
            </div>
          </>
        )}

        {phase === 'running' && (
          <>
            <p className="text-xs text-gray-600 dark:text-gray-400 mb-3">
              {t('categoryMigration.running', { done, total: targets.length })}
            </p>
            <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2 mb-3">
              <div
                className="bg-blue-600 h-2 rounded-full transition-all"
                style={{ width: `${targets.length > 0 ? (done / targets.length) * 100 : 0}%` }}
              />
            </div>
            <p className="text-xs text-gray-400 dark:text-gray-500">
              {done} / {targets.length}
            </p>
          </>
        )}

        {phase === 'done' && (
          <>
            <p className="text-xs font-medium text-green-600 dark:text-green-400 mb-3">
              {t('categoryMigration.done')}
            </p>
            <ul className="text-xs text-gray-600 dark:text-gray-400 space-y-1 mb-4">
              <li>✓ {t('categoryMigration.resultMoved', { count: movedCount })}</li>
              {skippedCount > 0 && (
                <li>↷ {t('categoryMigration.resultSkipped', { count: skippedCount })}</li>
              )}
              {failedCount > 0 && (
                <li className="text-red-500 dark:text-red-400">
                  ✗ {t('categoryMigration.resultFailed', { count: failedCount })}
                </li>
              )}
            </ul>
            <button
              type="button"
              className="w-full px-3 py-2 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded"
              onClick={onDone}
            >
              {t('categoryMigration.closeButton')}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
