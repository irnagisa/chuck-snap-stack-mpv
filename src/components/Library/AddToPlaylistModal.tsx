import { useState } from 'react';
import type { Video } from '../../types';
import { usePlaylistStore } from '../../store/usePlaylistStore';

interface Props {
  video: Video;
  onClose: () => void;
}

export function AddToPlaylistModal({ video, onClose }: Props) {
  const { playlists, createPlaylist, addVideoToPlaylist } = usePlaylistStore();
  const [newName, setNewName] = useState('');
  const [adding, setAdding] = useState<number | null>(null);
  const [added, setAdded] = useState<Set<number>>(new Set());

  const title = video.title ?? video.path.split('/').pop() ?? video.path;

  const handleAdd = async (playlistId: number) => {
    setAdding(playlistId);
    await addVideoToPlaylist(playlistId, video.id);
    setAdded((prev) => new Set(prev).add(playlistId));
    setAdding(null);
  };

  const handleCreate = async () => {
    const name = newName.trim();
    if (!name) return;
    await createPlaylist(name);
    setNewName('');
  };

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-white dark:bg-gray-900 rounded-xl shadow-2xl w-80 max-h-[70vh] flex flex-col overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100 truncate">
            プレイリストに追加
          </h2>
          <button
            type="button"
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 text-lg leading-none ml-2"
            onClick={onClose}
          >
            ×
          </button>
        </div>

        <p className="px-4 pt-3 pb-1 text-xs text-gray-500 dark:text-gray-400 truncate">
          {title}
        </p>

        {/* プレイリスト一覧 */}
        <div className="flex-1 overflow-y-auto px-4 py-2 space-y-1">
          {playlists.length === 0 && (
            <p className="text-xs text-gray-400 dark:text-gray-500 py-2">
              プレイリストがありません
            </p>
          )}
          {playlists.map((pl) => {
            const isAdded = added.has(pl.id);
            return (
              <div
                key={pl.id}
                className="flex items-center justify-between gap-2 py-1.5"
              >
                <span className="text-sm text-gray-800 dark:text-gray-200 truncate flex-1">
                  {pl.name}
                </span>
                <button
                  type="button"
                  disabled={adding === pl.id || isAdded}
                  className={`px-2 py-0.5 rounded text-xs shrink-0 ${
                    isAdded
                      ? 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400 cursor-default'
                      : 'bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50'
                  }`}
                  onClick={() => handleAdd(pl.id)}
                >
                  {isAdded ? '追加済み' : adding === pl.id ? '...' : '追加'}
                </button>
              </div>
            );
          })}
        </div>

        {/* 新規作成 */}
        <div className="px-4 py-3 border-t border-gray-200 dark:border-gray-700 flex gap-2">
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleCreate(); }}
            placeholder="新しいプレイリスト名..."
            className="flex-1 min-w-0 text-sm border border-gray-300 dark:border-gray-600 rounded px-2 py-1 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500"
          />
          <button
            type="button"
            disabled={!newName.trim()}
            className="px-3 py-1 text-sm bg-gray-700 hover:bg-gray-600 dark:bg-gray-600 dark:hover:bg-gray-500 text-white rounded disabled:opacity-40 shrink-0"
            onClick={handleCreate}
          >
            作成
          </button>
        </div>
      </div>
    </div>
  );
}
