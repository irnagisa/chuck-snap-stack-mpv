import { useState, useEffect } from 'react';
import { convertFileSrc } from '@tauri-apps/api/core';
import type { Playlist, Video } from '../../types';
import { usePlaylistStore } from '../../store/usePlaylistStore';
import { usePlayerStore } from '../../store/usePlayerStore';

interface Props {
  playlist: Playlist;
  onClose: () => void;
}

export function PlaylistModal({ playlist, onClose }: Props) {
  const { fetchPlaylistVideos, removeVideoFromPlaylist } = usePlaylistStore();
  const { playWithQueue } = usePlayerStore();
  const [videos, setVideos] = useState<Video[]>([]);
  const [loading, setLoading] = useState(true);

  const loadVideos = async () => {
    setLoading(true);
    const result = await fetchPlaylistVideos(playlist.id);
    setVideos(result);
    setLoading(false);
  };

  useEffect(() => {
    loadVideos();
  }, [playlist.id]);

  const handlePlayAll = async () => {
    if (videos.length === 0) return;
    await playWithQueue(videos, 0);
    onClose();
  };

  const handlePlayOne = async (_video: Video, index: number) => {
    await playWithQueue(videos, index);
    onClose();
  };

  const handleRemove = async (videoId: number) => {
    await removeVideoFromPlaylist(playlist.id, videoId);
    setVideos((prev) => prev.filter((v) => v.id !== videoId));
  };

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-white dark:bg-gray-900 rounded-xl shadow-2xl w-[480px] max-h-[80vh] flex flex-col overflow-hidden">
        {/* ヘッダー */}
        <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700 flex items-center gap-3">
          <h2 className="flex-1 text-sm font-semibold text-gray-900 dark:text-gray-100 truncate">
            {playlist.name}
          </h2>
          <button
            type="button"
            disabled={videos.length === 0}
            className="px-3 py-1 text-xs bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white rounded shrink-0"
            onClick={handlePlayAll}
          >
            ▶ すべて再生
          </button>
          <button
            type="button"
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 text-lg leading-none"
            onClick={onClose}
          >
            ×
          </button>
        </div>

        {/* 動画リスト */}
        <div className="flex-1 overflow-y-auto">
          {loading && (
            <p className="text-xs text-gray-400 dark:text-gray-500 p-4">読み込み中...</p>
          )}
          {!loading && videos.length === 0 && (
            <p className="text-xs text-gray-400 dark:text-gray-500 p-4">
              動画がありません。ライブラリから追加してください。
            </p>
          )}
          {!loading && videos.map((v, idx) => (
            <div
              key={v.id}
              className="flex items-center gap-3 px-4 py-2 hover:bg-gray-50 dark:hover:bg-gray-800 group"
            >
              {/* 番号 */}
              <span className="text-xs text-gray-400 dark:text-gray-500 w-5 text-right shrink-0">
                {idx + 1}
              </span>

              {/* サムネイル */}
              <div
                className="w-16 h-9 bg-gray-200 dark:bg-gray-700 rounded overflow-hidden shrink-0 cursor-pointer"
                onClick={() => handlePlayOne(v, idx)}
              >
                {v.thumbnail ? (
                  <img
                    src={convertFileSrc(v.thumbnail)}
                    alt={v.title ?? ''}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-gray-400 text-sm">▶</div>
                )}
              </div>

              {/* タイトル */}
              <span
                className="flex-1 text-sm text-gray-800 dark:text-gray-200 truncate cursor-pointer hover:text-blue-600 dark:hover:text-blue-400"
                onClick={() => handlePlayOne(v, idx)}
              >
                {v.title ?? v.path.split('/').pop()}
              </span>

              {/* 時間 */}
              {v.duration != null && (
                <span className="text-xs text-gray-400 dark:text-gray-500 shrink-0">
                  {Math.floor(v.duration / 60)}:{String(Math.floor(v.duration % 60)).padStart(2, '0')}
                </span>
              )}

              {/* 削除ボタン */}
              <button
                type="button"
                className="opacity-0 group-hover:opacity-100 text-xs text-red-500 hover:text-red-400 shrink-0 transition-opacity"
                onClick={() => handleRemove(v.id)}
                title="プレイリストから削除"
              >
                ×
              </button>
            </div>
          ))}
        </div>

        {!loading && (
          <div className="px-4 py-2 border-t border-gray-200 dark:border-gray-700 text-xs text-gray-400 dark:text-gray-500">
            {videos.length} 件
          </div>
        )}
      </div>
    </div>
  );
}
