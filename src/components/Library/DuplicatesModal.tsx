import { invoke } from '@tauri-apps/api/core';
import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useLibraryStore } from '../../store/useLibraryStore';
import { toast } from '../../store/useToastStore';
import type { Video } from '../../types';
import { Check, LoaderCircle } from "lucide-react";
import { Button, Dialog, RadioGroup, RadioGroupItem, useDialogClose } from "../ui";
import { ThumbImage } from "./MediaThumb";
import styles from "./LibraryModal.module.css";

interface VideoWithSize extends Video {
  fileSize: number | null;
}

interface DuplicateGroup {
  videos: VideoWithSize[];
  duration: number;
  fileSize: number | null;
}

interface Props {
  onClose: () => void;
}

function fmtDuration(sec: number) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${m}:${String(s).padStart(2, '0')}`;
}

function fmtSize(bytes: number | null) {
  if (bytes == null) return '?';
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024).toFixed(0)} KB`;
}


export function DuplicatesModal({ onClose }: Props) {
  const { t } = useTranslation();
  const { fetchAllForShuffle, removeMultiple } = useLibraryStore();

  const [loading, setLoading] = useState(true);
  const [groups, setGroups] = useState<DuplicateGroup[]>([]);
  const [keepIds, setKeepIds] = useState<Map<number, number>>(new Map());
  const [processing, setProcessing] = useState<Set<number>>(new Set());
  const [resolvedGroups, setResolvedGroups] = useState<Set<number>>(new Set());
  const dialog = useDialogClose(onClose, { locked: processing.size > 0 });

  useEffect(() => {
    detectExact();
  }, []);

  // ── Exact detection ───────────────────────────────────────────────────────
  const detectExact = async () => {
    setLoading(true);
    try {
      const allVideos = await fetchAllForShuffle();
      const paths = allVideos.map((v) => v.path);
      const sizes: (number | null)[] = await invoke('get_file_sizes', { paths });

      const videosWithSizes: VideoWithSize[] = allVideos.map((v, i) => ({
        ...v,
        fileSize: sizes[i] ?? null,
      }));

      const groupMap = new Map<string, VideoWithSize[]>();
      for (const v of videosWithSizes) {
        if (v.duration == null || v.fileSize == null) continue;
        const key = `${Math.round(v.duration)}_${v.fileSize}`;
        if (!groupMap.has(key)) groupMap.set(key, []);
        groupMap.get(key)!.push(v);
      }

      const duplicateGroups: DuplicateGroup[] = [];
      for (const videos of groupMap.values()) {
        if (videos.length < 2) continue;
        videos.sort((a, b) => a.id - b.id);
        duplicateGroups.push({
          videos,
          duration: videos[0].duration!,
          fileSize: videos[0].fileSize,
        });
      }
      duplicateGroups.sort((a, b) => b.videos.length - a.videos.length);

      setGroups(duplicateGroups);
      const defaultKeep = new Map<number, number>();
      duplicateGroups.forEach((g, i) => {
        defaultKeep.set(i, g.videos[0].id);
      });
      setKeepIds(defaultKeep);
    } finally {
      setLoading(false);
    }
  };

  // ── Removal helpers ───────────────────────────────────────────────────────
  const doRemove = async (
    keepId: number,
    allVideos: { id: number; path: string }[],
    groupIndex: number,
    deleteFiles: boolean,
  ) => {
    const toRemove = allVideos.filter((v) => v.id !== keepId);
    setProcessing((prev) => new Set(prev).add(groupIndex));
    try {
      if (deleteFiles) {
        const results = await invoke<[string, boolean][]>('delete_multiple_video_files', {
          paths: toRemove.map((v) => v.path),
        });
        const deletedPaths = new Set(results.filter(([, ok]) => ok).map(([p]) => p));
        const deletedIds = toRemove.filter((v) => deletedPaths.has(v.path)).map((v) => v.id);
        const failCount = toRemove.length - deletedIds.length;
        if (deletedIds.length > 0) await removeMultiple(deletedIds);
        if (failCount > 0) toast.error(`${failCount} 件のファイル削除に失敗しました`);
      } else {
        await removeMultiple(toRemove.map((v) => v.id));
      }
      setResolvedGroups((prev) => new Set(prev).add(groupIndex));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error(`処理に失敗しました: ${msg}`);
    } finally {
      setProcessing((prev) => {
        const next = new Set(prev);
        next.delete(groupIndex);
        return next;
      });
    }
  };

  const handleRemoveOthers = (groupIndex: number, deleteFiles: boolean) => {
    const group = groups[groupIndex];
    const keepId = keepIds.get(groupIndex) ?? group.videos[0].id;
    doRemove(keepId, group.videos, groupIndex, deleteFiles);
  };

  const activeExact = groups.filter((_, i) => !resolvedGroups.has(i));

  return (
    <Dialog
      {...dialog.props}
      size="lg"
      title={t('duplicates.title')}
      closeLabel={t('confirm.close')}
      footer={
        <Button variant="secondary" onClick={() => dialog.close()}>
          {t('duplicates.close')}
        </Button>
      }
    >
      {loading ? (
        <div className={styles.status}>
          <LoaderCircle className={styles.spinner} aria-hidden />
          {t('duplicates.loading')}
        </div>
      ) : activeExact.length === 0 ? (
        <div className={styles.status}>
          <span className={styles.statusIcon}>
            <Check aria-hidden />
          </span>
          {groups.length === 0 ? t('duplicates.empty') : t('duplicates.resolved')}
        </div>
      ) : (
        <div className={styles.stack}>
          <p className={styles.muted}>
            {t('duplicates.found', {
              groups: activeExact.length,
              count: activeExact.reduce((s: number, g) => s + g.videos.length, 0),
            })}
          </p>
          {groups.map((group, groupIdx) => {
            if (resolvedGroups.has(groupIdx)) return null;
            const isProcessing = processing.has(groupIdx);
            const keepId = keepIds.get(groupIdx) ?? group.videos[0].id;
            return (
              <div key={groupIdx} className={styles.panel}>
                <div className={styles.panelHead}>
                  <span className={styles.strong}>
                    {t('duplicates.group')} {groupIdx + 1}
                  </span>
                  <span>·</span>
                  <span>{group.videos.length} {t('duplicates.countUnit')}</span>
                  <span>·</span>
                  <span>{fmtDuration(group.duration)}</span>
                  <span>·</span>
                  <span>{fmtSize(group.fileSize)}</span>
                </div>
                <RadioGroup
                  aria-label={t('duplicates.keep')}
                  value={String(keepId)}
                  onValueChange={(v) => setKeepIds((prev) => new Map(prev).set(groupIdx, Number(v)))}
                >
                  {group.videos.map((video) => (
                    <label
                      key={video.id}
                      className={styles.panelRow}
                      data-selected={keepId === video.id || undefined}
                    >
                      <RadioGroupItem value={String(video.id)} />
                      <span className={`${styles.miniThumb} ${styles.thumbBox}`}>
                        {video.thumbnail && <ThumbImage src={video.thumbnail} alt="" />}
                      </span>
                      <span className={styles.fileText}>
                        <span className={styles.fileName}>{video.title ?? video.path.split('/').pop()}</span>
                        <span className={styles.filePath}>{video.path}</span>
                      </span>
                      {keepId === video.id && <span className={styles.badge}>{t('duplicates.keep')}</span>}
                    </label>
                  ))}
                </RadioGroup>
                <div className={styles.panelFoot}>
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={isProcessing}
                    onClick={() => handleRemoveOthers(groupIdx, false)}
                  >
                    {t('duplicates.removeOthersFromLibrary')}
                  </Button>
                  <Button
                    variant="danger"
                    size="sm"
                    disabled={isProcessing}
                    onClick={() => handleRemoveOthers(groupIdx, true)}
                  >
                    {t('duplicates.deleteOthers')}
                  </Button>
                  {isProcessing && <span className={styles.note}>{t('duplicates.processing')}</span>}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Dialog>
  );
}
