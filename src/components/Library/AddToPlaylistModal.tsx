import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Video } from '../../types';
import { usePlaylistStore } from '../../store/usePlaylistStore';
import { Check, Plus, X } from "lucide-react";
import { Button, Input } from "../ui";

interface Props {
  video: Video;
  onClose: () => void;
}

export function AddToPlaylistModal({ video, onClose }: Props) {
  const { t } = useTranslation();
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
      role="dialog"
      aria-modal="true"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-white dark:bg-gray-900 rounded-xl shadow-2xl w-80 max-h-[70vh] flex flex-col overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100 truncate">
            {t('addToPlaylist.title')}
          </h2>
          <Button
            variant="ghost"
            size="icon-sm"
            className="ml-2"
            aria-label="削除"
            onClick={onClose}
          >
            <X aria-hidden />
          </Button>
        </div>

        <p className="px-4 pt-3 pb-1 text-xs text-gray-500 dark:text-gray-400 truncate">
          {title}
        </p>

        {/* プレイリスト一覧 */}
        <div className="flex-1 overflow-y-auto px-4 py-2 space-y-1">
          {playlists.length === 0 && (
            <p className="text-xs text-gray-400 dark:text-gray-500 py-2">
              {t('addToPlaylist.empty')}
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
                <Button
                  variant={isAdded ? 'soft' : 'primary'}
                  size="xs"
                  disabled={adding === pl.id || isAdded}
                  onClick={() => handleAdd(pl.id)}
                >
                  {isAdded ? <Check aria-hidden /> : <Plus aria-hidden />}
                  {isAdded ? t('addToPlaylist.added') : adding === pl.id ? '...' : t('addToPlaylist.add')}
                </Button>
              </div>
            );
          })}
        </div>

        {/* 新規作成 */}
        <div className="px-4 py-3 border-t border-gray-200 dark:border-gray-700 flex gap-2">
          <Input
            size="sm"
            className="flex-1 min-w-0"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleCreate(); }}
            placeholder={t('addToPlaylist.newPlaylistPlaceholder')}
          />
          <Button
            variant="secondary"
            size="sm"
            disabled={!newName.trim()}
            onClick={handleCreate}
          >
            {t('addToPlaylist.create')}
          </Button>
        </div>
      </div>
    </div>
  );
}
