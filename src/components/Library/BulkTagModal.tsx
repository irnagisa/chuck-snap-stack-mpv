import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from '../../store/useToastStore';
import { useTagStore } from '../../store/useTagStore';
import { Button, Checkbox, Dialog, useDialogClose } from "../ui";
import styles from "./LibraryModal.module.css";

interface Props {
  videoIds: number[];
  onClose: () => void;
  onDone: () => void;
}

export function BulkTagModal({ videoIds, onClose, onDone }: Props) {
  const { t } = useTranslation();
  const { tags, addTagToMultiple } = useTagStore();
  const [selectedTagIds, setSelectedTagIds] = useState<Set<number>>(new Set());
  const [loading, setLoading] = useState(false);
  const dialog = useDialogClose(onClose, { locked: loading });

  const toggleTag = (tagId: number) => {
    setSelectedTagIds((prev) => {
      const next = new Set(prev);
      if (next.has(tagId)) next.delete(tagId);
      else next.add(tagId);
      return next;
    });
  };

  const handleApply = async () => {
    if (selectedTagIds.size === 0) return;
    setLoading(true);
    try {
      for (const tagId of selectedTagIds) {
        await addTagToMultiple(videoIds, tagId);
      }
      dialog.close(onDone);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog
      {...dialog.props}
      size="sm"
      title={t('bulkTag.title')}
      description={t('bulkTag.desc', { count: videoIds.length })}
      showClose={false}
      footer={
        <>
          <Button variant="secondary" disabled={loading} onClick={() => dialog.close()}>
            {t('bulkTag.cancel')}
          </Button>
          <Button
            variant="primary"
            disabled={loading || selectedTagIds.size === 0}
            onClick={handleApply}
          >
            {loading ? t('bulkTag.applying') : t('bulkTag.apply', { count: selectedTagIds.size })}
          </Button>
        </>
      }
    >
      {tags.length === 0 ? (
        <p className={styles.note}>{t('bulkTag.noTags')}</p>
      ) : (
        <div className={styles.optionList}>
          {tags.map((tag) => (
            <label key={tag.id} className={styles.option}>
              <Checkbox
                checked={selectedTagIds.has(tag.id)}
                onCheckedChange={() => toggleTag(tag.id)}
              />
              <span className={styles.dot} style={{ backgroundColor: tag.color }} />
              <span className={styles.optionText}>{tag.name}</span>
            </label>
          ))}
        </div>
      )}
    </Dialog>
  );
}
