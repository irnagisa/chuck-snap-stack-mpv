import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLibraryStore } from '../../store/useLibraryStore';
import { Button } from "../ui";

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

  const displayRating = hovered > 0 ? hovered : (selectedRating === 'unset' ? 0 : selectedRating);

  const handleApply = async () => {
    if (selectedRating === 'unset') return;
    setLoading(true);
    try {
      for (const videoId of videoIds) {
        await updateVideo(videoId, { rating: selectedRating });
      }
      await fetchVideos();
      onDone();
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" role="dialog" aria-modal="true" onClick={onClose}>
      <div
        className="bg-white dark:bg-gray-800 rounded-lg shadow-xl p-5 w-72 max-w-[90vw]"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-1">
          {t('bulkRating.title')}
        </h2>
        <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">
          {t('bulkRating.desc', { count: videoIds.length })}
        </p>

        <div className="flex gap-1 mb-2 justify-center">
          {[1, 2, 3, 4, 5].map((star) => (
            <button
              key={star}
              type="button"
              className={`text-3xl leading-none transition-colors ${
                star <= displayRating
                  ? 'text-yellow-400'
                  : 'text-gray-300 dark:text-gray-600 hover:text-yellow-300'
              }`}
              onMouseEnter={() => setHovered(star)}
              onMouseLeave={() => setHovered(0)}
              onClick={() => setSelectedRating(star === selectedRating ? 'unset' : star)}
            >
              ★
            </button>
          ))}
        </div>

        <p className="text-xs text-center text-gray-400 dark:text-gray-500 mb-4">
          {selectedRating === 'unset'
            ? t('bulkRating.noSelection')
            : t('bulkRating.selected', { count: selectedRating })}
        </p>

        <div className="flex gap-2">
          <Button
            variant="primary"
            size="md"
            className="flex-1"
            disabled={loading || selectedRating === 'unset'}
            onClick={handleApply}
          >
            {loading ? t('bulkRating.applying') : t('bulkRating.apply')}
          </Button>
          <Button
            variant="secondary"
            size="md"
            disabled={loading}
            onClick={onClose}
          >
            {t('bulkRating.cancel')}
          </Button>
        </div>
      </div>
    </div>
  );
}
