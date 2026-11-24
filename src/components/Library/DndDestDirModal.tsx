import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Folder } from 'lucide-react';
import { useModalStore } from '../../store/useModalStore';
import { useLibraryStore } from '../../store/useLibraryStore';
import { Button, Dialog } from "../ui";
import styles from "./LibraryModal.module.css";

function basename(path: string): string {
  return path.replace(/\\/g, '/').replace(/\/$/, '').split('/').pop() ?? path;
}

/** ドラッグ&ドロップで取り込むファイルのコピー先 (監視フォルダ) を選ぶ */
export function DndDestDirModal() {
  const { t } = useTranslation();
  const { dndPendingFiles, dndOnSelect, closeDndDestDir } = useModalStore();
  const watchDirs = useLibraryStore((s) => s.watchDirs);

  const open = dndPendingFiles != null && dndOnSelect != null;
  // 退場アニメーション中もファイル数を表示し続けるため、最後の値を保持する
  const lastCount = useRef(0);
  if (dndPendingFiles) lastCount.current = dndPendingFiles.length;

  const handleSelect = (dir: string) => {
    dndOnSelect?.(dir);
    closeDndDestDir();
  };

  const handleCancel = () => {
    dndOnSelect?.(null);
    closeDndDestDir();
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) handleCancel();
      }}
      size="sm"
      title={t('dndDestDir.title')}
      description={t('dndDestDir.desc', { count: lastCount.current })}
      showClose={false}
      footer={
        <Button variant="secondary" onClick={handleCancel}>
          {t('dndDestDir.cancel')}
        </Button>
      }
    >
      <div className={styles.stackTight}>
        {watchDirs.map((dir) => (
          <button
            key={dir}
            type="button"
            className={styles.pickRow}
            title={`${dir}/Unsorted`}
            onClick={() => handleSelect(dir)}
          >
            <Folder className={styles.optionIcon} aria-hidden />
            <span className={styles.fileText}>
              <span className={styles.fileName}>{basename(dir)}/Unsorted</span>
              <span className={styles.filePath}>{dir}/Unsorted</span>
            </span>
          </button>
        ))}
      </div>
    </Dialog>
  );
}
