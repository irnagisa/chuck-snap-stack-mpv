import { invoke } from '@tauri-apps/api/core';
import { convertFileSrc } from '@tauri-apps/api/core';
import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useLibraryStore } from '../../store/useLibraryStore';
import { toast } from '../../store/useToastStore';
import type { Video } from '../../types';

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

  // ── Shared action row ─────────────────────────────────────────────────────
  const GroupActions = ({
    isProcessing,
    onRemoveLib,
    onDeleteFiles,
  }: {
    isProcessing: boolean;
    onRemoveLib: () => void;
    onDeleteFiles: () => void;
  }) => (
    <div className="flex items-center gap-2 px-3 py-2 bg-gray-50 dark:bg-gray-900/50 border-t border-gray-200 dark:border-gray-700">
      <button
        type="button"
        disabled={isProcessing}
        className="px-3 py-1.5 text-xs bg-gray-200 hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 rounded disabled:opacity-50"
        onClick={onRemoveLib}
      >
        {t('duplicates.removeOthersFromLibrary')}
      </button>
      <button
        type="button"
        disabled={isProcessing}
        className="px-3 py-1.5 text-xs bg-red-600 hover:bg-red-700 text-white rounded disabled:opacity-50"
        onClick={onDeleteFiles}
      >
        {t('duplicates.deleteOthers')}
      </button>
      {isProcessing && (
        <span className="text-xs text-gray-400 dark:text-gray-500">{t('duplicates.processing')}</span>
      )}
    </div>
  );

  const activeExact = groups.filter((_, i) => !resolvedGroups.has(i));

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div
        className="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-[700px] max-w-[95vw] max-h-[85vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 dark:border-gray-700 shrink-0">
          <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
            {t('duplicates.title')}
          </h2>
          <button
            type="button"
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 text-base leading-none"
            onClick={onClose}
          >
            ✕
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 min-h-0">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-12 gap-2 text-sm text-gray-400 dark:text-gray-500">
              <div className="w-5 h-5 border-2 border-gray-300 dark:border-gray-600 border-t-blue-500 rounded-full animate-spin" />
              {t('duplicates.loading')}
            </div>
          ) : activeExact.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 gap-2">
              <span className="text-3xl">✓</span>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                {groups.length === 0 ? t('duplicates.empty') : t('duplicates.resolved')}
              </p>
            </div>
          ) : (
            <div className="flex flex-col gap-5">
              <p className="text-xs text-gray-500 dark:text-gray-400">
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
                  <div key={groupIdx} className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
                    <div className="px-3 py-2 bg-gray-50 dark:bg-gray-900/50 text-xs text-gray-500 dark:text-gray-400 flex items-center gap-2">
                      <span className="font-medium text-gray-700 dark:text-gray-300">
                        {t('duplicates.group')} {groupIdx + 1}
                      </span>
                      <span>·</span>
                      <span>{group.videos.length} {t('duplicates.countUnit')}</span>
                      <span>·</span>
                      <span>{fmtDuration(group.duration)}</span>
                      <span>·</span>
                      <span>{fmtSize(group.fileSize)}</span>
                    </div>
                    <div className="divide-y divide-gray-100 dark:divide-gray-700">
                      {group.videos.map((video) => (
                        <label
                          key={video.id}
                          className={`flex items-center gap-3 px-3 py-2 cursor-pointer transition-colors ${
                            keepId === video.id
                              ? 'bg-blue-50 dark:bg-blue-950/30'
                              : 'hover:bg-gray-50 dark:hover:bg-gray-700/30'
                          }`}
                        >
                          <input
                            type="radio"
                            name={`keep-${groupIdx}`}
                            checked={keepId === video.id}
                            onChange={() =>
                              setKeepIds((prev) => new Map(prev).set(groupIdx, video.id))
                            }
                            className="accent-blue-600 shrink-0"
                          />
                          {video.thumbnail ? (
                            <img
                              src={convertFileSrc(video.thumbnail)}
                              alt=""
                              className="w-14 h-9 object-cover rounded shrink-0 bg-gray-200 dark:bg-gray-700"
                            />
                          ) : (
                            <div className="w-14 h-9 rounded bg-gray-200 dark:bg-gray-700 shrink-0" />
                          )}
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-medium text-gray-900 dark:text-gray-100 truncate">
                              {video.title ?? video.path.split('/').pop()}
                            </p>
                            <p className="text-[10px] text-gray-400 dark:text-gray-500 truncate mt-0.5">
                              {video.path}
                            </p>
                          </div>
                          {keepId === video.id && (
                            <span className="text-[10px] text-blue-600 dark:text-blue-400 shrink-0 font-medium">
                              {t('duplicates.keep')}
                            </span>
                          )}
                        </label>
                      ))}
                    </div>
                    <GroupActions
                      isProcessing={isProcessing}
                      onRemoveLib={() => handleRemoveOthers(groupIdx, false)}
                      onDeleteFiles={() => handleRemoveOthers(groupIdx, true)}
                    />
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-gray-200 dark:border-gray-700 shrink-0 flex justify-end">
          <button
            type="button"
            className="px-4 py-1.5 text-xs bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 rounded"
            onClick={onClose}
          >
            {t('duplicates.close')}
          </button>
        </div>
      </div>
    </div>
  );
}
