import { useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useTranslation } from "react-i18next";
import { useLibraryStore } from '../../store/useLibraryStore';
import { toast } from '../../store/useToastStore';
import { X } from "lucide-react";
import { Button, Input } from "../ui";

interface Props {
  onClose: () => void;
}

export function SmartPlaylistModal({ onClose }: Props) {
  const { t } = useTranslation();
  const {
    filterSearch, filterCategoryId, filterTagIds, filterMinRating, filterRatingMode,
    filterHasAudio, filterMinDuration, filterMaxDuration, filterWatchedStatus, filterSortBy, filterSortOrder,
  } = useLibraryStore();

  const [name, setName] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const handleSave = async () => {
    if (!name.trim()) return;
    setIsSaving(true);
    try {
      const filterState = {
        filterSearch, filterCategoryId, filterTagIds, filterMinRating, filterRatingMode,
        filterHasAudio, filterMinDuration, filterMaxDuration, filterWatchedStatus, filterSortBy, filterSortOrder,
      };
      await invoke('db_create_smart_playlist', {
        name: name.trim(),
        filterJson: JSON.stringify(filterState),
      });
      setSaved(true);
    } catch (e) {
      toast.error(`スマートプレイリストの保存に失敗しました: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setIsSaving(false);
    }
  };

  const filterSummary: string[] = [];
  if (filterSearch) filterSummary.push(t('smartPlaylist.filterSearch', { query: filterSearch }));
  if (filterCategoryId !== null) filterSummary.push(t('smartPlaylist.filterCategory'));
  if (filterTagIds.length > 0) filterSummary.push(t('smartPlaylist.filterTags', { count: filterTagIds.length }));
  if (filterMinRating > 0) {
    const ratingKey = filterRatingMode === 'lte'
      ? 'smartPlaylist.filterRatingLte'
      : filterRatingMode === 'eq'
        ? 'smartPlaylist.filterRatingEq'
        : 'smartPlaylist.filterRating';
    filterSummary.push(t(ratingKey, { rating: filterMinRating }));
  }
  if (filterHasAudio !== null) filterSummary.push(filterHasAudio ? t('smartPlaylist.filterAudioYes') : t('smartPlaylist.filterAudioNo'));
  if (filterMinDuration > 0) filterSummary.push(t('smartPlaylist.filterMinDuration', { seconds: filterMinDuration }));
  if (filterMaxDuration > 0) filterSummary.push(t('smartPlaylist.filterMaxDuration', { seconds: filterMaxDuration }));
  if (filterWatchedStatus !== 'all') filterSummary.push(filterWatchedStatus === 'watched' ? t('smartPlaylist.filterWatched') : t('smartPlaylist.filterUnwatched'));

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div
        className="bg-white dark:bg-gray-900 rounded-xl shadow-xl w-full max-w-md mx-4 flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-200 dark:border-gray-700 shrink-0">
          <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">{t('smartPlaylist.title')}</h2>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="閉じる"
            onClick={onClose}
          >
            <X aria-hidden />
          </Button>
        </div>

        <div className="px-6 py-5 flex flex-col gap-4">
          {saved ? (
            <div className="flex flex-col gap-3 text-center">
              <p className="text-green-600 dark:text-green-400 text-sm">{t('smartPlaylist.saved')}</p>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                {t('smartPlaylist.savedDesc')}
              </p>
              <Button
                variant="primary"
                size="md"
                fullWidth
                onClick={onClose}
              >
                {t('smartPlaylist.close')}
              </Button>
            </div>
          ) : (
            <>
              <div>
                <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5">
                  {t('smartPlaylist.filterLabel')}
                </label>
                {filterSummary.length > 0 ? (
                  <ul className="text-xs text-gray-600 dark:text-gray-300 space-y-0.5 bg-gray-50 dark:bg-gray-800 rounded-lg px-3 py-2">
                    {filterSummary.map((s, i) => (
                      <li key={i}>• {s}</li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-xs text-gray-400 dark:text-gray-500 italic">
                    {t('smartPlaylist.noFilter')}
                  </p>
                )}
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5">
                  {t('smartPlaylist.nameLabel')}
                </label>
                <Input
                  size="md"
                  className="w-full"
                  placeholder={t('smartPlaylist.namePlaceholder')}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleSave(); }}
                  autoFocus
                />
              </div>

              <div className="flex gap-2">
                <Button
                  variant="secondary"
                  size="md"
                  className="flex-1"
                  onClick={onClose}
                >
                  {t('smartPlaylist.cancel')}
                </Button>
                <Button
                  variant="primary"
                  size="md"
                  className="flex-1"
                  onClick={handleSave}
                  disabled={!name.trim() || isSaving}
                >
                  {isSaving ? t('smartPlaylist.saving') : t('smartPlaylist.save')}
                </Button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
