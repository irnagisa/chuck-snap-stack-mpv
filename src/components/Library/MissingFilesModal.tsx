import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useTranslation } from "react-i18next";
import { useLibraryStore } from '../../store/useLibraryStore';

interface Props {
  onClose: () => void;
}

interface MissingVideo {
  id: number;
  path: string;
  title: string | null;
  reason: 'missing' | 'empty';
}

export function MissingFilesModal({ onClose }: Props) {
  const { t } = useTranslation();
  const { fetchAllForShuffle, removeMultiple } = useLibraryStore();
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<MissingVideo[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [removing, setRemoving] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    detect();
  }, []);

  const detect = async () => {
    setLoading(true);
    setDone(false);
    try {
      const allVideos = await fetchAllForShuffle();
      const paths = allVideos.map((v) => v.path);
      const sizes: (number | null)[] = await invoke('get_file_sizes', { paths });

      const missing: MissingVideo[] = [];
      for (let i = 0; i < allVideos.length; i++) {
        const v = allVideos[i];
        const size = sizes[i];
        if (size === null) {
          missing.push({ id: v.id, path: v.path, title: v.title, reason: 'missing' });
        } else if (size === 0) {
          missing.push({ id: v.id, path: v.path, title: v.title, reason: 'empty' });
        }
      }
      setItems(missing);
      setSelected(new Set(missing.map((m) => m.id)));
    } finally {
      setLoading(false);
    }
  };

  const toggleAll = () => {
    if (selected.size === items.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(items.map((m) => m.id)));
    }
  };

  const toggleItem = (id: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleRemove = async () => {
    if (selected.size === 0) return;
    setRemoving(true);
    try {
      await removeMultiple(Array.from(selected));
      setItems((prev) => prev.filter((m) => !selected.has(m.id)));
      setSelected(new Set());
      setDone(true);
    } finally {
      setRemoving(false);
    }
  };

  const missingCount = items.filter((m) => m.reason === 'missing').length;
  const emptyCount = items.filter((m) => m.reason === 'empty').length;
  const selectedCount = selected.size;

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
        {/* ヘッダー */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 dark:border-gray-700 shrink-0">
          <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
            {t('missingFiles.title')}
          </h2>
          <button
            type="button"
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 text-base leading-none"
            onClick={onClose}
          >
            ✕
          </button>
        </div>

        {/* ボディ */}
        <div className="flex-1 overflow-y-auto p-5 min-h-0">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-12 gap-2 text-sm text-gray-400 dark:text-gray-500">
              <div className="w-5 h-5 border-2 border-gray-300 dark:border-gray-600 border-t-blue-500 rounded-full animate-spin" />
              {t('missingFiles.loading')}
            </div>
          ) : items.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 gap-2">
              <span className="text-3xl">{done ? '✓' : '✓'}</span>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                {done ? t('missingFiles.removed') : t('missingFiles.empty')}
              </p>
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              <div className="flex items-center justify-between">
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  {missingCount > 0 && (
                    <span className="mr-3">
                      <span className="font-medium text-red-600 dark:text-red-400">{t('missingFiles.missingCount', { count: missingCount })}</span>
                    </span>
                  )}
                  {emptyCount > 0 && (
                    <span>
                      <span className="font-medium text-orange-500 dark:text-orange-400">{t('missingFiles.emptyCount', { count: emptyCount })}</span>
                    </span>
                  )}
                </p>
                <button
                  type="button"
                  className="text-xs text-blue-500 dark:text-blue-400 hover:underline"
                  onClick={toggleAll}
                >
                  {selected.size === items.length ? t('missingFiles.deselectAll') : t('missingFiles.selectAll')}
                </button>
              </div>

              <div className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
                <div className="divide-y divide-gray-100 dark:divide-gray-700">
                  {items.map((item) => (
                    <label
                      key={item.id}
                      className={`flex items-start gap-3 px-3 py-2.5 cursor-pointer transition-colors ${
                        selected.has(item.id)
                          ? 'bg-red-50 dark:bg-red-950/30'
                          : 'hover:bg-gray-50 dark:hover:bg-gray-700/30'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={selected.has(item.id)}
                        onChange={() => toggleItem(item.id)}
                        className="mt-0.5 accent-red-600 shrink-0"
                      />
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium text-gray-900 dark:text-gray-100 truncate">
                          {item.title ?? item.path.split('/').pop()}
                        </p>
                        <p className="text-[10px] text-gray-400 dark:text-gray-500 truncate mt-0.5">
                          {item.path}
                        </p>
                      </div>
                      <span
                        className={`text-[10px] font-medium shrink-0 px-1.5 py-0.5 rounded ${
                          item.reason === 'missing'
                            ? 'bg-red-100 text-red-600 dark:bg-red-950/50 dark:text-red-400'
                            : 'bg-orange-100 text-orange-600 dark:bg-orange-950/50 dark:text-orange-400'
                        }`}
                      >
                        {item.reason === 'missing' ? t('missingFiles.badgeMissing') : t('missingFiles.badgeEmpty')}
                      </span>
                    </label>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* フッター */}
        <div className="px-5 py-3 border-t border-gray-200 dark:border-gray-700 shrink-0 flex items-center justify-between gap-2">
          <button
            type="button"
            className="text-xs text-gray-500 dark:text-gray-400 hover:text-blue-500 dark:hover:text-blue-400"
            onClick={detect}
            disabled={loading || removing}
          >
            {t('missingFiles.redetect')}
          </button>
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="px-4 py-1.5 text-xs bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 rounded"
              onClick={onClose}
            >
              {t('missingFiles.close')}
            </button>
            {items.length > 0 && (
              <button
                type="button"
                disabled={selected.size === 0 || removing}
                className="px-4 py-1.5 text-xs bg-red-600 hover:bg-red-700 text-white rounded disabled:opacity-50"
                onClick={handleRemove}
              >
                {removing ? t('duplicates.processing') : t('missingFiles.removeSelected', { count: selectedCount })}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
