import { useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import type { Video } from '../../types';
import { useLibraryStore } from '../../store/useLibraryStore';

interface Props {
  video: Video;
  onClose: () => void;
  onRemoved: () => void;
}

export function DeleteVideoModal({ video, onClose, onRemoved }: Props) {
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

  const handleDeleteFile = async () => {
    setLoading(true);
    try {
      await invoke('delete_video_file', { path: video.path });
      await removeVideo(video.id);
      onRemoved();
    } catch (e) {
      console.error('ファイル削除失敗:', e);
      // ファイル削除に失敗してもDBからは除外
      await removeVideo(video.id);
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
        <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-1">動画を削除</h2>
        <p className="text-xs text-gray-500 dark:text-gray-400 mb-4 break-all">{displayName}</p>
        <p className="text-xs text-gray-600 dark:text-gray-300 mb-4">
          どちらの方法で削除しますか？
        </p>

        <div className="flex flex-col gap-2">
          <button
            type="button"
            disabled={loading}
            className="w-full px-3 py-2 text-sm bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-800 dark:text-gray-200 rounded disabled:opacity-50"
            onClick={handleRemoveOnly}
          >
            ライブラリから除外
            <span className="block text-[10px] text-gray-400 dark:text-gray-500">ファイルは残します</span>
          </button>
          <button
            type="button"
            disabled={loading}
            className="w-full px-3 py-2 text-sm bg-red-600 hover:bg-red-700 text-white rounded disabled:opacity-50"
            onClick={handleDeleteFile}
          >
            ファイルも削除
            <span className="block text-[10px] text-red-200">ディスクからも完全に削除します</span>
          </button>
          <button
            type="button"
            disabled={loading}
            className="w-full px-3 py-1.5 text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
            onClick={onClose}
          >
            キャンセル
          </button>
        </div>
      </div>
    </div>
  );
}
