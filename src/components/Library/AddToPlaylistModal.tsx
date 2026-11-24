import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Video } from '../../types';
import { usePlaylistStore } from '../../store/usePlaylistStore';
import { Check, Plus } from "lucide-react";
import { Button, Dialog, Input, useDialogClose } from "../ui";
import styles from "./LibraryModal.module.css";

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
  const dialog = useDialogClose(onClose);

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
    <Dialog
      {...dialog.props}
      size="sm"
      title={t('addToPlaylist.title')}
      description={title}
      closeLabel={t('confirm.close')}
      footer={
        <div className={styles.createRow}>
          <Input
            size="sm"
            className={styles.grow}
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleCreate(); }}
            placeholder={t('addToPlaylist.newPlaylistPlaceholder')}
          />
          <Button variant="secondary" size="sm" disabled={!newName.trim()} onClick={handleCreate}>
            {t('addToPlaylist.create')}
          </Button>
        </div>
      }
    >
      {playlists.length === 0 ? (
        <p className={styles.emptyText}>{t('addToPlaylist.empty')}</p>
      ) : (
        <ul className={styles.list}>
          {playlists.map((pl) => {
            const isAdded = added.has(pl.id);
            return (
              <li key={pl.id} className={styles.listItem}>
                <span className={styles.listName}>{pl.name}</span>
                <Button
                  variant={isAdded ? 'soft' : 'primary'}
                  size="xs"
                  disabled={adding === pl.id || isAdded}
                  onClick={() => handleAdd(pl.id)}
                >
                  {isAdded ? <Check aria-hidden /> : <Plus aria-hidden />}
                  {isAdded ? t('addToPlaylist.added') : adding === pl.id ? '...' : t('addToPlaylist.add')}
                </Button>
              </li>
            );
          })}
        </ul>
      )}
    </Dialog>
  );
}
