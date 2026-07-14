import { useTranslation } from 'react-i18next';
import { useLibraryStore } from '../store/useLibraryStore';
import { useShallow } from 'zustand/shallow';

export function WatchDirRemovedAlert() {
  const { t } = useTranslation();
  const { pendingRemovedWatchDirs, confirmDirMissing, dismissDirRemoved } = useLibraryStore(
    useShallow((s) => ({
      pendingRemovedWatchDirs: s.pendingRemovedWatchDirs,
      confirmDirMissing: s.confirmDirMissing,
      dismissDirRemoved: s.dismissDirRemoved,
    }))
  );

  if (pendingRemovedWatchDirs.length === 0) return null;

  return (
    <div className="fixed bottom-28 left-1/2 -translate-x-1/2 z-50 flex flex-col gap-2 pointer-events-none">
      {pendingRemovedWatchDirs.map((dir) => (
        <div
          key={dir}
          className="flex items-center gap-3 px-4 py-2 rounded-lg bg-amber-800/90 text-amber-100 shadow-lg backdrop-blur pointer-events-auto"
        >
          <span className="text-amber-300">⚠</span>
          <span className="shrink-0">{t('app.watchDirRemoved')}:</span>
          <span className="text-xs font-mono truncate max-w-xs">{dir}</span>
          <button
            className="ml-2 px-2 py-0.5 rounded text-xs bg-amber-700 hover:bg-amber-600 transition-colors"
            onClick={() => confirmDirMissing(dir)}
          >
            {t('app.watchDirRemovedAction')}
          </button>
          <button
            className="px-2 py-0.5 rounded text-xs bg-amber-900/60 hover:bg-amber-900 transition-colors"
            onClick={() => dismissDirRemoved(dir)}
          >
            {t('app.watchDirRemovedDismiss')}
          </button>
        </div>
      ))}
    </div>
  );
}
