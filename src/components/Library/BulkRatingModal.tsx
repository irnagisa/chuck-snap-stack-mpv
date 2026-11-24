import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLibraryStore } from '../../store/useLibraryStore';
import { Star } from "lucide-react";
import { Button, Dialog, useDialogClose } from "../ui";
import styles from "./LibraryModal.module.css";

interface Props {
  videoIds: number[];
  onClose: () => void;
  onDone: () => void;
}

export function BulkRatingModal({ videoIds, onClose, onDone }: Props) {
  const { t } = useTranslation();
  const { updateVideo, fetchVideos } = useLibraryStore();
  const [selectedRating, setSelectedRating] = useState<number | 'unset'>('unset');
  const [hovered, setHovered] = useState<number>(0);
  const [loading, setLoading] = useState(false);
  const dialog = useDialogClose(onClose);

  const displayRating = hovered > 0 ? hovered : (selectedRating === 'unset' ? 0 : selectedRating);

  const handleApply = async () => {
    if (selectedRating === 'unset') return;
    setLoading(true);
    try {
      for (const videoId of videoIds) {
        await updateVideo(videoId, { rating: selectedRating });
      }
      await fetchVideos();
      dialog.close(onDone);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog
      {...dialog.props}
      size="sm"
      title={t('bulkRating.title')}
      description={t('bulkRating.desc', { count: videoIds.length })}
      showClose={false}
      footer={
        <>
          <Button variant="secondary" disabled={loading} onClick={() => dialog.close()}>
            {t('bulkRating.cancel')}
          </Button>
          <Button
            variant="primary"
            disabled={loading || selectedRating === 'unset'}
            onClick={handleApply}
          >
            {loading ? t('bulkRating.applying') : t('bulkRating.apply')}
          </Button>
        </>
      }
    >
      <div className={styles.stars} onMouseLeave={() => setHovered(0)}>
        {[1, 2, 3, 4, 5].map((star) => (
          <button
            key={star}
            type="button"
            className={styles.star}
            data-active={star <= displayRating || undefined}
            aria-label={`★${star}`}
            aria-pressed={star === selectedRating}
            onMouseEnter={() => setHovered(star)}
            onClick={() => setSelectedRating(star === selectedRating ? 'unset' : star)}
          >
            <Star aria-hidden fill="currentColor" />
          </button>
        ))}
      </div>
      <p className={styles.ratingNote}>
        {selectedRating === 'unset'
          ? t('bulkRating.noSelection')
          : t('bulkRating.selected', { count: selectedRating })}
      </p>
    </Dialog>
  );
}
