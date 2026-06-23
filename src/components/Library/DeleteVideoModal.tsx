import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { invoke } from '@tauri-apps/api/core';
import type { Video } from '../../types';
import { useLibraryStore } from '../../store/useLibraryStore';

interface Props {
  video: Video;
  onClose: () => void;
  onRemoved: () => void;
}

export function DeleteVideoModal({ video, onClose, onRemoved }: Props) {
  const { t } = useTranslation();
  const { removeVideo } = useLibraryStore();
  const [loading, setLoading] = useState(false);
  const displayName = video.title ?? video.path.split('/').pop();

  const handleRemoveOnly = async () => {
    setLoading(true);
    try {
      await removeVideo(video.id);
      onRemoved();
    } finally {
      setLoading(false);
    }
  };

  const handleTrashFile = async () => {
    setLoading(true);
    try {
      await invoke('trash_video_file', { path: video.path });
      await removeVideo(video.id);
      onRemoved();
    } catch (e) {
      console.error('ゴミ箱移動失敗:', e);
      try {
        await removeVideo(video.id);
      } catch (dbErr) {
        console.error('DB削除失敗:', dbErr);
      }
      onRemoved();
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteFile = async () => {
    setLoading(true);
    try {
      await invoke('delete_video_file', { path: video.path });
      await removeVideo(video.id);
      onRemoved();
    } catch (e) {
      console.error('ファイル削除失敗:', e);
      try {
        await removeVideo(video.id);
      } catch (dbErr) {
        console.error('DB削除失敗:', dbErr);
      }
      onRemoved();
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
        <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-1">{t('deleteVideo.title')}</h2>
        <p className="text-xs text-gray-500 dark:text-gray-400 mb-4 break-all">{displayName}</p>
        <p className="text-xs text-gray-600 dark:text-gray-300 mb-4">
          {t('deleteVideo.question')}
        </p>

        <div className="flex flex-col gap-2">
          <button
            type="button"
            disabled={loading}
            className="w-full px-3 py-2 text-sm bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-800 dark:text-gray-200 rounded disabled:opacity-50"
            onClick={handleRemoveOnly}
          >
            {t('deleteVideo.removeFromLibrary')}
            <span className="block text-[10px] text-gray-400 dark:text-gray-500">{t('deleteVideo.removeFromLibraryDesc')}</span>
          </button>
          <button
            type="button"
            disabled={loading}
            className="w-full px-3 py-2 text-sm bg-amber-500 hover:bg-amber-600 text-white rounded disabled:opacity-50"
            onClick={handleTrashFile}
          >
            {t('deleteVideo.moveToTrash')}
            <span className="block text-[10px] text-amber-100">{t('deleteVideo.moveToTrashDesc')}</span>
          </button>
          <button
            type="button"
            disabled={loading}
            className="w-full px-3 py-2 text-sm bg-red-600 hover:bg-red-700 text-white rounded disabled:opacity-50"
            onClick={handleDeleteFile}
          >
            {t('deleteVideo.deleteFile')}
            <span className="block text-[10px] text-red-200">{t('deleteVideo.deleteFileDesc')}</span>
          </button>
          <button
            type="button"
            disabled={loading}
            className="w-full px-3 py-1.5 text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
            onClick={onClose}
          >
            {t('deleteVideo.cancel')}
          </button>
        </div>
      </div>
    </div>
  );
}
