import { useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useTranslation } from "react-i18next";
import { useLibraryStore } from '../../store/useLibraryStore';
import { toast } from '../../store/useToastStore';
import { Check } from "lucide-react";
import { Button, Dialog, Input, useDialogClose } from "../ui";
import styles from "./LibraryModal.module.css";

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
  const dialog = useDialogClose(onClose);

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
    <Dialog
      {...dialog.props}
      size="sm"
      title={t('smartPlaylist.title')}
      closeLabel={t('confirm.close')}
      footer={
        saved ? (
          <Button variant="primary" onClick={() => dialog.close()}>
            {t('smartPlaylist.close')}
          </Button>
        ) : (
          <>
            <Button variant="secondary" onClick={() => dialog.close()}>
              {t('smartPlaylist.cancel')}
            </Button>
            <Button variant="primary" onClick={handleSave} disabled={!name.trim() || isSaving}>
              {isSaving ? t('smartPlaylist.saving') : t('smartPlaylist.save')}
            </Button>
          </>
        )
      }
    >
      {saved ? (
        <div className={styles.status}>
          <span className={styles.statusIcon}>
            <Check aria-hidden />
          </span>
          <span className={styles.strong}>{t('smartPlaylist.saved')}</span>
          <p className={styles.muted}>{t('smartPlaylist.savedDesc')}</p>
        </div>
      ) : (
        <div className={styles.stack}>
          <div>
            <p className={styles.label}>{t('smartPlaylist.filterLabel')}</p>
            {filterSummary.length > 0 ? (
              <ul className={styles.infoBox}>
                {filterSummary.map((s, i) => (
                  <li key={i}>• {s}</li>
                ))}
              </ul>
            ) : (
              <p className={styles.note}>{t('smartPlaylist.noFilter')}</p>
            )}
          </div>

          <div>
            <label className={styles.label} htmlFor="smart-playlist-name">
              {t('smartPlaylist.nameLabel')}
            </label>
            <Input
              id="smart-playlist-name"
              size="md"
              className={styles.fullWidth}
              placeholder={t('smartPlaylist.namePlaceholder')}
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleSave(); }}
              autoFocus
            />
          </div>
        </div>
      )}
    </Dialog>
  );
}
