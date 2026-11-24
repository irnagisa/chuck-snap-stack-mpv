import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { invoke } from '@tauri-apps/api/core';
import type { Video } from '../../types';
import { useLibraryStore } from '../../store/useLibraryStore';
import { toast } from '../../store/useToastStore';
import { Button, Dialog, useDialogClose } from "../ui";
import { DeleteChoices } from "./DeleteChoices";

interface Props {
  videos: Video[];
  onClose: () => void;
  onDone: () => void;
}

export function BulkDeleteModal({ videos, onClose, onDone }: Props) {
  const { t } = useTranslation();
  const { removeMultiple } = useLibraryStore();
  const [loading, setLoading] = useState(false);
  const dialog = useDialogClose(onClose);
  const count = videos.length;

  const handleRemoveOnly = async () => {
    setLoading(true);
    try {
      await removeMultiple(videos.map((v) => v.id));
      dialog.close(onDone);
    } finally {
      setLoading(false);
    }
  };

  const handleTrashFiles = async () => {
    setLoading(true);
    try {
      // 返り値 [path, success][] を確認し、成功したファイルの ID のみ DB から削除する
      const results = await invoke<[string, boolean][]>('trash_multiple_video_files', {
        paths: videos.map((v) => v.path),
      });
      const trashedPaths = new Set(results.filter(([, ok]) => ok).map(([p]) => p));
      const trashedIds = videos.filter((v) => trashedPaths.has(v.path)).map((v) => v.id);
      const failCount = results.filter(([, ok]) => !ok).length;
      if (trashedIds.length > 0) {
        await removeMultiple(trashedIds);
      }
      if (failCount > 0) {
        toast.error(`${failCount} 件のゴミ箱移動に失敗しました`);
      }
      dialog.close(onDone);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error(`ゴミ箱への移動に失敗しました: ${msg}`);
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteFiles = async () => {
    setLoading(true);
    try {
      // 返り値 [path, success][] を確認し、成功したファイルの ID のみ DB から削除する
      const results = await invoke<[string, boolean][]>('delete_multiple_video_files', {
        paths: videos.map((v) => v.path),
      });
      const deletedPaths = new Set(results.filter(([, ok]) => ok).map(([p]) => p));
      const deletedIds = videos.filter((v) => deletedPaths.has(v.path)).map((v) => v.id);
      const failCount = results.filter(([, ok]) => !ok).length;
      if (deletedIds.length > 0) {
        await removeMultiple(deletedIds);
      }
      if (failCount > 0) {
        toast.error(`${failCount} 件のファイル削除に失敗しました`);
      }
      dialog.close(onDone);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error(`ファイルの削除に失敗しました: ${msg}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog
      {...dialog.props}
      size="sm"
      title={t('bulkDelete.title', { count })}
      description={t('bulkDelete.question', { count })}
      showClose={false}
      footer={
        <Button variant="ghost" disabled={loading} onClick={() => dialog.close()}>
          {t('bulkDelete.cancel')}
        </Button>
      }
    >
      <DeleteChoices
        disabled={loading}
        removeOnly={{
          label: t('bulkDelete.removeFromLibrary'),
          description: t('bulkDelete.removeFromLibraryDesc'),
          onSelect: handleRemoveOnly,
        }}
        moveToTrash={{
          label: t('bulkDelete.moveToTrash'),
          description: t('bulkDelete.moveToTrashDesc'),
          onSelect: handleTrashFiles,
        }}
        deleteFile={{
          label: t('bulkDelete.deleteFile'),
          description: t('bulkDelete.deleteFileDesc'),
          onSelect: handleDeleteFiles,
        }}
      />
    </Dialog>
  );
}
