import { useState } from 'react';
import type { Playlist } from '../../types';
import { usePlaylistStore } from '../../store/usePlaylistStore';

interface Props {
  onOpenPlaylist: (playlist: Playlist) => void;
}

export function PlaylistSidebar({ onOpenPlaylist }: Props) {
  const { playlists, createPlaylist, deletePlaylist } = usePlaylistStore();
  const [isCreating, setIsCreating] = useState(false);
  const [newName, setNewName] = useState('');

  const handleCreate = async () => {
    const name = newName.trim();
    if (!name) return;
    await createPlaylist(name);
    setNewName('');
    setIsCreating(false);
  };

  return (
    <div className="w-44 shrink-0 flex flex-col gap-1">
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">
          プレイリスト
        </span>
        <button
          type="button"
          className="text-xs text-gray-400 hover:text-blue-500 dark:hover:text-blue-400 leading-none"
          title="プレイリストを作成"
          onClick={() => setIsCreating(true)}
        >
          +
        </button>
      </div>

      {isCreating && (
        <div className="flex gap-1 mb-1">
          <input
            autoFocus
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleCreate();
              if (e.key === 'Escape') { setIsCreating(false); setNewName(''); }
            }}
            placeholder="名前..."
            className="flex-1 min-w-0 text-xs border border-gray-300 dark:border-gray-600 rounded px-1.5 py-1 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder-gray-400"
          />
          <button
            type="button"
            className="text-xs px-1.5 py-1 bg-blue-600 text-white rounded hover:bg-blue-700 shrink-0"
            onClick={handleCreate}
          >
            ✓
          </button>
        </div>
      )}

      {playlists.length === 0 && !isCreating && (
        <p className="text-xs text-gray-400 dark:text-gray-500">
          プレイリストなし
        </p>
      )}

      {playlists.map((pl) => (
        <div key={pl.id} className="group flex items-center gap-1">
          <button
            type="button"
            className="flex-1 min-w-0 text-left text-sm px-2 py-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-700 dark:text-gray-300 truncate"
            onClick={() => onOpenPlaylist(pl)}
          >
            {pl.name}
          </button>
          <button
            type="button"
            className="opacity-0 group-hover:opacity-100 text-xs text-gray-400 hover:text-red-500 shrink-0 transition-opacity px-1"
            onClick={() => deletePlaylist(pl.id)}
            title="削除"
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
