import { useState } from 'react';
import { save, open } from '@tauri-apps/plugin-dialog';
import { invoke } from '@tauri-apps/api/core';
import { useTranslation } from "react-i18next";
import { useLibraryStore } from '../../store/useLibraryStore';
import { useTagStore } from '../../store/useTagStore';
import { usePlaylistStore } from '../../store/usePlaylistStore';
import { Download, LoaderCircle, Upload } from "lucide-react";
import { Button, Dialog, useDialogClose } from "../ui";
import styles from "./LibraryModal.module.css";

interface Props {
  onClose: () => void;
}

type Phase = 'idle' | 'exporting' | 'importing' | 'done' | 'error';

export function ExportModal({ onClose }: Props) {
  const { t } = useTranslation();
  const fetchVideos = useLibraryStore((s) => s.fetchVideos);
  const initTag = useTagStore((s) => s.init);
  const initPlaylist = usePlaylistStore((s) => s.init);

  const [phase, setPhase] = useState<Phase>('idle');
  const [message, setMessage] = useState('');
  const busy = phase === 'exporting' || phase === 'importing';
  const dialog = useDialogClose(onClose, { locked: busy });

  const handleExport = async () => {
    const filePath = await save({
      defaultPath: `chuck-backup-${new Date().toISOString().slice(0, 10)}.json`,
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });
    if (!filePath) return;

    setPhase('exporting');
    try {
      const backup = await invoke<object>('db_export_backup');
      await invoke('save_text_file', {
        path: filePath,
        content: JSON.stringify(backup, null, 2),
      });
      setPhase('done');
      setMessage(t('export.exportSuccess', { path: filePath }));
    } catch (e) {
      setPhase('error');
      setMessage(t('export.exportError', { error: e instanceof Error ? e.message : String(e) }));
    }
  };

  const handleImport = async () => {
    const filePath = await open({
      filters: [{ name: 'JSON', extensions: ['json'] }],
      multiple: false,
    });
    if (!filePath) return;

    setPhase('importing');
    try {
      const content = await invoke<string>('read_text_file', { path: filePath as string });
      const backup = JSON.parse(content);

      await invoke('db_import_backup', { data: backup });

      await fetchVideos();
      await initTag();
      await initPlaylist();

      setPhase('done');
      setMessage(t('export.importSuccess'));
    } catch (e) {
      setPhase('error');
      setMessage(t('export.exportError', { error: e instanceof Error ? e.message : String(e) }));
    }
  };

  return (
    <Dialog
      {...dialog.props}
      size="sm"
      title={t('export.title')}
      description={t('export.desc')}
      closeLabel={t('confirm.close')}
      showClose={!busy}
    >
      {phase === 'idle' && (
        <div className={styles.stackTight}>
          <Button variant="primary" size="md" fullWidth onClick={handleExport}>
            <Download aria-hidden />
            {t('export.exportButton')}
          </Button>
          <Button variant="secondary" size="md" fullWidth onClick={handleImport}>
            <Upload aria-hidden />
            {t('export.importButton')}
          </Button>
          <p className={styles.callout} data-tone="warning">
            {t('export.importWarning')}
          </p>
        </div>
      )}

      {busy && (
        <div className={styles.status}>
          <LoaderCircle className={styles.spinner} aria-hidden />
          {phase === 'exporting' ? t('export.exporting') : t('export.importing')}
        </div>
      )}

      {(phase === 'done' || phase === 'error') && (
        <div className={styles.stackTight}>
          <p className={styles.callout} data-tone={phase === 'done' ? 'success' : 'danger'}>
            {message}
          </p>
          <Button variant="secondary" size="md" fullWidth onClick={() => setPhase('idle')}>
            {t('export.back')}
          </Button>
        </div>
      )}
    </Dialog>
  );
}
