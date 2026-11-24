import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useTranslation } from "react-i18next";
import { useLibraryStore } from '../../store/useLibraryStore';
import { Check, LoaderCircle } from "lucide-react";
import { Button, Checkbox, Dialog, useDialogClose } from "../ui";
import styles from "./LibraryModal.module.css";

interface Props {
  onClose: () => void;
}

interface MissingVideo {
  id: number;
  path: string;
  title: string | null;
  reason: 'missing' | 'empty';
}

export function MissingFilesModal({ onClose }: Props) {
  const { t } = useTranslation();
  const { fetchAllForShuffle, removeMultiple } = useLibraryStore();
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<MissingVideo[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [removing, setRemoving] = useState(false);
  const [done, setDone] = useState(false);
  const dialog = useDialogClose(onClose, { locked: removing });

  useEffect(() => {
    detect();
  }, []);

  const detect = async () => {
    setLoading(true);
    setDone(false);
    try {
      const allVideos = await fetchAllForShuffle();
      const paths = allVideos.map((v) => v.path);
      const sizes: (number | null)[] = await invoke('get_file_sizes', { paths });

      const missing: MissingVideo[] = [];
      for (let i = 0; i < allVideos.length; i++) {
        const v = allVideos[i];
        const size = sizes[i];
        if (size === null) {
          missing.push({ id: v.id, path: v.path, title: v.title, reason: 'missing' });
        } else if (size === 0) {
          missing.push({ id: v.id, path: v.path, title: v.title, reason: 'empty' });
        }
      }
      setItems(missing);
      setSelected(new Set(missing.map((m) => m.id)));
    } finally {
      setLoading(false);
    }
  };

  const toggleAll = () => {
    if (selected.size === items.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(items.map((m) => m.id)));
    }
  };

  const toggleItem = (id: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleRemove = async () => {
    if (selected.size === 0) return;
    setRemoving(true);
    try {
      await removeMultiple(Array.from(selected));
      setItems((prev) => prev.filter((m) => !selected.has(m.id)));
      setSelected(new Set());
      setDone(true);
    } finally {
      setRemoving(false);
    }
  };

  const missingCount = items.filter((m) => m.reason === 'missing').length;
  const emptyCount = items.filter((m) => m.reason === 'empty').length;
  const selectedCount = selected.size;

  return (
    <Dialog
      {...dialog.props}
      size="lg"
      title={t('missingFiles.title')}
      closeLabel={t('confirm.close')}
      footer={
        <>
          <Button variant="ghost" size="xs" className={styles.footerLead} onClick={detect} disabled={loading || removing}>
            {t('missingFiles.redetect')}
          </Button>
          <Button variant="secondary" onClick={() => dialog.close()}>
            {t('missingFiles.close')}
          </Button>
          {items.length > 0 && (
            <Button variant="danger" disabled={selected.size === 0 || removing} onClick={handleRemove}>
              {removing ? t('duplicates.processing') : t('missingFiles.removeSelected', { count: selectedCount })}
            </Button>
          )}
        </>
      }
    >
      {loading ? (
        <div className={styles.status}>
          <LoaderCircle className={styles.spinner} aria-hidden />
          {t('missingFiles.loading')}
        </div>
      ) : items.length === 0 ? (
        <div className={styles.status}>
          <span className={styles.statusIcon}>
            <Check aria-hidden />
          </span>
          {done ? t('missingFiles.removed') : t('missingFiles.empty')}
        </div>
      ) : (
        <div className={styles.stack}>
          <div className={styles.spaceBetween}>
            <div className={styles.row}>
              {missingCount > 0 && (
                <span className={styles.badge} data-tone="danger">
                  {t('missingFiles.missingCount', { count: missingCount })}
                </span>
              )}
              {emptyCount > 0 && (
                <span className={styles.badge} data-tone="warning">
                  {t('missingFiles.emptyCount', { count: emptyCount })}
                </span>
              )}
            </div>
            <Button variant="soft" size="xs" onClick={toggleAll}>
              {selected.size === items.length ? t('missingFiles.deselectAll') : t('missingFiles.selectAll')}
            </Button>
          </div>

          <div className={styles.panel}>
            {items.map((item) => (
              <label
                key={item.id}
                className={styles.panelRow}
                data-tone="danger"
                data-selected={selected.has(item.id) || undefined}
              >
                <Checkbox checked={selected.has(item.id)} onCheckedChange={() => toggleItem(item.id)} />
                <span className={styles.fileText}>
                  <span className={styles.fileName}>{item.title ?? item.path.split('/').pop()}</span>
                  <span className={styles.filePath}>{item.path}</span>
                </span>
                <span className={styles.badge} data-tone={item.reason === 'missing' ? 'danger' : 'warning'}>
                  {item.reason === 'missing' ? t('missingFiles.badgeMissing') : t('missingFiles.badgeEmpty')}
                </span>
              </label>
            ))}
          </div>
        </div>
      )}
    </Dialog>
  );
}
