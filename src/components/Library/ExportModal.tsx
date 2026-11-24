import { useState } from 'react';
import { save, open } from '@tauri-apps/plugin-dialog';
import { invoke } from '@tauri-apps/api/core';
import { useTranslation } from "react-i18next";
import { useLibraryStore } from '../../store/useLibraryStore';
import { useTagStore } from '../../store/useTagStore';
import { usePlaylistStore } from '../../store/usePlaylistStore';
import { Download, Upload, X } from "lucide-react";
import { Button } from "../ui";

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
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div
        className="bg-white dark:bg-gray-900 rounded-xl shadow-xl w-full max-w-md mx-4 flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-200 dark:border-gray-700 shrink-0">
          <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">{t('export.title')}</h2>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="閉じる"
            onClick={onClose}
          >
            <X aria-hidden />
          </Button>
        </div>

        <div className="px-6 py-5 flex flex-col gap-4">
          <p className="text-sm text-gray-600 dark:text-gray-400">
            {t('export.desc')}
          </p>

          {phase === 'idle' && (
            <div className="flex flex-col gap-3">
              <Button
                variant="primary"
                size="md"
                fullWidth
                onClick={handleExport}
              >
                <Download aria-hidden />
                {t('export.exportButton')}
              </Button>
              <Button
                variant="secondary"
                size="md"
                fullWidth
                onClick={handleImport}
              >
                <Upload aria-hidden />
                {t('export.importButton')}
              </Button>
              <p className="text-xs text-amber-600 dark:text-amber-400">
                {t('export.importWarning')}
              </p>
            </div>
          )}

          {(phase === 'exporting' || phase === 'importing') && (
            <div className="text-center py-4 text-gray-500 dark:text-gray-400 text-sm">
              {phase === 'exporting' ? t('export.exporting') : t('export.importing')}
            </div>
          )}

          {(phase === 'done' || phase === 'error') && (
            <div className="flex flex-col gap-3">
              <p className={`text-sm ${phase === 'done' ? 'text-green-600 dark:text-green-400' : 'text-red-500'}`}>
                {message}
              </p>
              <Button
                variant="secondary"
                size="md"
                fullWidth
                onClick={() => setPhase('idle')}
              >
                {t('export.back')}
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
