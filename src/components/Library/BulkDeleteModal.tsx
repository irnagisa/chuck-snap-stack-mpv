import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { invoke } from '@tauri-apps/api/core';
import type { Video } from '../../types';
import { useLibraryStore } from '../../store/useLibraryStore';

interface Props {
  videos: Video[];
  onClose: () => void;
  onDone: () => void;
}

export function BulkDeleteModal({ videos, onClose, onDone }: Props) {
  const { t } = useTranslation();
  const { removeMultiple } = useLibraryStore();
  const [loading, setLoading] = useState(false);
  const count = videos.length;

  const handleRemoveOnly = async () => {
    setLoading(true);
    try {
      await removeMultiple(videos.map((v) => v.id));
      onDone();
    } finally {
      setLoading(false);
    }
  };

  const handleTrashFiles = async () => {
    setLoading(true);
    try {
      await invoke('trash_multiple_video_files', { paths: videos.map((v) => v.path) });
      await removeMultiple(videos.map((v) => v.id));
      onDone();
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteFiles = async () => {
    setLoading(true);
    try {
      await invoke('delete_multiple_video_files', { paths: videos.map((v) => v.path) });
      await removeMultiple(videos.map((v) => v.id));
      onDone();
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onClose}>
      <div
        className="bg-white dark:bg-gray-800 rounded-lg shadow-xl p-5 w-80 max-w-[90vw]"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-1">
          {t('bulkDelete.title', { count })}
        </h2>
        <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">
          {t('bulkDelete.question', { count })}
        </p>

        <div className="flex flex-col gap-2">
          <button
            type="button"
            disabled={loading}
            className="w-full px-3 py-2 text-sm bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-800 dark:text-gray-200 rounded disabled:opacity-50"
            onClick={handleRemoveOnly}
          >
            {t('bulkDelete.removeFromLibrary')}
            <span className="block text-[10px] text-gray-400 dark:text-gray-500">{t('bulkDelete.removeFromLibraryDesc')}</span>
          </button>
          <button
            type="button"
            disabled={loading}
            className="w-full px-3 py-2 text-sm bg-amber-500 hover:bg-amber-600 text-white rounded disabled:opacity-50"
            onClick={handleTrashFiles}
          >
            {t('bulkDelete.moveToTrash')}
            <span className="block text-[10px] text-amber-100">{t('bulkDelete.moveToTrashDesc')}</span>
          </button>
          <button
            type="button"
            disabled={loading}
            className="w-full px-3 py-2 text-sm bg-red-600 hover:bg-red-700 text-white rounded disabled:opacity-50"
            onClick={handleDeleteFiles}
          >
            {t('bulkDelete.deleteFile')}
            <span className="block text-[10px] text-red-200">{t('bulkDelete.deleteFileDesc')}</span>
          </button>
          <button
            type="button"
            disabled={loading}
            className="w-full px-3 py-1.5 text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
            onClick={onClose}
          >
            {t('bulkDelete.cancel')}
          </button>
        </div>
      </div>
    </div>
  );
}
