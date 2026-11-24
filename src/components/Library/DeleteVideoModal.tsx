import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { invoke } from '@tauri-apps/api/core';
import type { Video } from '../../types';
import { useLibraryStore } from '../../store/useLibraryStore';
import { toast } from '../../store/useToastStore';
import { Button } from "../ui";

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
      const msg = e instanceof Error ? e.message : String(e);
      console.error('ゴミ箱移動失敗:', e);
      // ファイルがまだ存在するため DB エントリは保持し、エラーのみ表示する
      toast.error(`ゴミ箱への移動に失敗しました: ${msg}`);
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
      const msg = e instanceof Error ? e.message : String(e);
      console.error('ファイル削除失敗:', e);
      // ファイルがまだ存在するため DB エントリは保持し、エラーのみ表示する
      toast.error(`ファイルの削除に失敗しました: ${msg}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" role="dialog" aria-modal="true" onClick={onClose}>
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
          <Button
            variant="secondary"
            size="md"
            fullWidth
            disabled={loading}
            onClick={handleRemoveOnly}
          >
            {t('deleteVideo.removeFromLibrary')}
            <span className="block text-[10px] text-gray-400 dark:text-gray-500">{t('deleteVideo.removeFromLibraryDesc')}</span>
          </Button>
          <Button
            variant="primary"
            size="md"
            fullWidth
            disabled={loading}
            onClick={handleTrashFile}
          >
            {t('deleteVideo.moveToTrash')}
            <span className="block text-[10px] text-amber-100">{t('deleteVideo.moveToTrashDesc')}</span>
          </Button>
          <Button
            variant="danger"
            size="md"
            fullWidth
            disabled={loading}
            onClick={handleDeleteFile}
          >
            {t('deleteVideo.deleteFile')}
            <span className="block text-[10px] text-red-200">{t('deleteVideo.deleteFileDesc')}</span>
          </Button>
          <Button
            variant="ghost"
            size="sm"
            fullWidth
            disabled={loading}
            onClick={onClose}
          >
            {t('deleteVideo.cancel')}
          </Button>
        </div>
      </div>
    </div>
  );
}
