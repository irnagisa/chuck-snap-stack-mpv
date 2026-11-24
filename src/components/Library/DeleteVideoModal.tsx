import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { invoke } from '@tauri-apps/api/core';
import type { Video } from '../../types';
import { useLibraryStore } from '../../store/useLibraryStore';
import { toast } from '../../store/useToastStore';
import { Button, Dialog, useDialogClose } from "../ui";
import { DeleteChoices } from "./DeleteChoices";
import styles from "./LibraryModal.module.css";

interface Props {
  video: Video;
  onClose: () => void;
  onRemoved: () => void;
}

export function DeleteVideoModal({ video, onClose, onRemoved }: Props) {
  const { t } = useTranslation();
  const { removeVideo } = useLibraryStore();
  const [loading, setLoading] = useState(false);
  const dialog = useDialogClose(onClose);
  const displayName = video.title ?? video.path.split('/').pop();

  const handleRemoveOnly = async () => {
    setLoading(true);
    try {
      await removeVideo(video.id);
      dialog.close(onRemoved);
    } finally {
      setLoading(false);
    }
  };

  const handleTrashFile = async () => {
    setLoading(true);
    try {
      await invoke('trash_video_file', { path: video.path });
      await removeVideo(video.id);
      dialog.close(onRemoved);
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
      dialog.close(onRemoved);
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
    <Dialog
      {...dialog.props}
      size="sm"
      title={t('deleteVideo.title')}
      description={t('deleteVideo.question')}
      showClose={false}
      footer={
        <Button variant="ghost" disabled={loading} onClick={() => dialog.close()}>
          {t('deleteVideo.cancel')}
        </Button>
      }
    >
      <p className={styles.subject}>{displayName}</p>
      <DeleteChoices
        disabled={loading}
        removeOnly={{
          label: t('deleteVideo.removeFromLibrary'),
          description: t('deleteVideo.removeFromLibraryDesc'),
          onSelect: handleRemoveOnly,
        }}
        moveToTrash={{
          label: t('deleteVideo.moveToTrash'),
          description: t('deleteVideo.moveToTrashDesc'),
          onSelect: handleTrashFile,
        }}
        deleteFile={{
          label: t('deleteVideo.deleteFile'),
          description: t('deleteVideo.deleteFileDesc'),
          onSelect: handleDeleteFile,
        }}
      />
    </Dialog>
  );
}
