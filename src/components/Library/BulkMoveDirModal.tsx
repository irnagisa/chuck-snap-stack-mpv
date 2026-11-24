import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useTagStore, getCategoryPath } from '../../store/useTagStore';
import { useLibraryStore } from '../../store/useLibraryStore';
import { useSettingsStore } from '../../store/useSettingsStore';
import { Folder } from "lucide-react";
import { toast } from '../../store/useToastStore';
import { Button, Dialog, RadioGroup, RadioGroupItem, useDialogClose } from "../ui";
import styles from "./LibraryModal.module.css";

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
  const dialog = useDialogClose(onClose, { locked: loading });

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
      toast.error(t('bulkMoveDir.failed', { count: failCount }));
    }

    await fetchVideos();
    setLoading(false);
    dialog.close(onDone);
  };

  return (
    <Dialog
      {...dialog.props}
      size="sm"
      title={t('bulkMoveDir.title')}
      description={t('bulkMoveDir.desc', { count: videoIds.length })}
      showClose={false}
      footer={
        <>
          <Button variant="secondary" disabled={loading} onClick={() => dialog.close()}>
            {t('bulkMoveDir.cancel')}
          </Button>
          <Button variant="primary" disabled={loading || !targetDir} onClick={handleApply}>
            {loading ? t('bulkMoveDir.applying') : t('bulkMoveDir.apply')}
          </Button>
        </>
      }
    >
      <div className={styles.stackTight}>
        {watchDirs.length === 0 ? (
          <p className={styles.note}>{t('bulkMoveDir.empty')}</p>
        ) : (
          <RadioGroup
            className={styles.optionList}
            aria-label={t('bulkMoveDir.title')}
            value={targetDir ?? ''}
            onValueChange={setTargetDir}
          >
            {watchDirs.map((dir) => (
              <label key={dir} className={styles.option} title={dir}>
                <RadioGroupItem value={dir} />
                <Folder className={styles.optionIcon} aria-hidden />
                <span className={styles.optionText}>{basename(dir)}</span>
              </label>
            ))}
          </RadioGroup>
        )}

        <p className={styles.note}>
          {categoryMode === 'sync'
            ? t('bulkMoveDir.syncModeNote')
            : t('bulkMoveDir.virtualModeNote')}
        </p>

        {loading && (
          <p className={styles.callout}>
            {t('bulkMoveDir.running', { done, total: videoIds.length })}
          </p>
        )}
      </div>
    </Dialog>
  );
}
