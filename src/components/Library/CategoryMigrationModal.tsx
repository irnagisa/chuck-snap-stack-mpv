import { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useTagStore, getCategoryPath } from '../../store/useTagStore';
import { useLibraryStore } from '../../store/useLibraryStore';
import { Check, CircleX, Redo2 } from "lucide-react";
import { Button, Dialog, useDialogClose } from "../ui";
import styles from "./LibraryModal.module.css";

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
  // 実行中は閉じない。完了後に閉じたら onDone (モード切替を確定) を呼ぶ
  const dialog = useDialogClose(onCancel, { locked: phase === 'running' });

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
    dialog.close(onDone);
  };

  return (
    <Dialog
      {...dialog.props}
      // 完了後は × や Esc で閉じても切替を確定させる
      onExitComplete={phase === 'done' ? onDone : dialog.props.onExitComplete}
      size="sm"
      title={t('categoryMigration.title')}
      showClose={false}
      footer={
        phase === 'confirm' ? (
          <>
            <Button variant="ghost" className={styles.footerLead} onClick={() => dialog.close()}>
              {t('categoryMigration.cancelButton')}
            </Button>
            <Button variant="secondary" onClick={handleSkipMigration}>
              {targets.length > 0 ? t('categoryMigration.skipButton') : t('categoryMigration.switchOnly')}
            </Button>
            {targets.length > 0 && (
              <Button variant="primary" onClick={handleStartMigration}>
                {t('categoryMigration.startButton')}
              </Button>
            )}
          </>
        ) : phase === 'done' ? (
          <Button variant="primary" onClick={() => dialog.close(onDone)}>
            {t('categoryMigration.closeButton')}
          </Button>
        ) : undefined
      }
    >
      {phase === 'confirm' && (
        <div className={styles.stackTight}>
          <p className={styles.muted}>{t('categoryMigration.desc')}</p>
          <p className={styles.callout} data-tone="warning">{t('categoryMigration.warning')}</p>
          <p className={styles.note}>{t('categoryMigration.watchDirNote')}</p>
          <p className={targets.length > 0 ? styles.strong : styles.note}>
            {targets.length > 0
              ? t('categoryMigration.targetCount', { count: targets.length })
              : t('categoryMigration.noTargets')}
          </p>
        </div>
      )}

      {phase === 'running' && (
        <div className={styles.stackTight}>
          <p className={styles.muted}>{t('categoryMigration.running', { done, total: targets.length })}</p>
          <div className={styles.meter}>
            <div
              className={styles.meterBar}
              style={{ width: `${targets.length > 0 ? (done / targets.length) * 100 : 0}%` }}
            />
          </div>
        </div>
      )}

      {phase === 'done' && (
        <div className={styles.stackTight}>
          <p className={styles.callout} data-tone="success">{t('categoryMigration.done')}</p>
          <ul className={styles.resultList}>
            <li><Check aria-hidden />{t('categoryMigration.resultMoved', { count: movedCount })}</li>
            {skippedCount > 0 && (
              <li><Redo2 aria-hidden />{t('categoryMigration.resultSkipped', { count: skippedCount })}</li>
            )}
            {failedCount > 0 && (
              <li data-tone="danger"><CircleX aria-hidden />{t('categoryMigration.resultFailed', { count: failedCount })}</li>
            )}
          </ul>
        </div>
      )}
    </Dialog>
  );
}
