import { useTranslation } from 'react-i18next';
import { useLibraryStore } from '../store/useLibraryStore';
import { useShallow } from 'zustand/shallow';
import { AnimatePresence, motion } from 'motion/react';
import { Button, motionPresets } from './ui';

const { floatUp, presenceProps, transitions } = motionPresets;

export function WatchDirRemovedAlert() {
  const { t } = useTranslation();
  const { pendingRemovedWatchDirs, confirmDirMissing, dismissDirRemoved } = useLibraryStore(
    useShallow((s) => ({
      pendingRemovedWatchDirs: s.pendingRemovedWatchDirs,
      confirmDirMissing: s.confirmDirMissing,
      dismissDirRemoved: s.dismissDirRemoved,
    }))
  );

  return (
    <div className="fixed bottom-28 left-1/2 -translate-x-1/2 z-50 flex flex-col gap-2 pointer-events-none">
      <AnimatePresence initial={false}>
        {pendingRemovedWatchDirs.map((dir) => (
          <motion.div
            key={dir}
            layout
            variants={floatUp}
            {...presenceProps}
            transition={{ layout: transitions.spring }}
            className="flex items-center gap-3 px-4 py-2 rounded-lg bg-amber-800/90 text-amber-100 shadow-lg backdrop-blur pointer-events-auto"
          >
            <span className="text-amber-300">⚠</span>
            <span className="shrink-0">{t('app.watchDirRemoved')}:</span>
            <span className="text-xs font-mono truncate max-w-xs">{dir}</span>
            <Button size="xs" variant="inherit" className="ml-2 bg-amber-700 hover:bg-amber-600" onClick={() => confirmDirMissing(dir)}>
              {t('app.watchDirRemovedAction')}
            </Button>
            <Button size="xs" variant="inherit" onClick={() => dismissDirRemoved(dir)}>
              {t('app.watchDirRemovedDismiss')}
            </Button>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
