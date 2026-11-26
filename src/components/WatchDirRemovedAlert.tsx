import { useTranslation } from 'react-i18next';
import { useLibraryStore } from '../store/useLibraryStore';
import { useShallow } from 'zustand/shallow';
import { AnimatePresence, motion } from 'motion/react';
import { Button, motionPresets } from './ui';
import styles from './WatchDirRemovedAlert.module.css';

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
    <div className={styles.stack}>
      <AnimatePresence initial={false}>
        {pendingRemovedWatchDirs.map((dir) => (
          <motion.div
            key={dir}
            layout
            variants={floatUp}
            {...presenceProps}
            transition={{ layout: transitions.spring }}
            className={styles.alert}
            role="alert"
          >
            <span className={styles.icon} aria-hidden>⚠</span>
            <span className={styles.label}>{t('app.watchDirRemoved')}:</span>
            <span className={styles.dir} title={dir}>{dir}</span>
            <Button size="xs" variant="inherit" className={styles.confirm} onClick={() => confirmDirMissing(dir)}>
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
