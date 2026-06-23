import { useMemo, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useTranslation } from "react-i18next";
import { useLibraryStore } from '../../store/useLibraryStore';
import type { Video } from '../../types';

type RenameMode = 'replace' | 'prefix' | 'suffix' | 'number';

interface Props {
  videos: Video[];
  onClose: () => void;
  onDone: () => void;
}

function getFileParts(filePath: string): { stem: string; ext: string; basename: string } {
  const basename = filePath.split('/').pop() ?? filePath;
  const dotIndex = basename.lastIndexOf('.');
  if (dotIndex <= 0) return { stem: basename, ext: '', basename };
  return {
    stem: basename.slice(0, dotIndex),
    ext: basename.slice(dotIndex),
    basename,
  };
}

function computeNewName(
  video: Video,
  index: number,
  mode: RenameMode,
  search: string,
  replace: string,
  useRegex: boolean,
  prefix: string,
  suffix: string,
  numStart: number,
  numDigits: number,
  numSep: string,
  numPosition: 'prefix' | 'suffix',
): string {
  const { stem, ext } = getFileParts(video.path);
  let newStem = stem;

  switch (mode) {
    case 'replace': {
      if (!search) return stem + ext;
      if (useRegex) {
        try {
          const re = new RegExp(search, 'g');
          newStem = stem.replace(re, replace);
        } catch {
          newStem = stem;
        }
      } else {
        newStem = stem.split(search).join(replace);
      }
      return newStem + ext;
    }
    case 'prefix':
      return prefix + stem + ext;
    case 'suffix':
      return stem + suffix + ext;
    case 'number': {
      const n = String(numStart + index).padStart(numDigits, '0');
      if (numPosition === 'prefix') return n + numSep + stem + ext;
      return stem + numSep + n + ext;
    }
  }
}

export function BulkRenameModal({ videos, onClose, onDone }: Props) {
  const { t } = useTranslation();
  const { renameVideoFile } = useLibraryStore();

  const [mode, setMode] = useState<RenameMode>('replace');
  const [search, setSearch] = useState('');
  const [replace, setReplace] = useState('');
  const [useRegex, setUseRegex] = useState(false);
  const [prefix, setPrefix] = useState('');
  const [suffix, setSuffix] = useState('');
  const [numStart, setNumStart] = useState(1);
  const [numDigits, setNumDigits] = useState(3);
  const [numSep, setNumSep] = useState('_');
  const [numPosition, setNumPosition] = useState<'prefix' | 'suffix'>('prefix');

  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<{ ok: number; failed: string[] } | null>(null);

  const previews = useMemo(() => {
    const names = new Map<string, number>();
    return videos.map((video, i) => {
      const newName = computeNewName(
        video, i, mode, search, replace, useRegex,
        prefix, suffix, numStart, numDigits, numSep, numPosition,
      );
      const count = (names.get(newName) ?? 0) + 1;
      names.set(newName, count);
      return { video, newName };
    });
  }, [videos, mode, search, replace, useRegex, prefix, suffix, numStart, numDigits, numSep, numPosition]);

  // 重複検出 (同じ新名前が2件以上)
  const conflictNames = useMemo(() => {
    const counts = new Map<string, number>();
    previews.forEach(({ newName }) => counts.set(newName, (counts.get(newName) ?? 0) + 1));
    return new Set([...counts.entries()].filter(([, c]) => c > 1).map(([n]) => n));
  }, [previews]);

  // 変更なしの件数
  const unchangedCount = useMemo(
    () => previews.filter(({ video, newName }) => {
      const { basename } = getFileParts(video.path);
      return basename === newName;
    }).length,
    [previews],
  );

  const hasConflict = conflictNames.size > 0;
  const allUnchanged = unchangedCount === videos.length;

  const handleApply = async () => {
    setLoading(true);
    setResults(null);
    let ok = 0;
    const failed: string[] = [];

    for (const { video, newName } of previews) {
      const { basename } = getFileParts(video.path);
      if (basename === newName) { ok++; continue; } // 変更なしはスキップ
      if (conflictNames.has(newName)) {
        failed.push(`${basename} → 重複のためスキップ`);
        continue;
      }
      const newPath = video.path.substring(0, video.path.lastIndexOf('/') + 1) + newName;
      // DB を先行更新してウォッチャーの Remove イベントとの競合を防ぐ
      await renameVideoFile(video.id, newPath);
      try {
        await invoke<string>('rename_video_file', { oldPath: video.path, newName });
        ok++;
      } catch (e) {
        // リネーム失敗時は DB を元のパスへ戻す
        await renameVideoFile(video.id, video.path);
        failed.push(`${basename}: ${String(e)}`);
      }
    }

    setLoading(false);
    setResults({ ok, failed });
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onClose}>
      <div
        className="bg-white dark:bg-gray-800 rounded-lg shadow-xl flex flex-col w-[680px] max-w-[95vw] max-h-[85vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* ヘッダー */}
        <div className="px-5 pt-5 pb-3 shrink-0">
          <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
            {t('bulkRename.title', { count: videos.length })}
          </h2>
        </div>

        {/* モード選択 */}
        <div className="px-5 pb-3 flex gap-1 shrink-0">
          {(['replace', 'prefix', 'suffix', 'number'] as const).map((m) => (
            <button
              key={m}
              type="button"
              className={`px-3 py-1 text-xs rounded border transition-colors ${
                mode === m
                  ? 'bg-blue-600 border-blue-600 text-white'
                  : 'border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-400 hover:border-blue-400'
              }`}
              onClick={() => setMode(m)}
            >
              {m === 'replace' ? t('bulkRename.modeReplace') : m === 'prefix' ? t('bulkRename.modePrefix') : m === 'suffix' ? t('bulkRename.modeSuffix') : t('bulkRename.modeSequential')}
            </button>
          ))}
        </div>

        {/* モード設定 */}
        <div className="px-5 pb-3 shrink-0">
          {mode === 'replace' && (
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <label className="text-xs text-gray-500 dark:text-gray-400 w-12 shrink-0">{t('bulkRename.searchLabel')}</label>
                <input
                  className="flex-1 border border-gray-300 dark:border-gray-600 px-2 py-1 rounded text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder={t('bulkRename.searchPlaceholder')}
                  autoFocus
                />
                <label className="flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400 shrink-0 cursor-pointer">
                  <input type="checkbox" checked={useRegex} onChange={(e) => setUseRegex(e.target.checked)} />
                  {t('bulkRename.useRegex')}
                </label>
              </div>
              <div className="flex items-center gap-2">
                <label className="text-xs text-gray-500 dark:text-gray-400 w-12 shrink-0">{t('bulkRename.replaceLabel')}</label>
                <input
                  className="flex-1 border border-gray-300 dark:border-gray-600 px-2 py-1 rounded text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                  value={replace}
                  onChange={(e) => setReplace(e.target.value)}
                  placeholder={t('bulkRename.replacePlaceholder')}
                />
              </div>
            </div>
          )}
          {mode === 'prefix' && (
            <div className="flex items-center gap-2">
              <label className="text-xs text-gray-500 dark:text-gray-400 w-20 shrink-0">{t('bulkRename.prefixLabel')}</label>
              <input
                className="flex-1 border border-gray-300 dark:border-gray-600 px-2 py-1 rounded text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                value={prefix}
                onChange={(e) => setPrefix(e.target.value)}
                placeholder={t('bulkRename.prefixPlaceholder')}
                autoFocus
              />
            </div>
          )}
          {mode === 'suffix' && (
            <div className="flex items-center gap-2">
              <label className="text-xs text-gray-500 dark:text-gray-400 w-20 shrink-0">{t('bulkRename.suffixLabel')}</label>
              <input
                className="flex-1 border border-gray-300 dark:border-gray-600 px-2 py-1 rounded text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                value={suffix}
                onChange={(e) => setSuffix(e.target.value)}
                placeholder={t('bulkRename.suffixPlaceholder')}
                autoFocus
              />
            </div>
          )}
          {mode === 'number' && (
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-1.5">
                <label className="text-xs text-gray-500 dark:text-gray-400">{t('bulkRename.startNumLabel')}</label>
                <input
                  type="number"
                  className="w-16 border border-gray-300 dark:border-gray-600 px-2 py-1 rounded text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                  value={numStart}
                  min={0}
                  onChange={(e) => setNumStart(Number(e.target.value))}
                />
              </div>
              <div className="flex items-center gap-1.5">
                <label className="text-xs text-gray-500 dark:text-gray-400">{t('bulkRename.digitsLabel')}</label>
                <input
                  type="number"
                  className="w-14 border border-gray-300 dark:border-gray-600 px-2 py-1 rounded text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                  value={numDigits}
                  min={1}
                  max={8}
                  onChange={(e) => setNumDigits(Number(e.target.value))}
                />
              </div>
              <div className="flex items-center gap-1.5">
                <label className="text-xs text-gray-500 dark:text-gray-400">{t('bulkRename.separatorLabel')}</label>
                <input
                  className="w-12 border border-gray-300 dark:border-gray-600 px-2 py-1 rounded text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                  value={numSep}
                  onChange={(e) => setNumSep(e.target.value)}
                />
              </div>
              <div className="flex items-center gap-1.5">
                <label className="text-xs text-gray-500 dark:text-gray-400">{t('bulkRename.positionLabel')}</label>
                <select
                  className="border border-gray-300 dark:border-gray-600 px-2 py-1 rounded text-xs bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                  value={numPosition}
                  onChange={(e) => setNumPosition(e.target.value as 'prefix' | 'suffix')}
                >
                  <option value="prefix">{t('bulkRename.positionPrepend')}</option>
                  <option value="suffix">{t('bulkRename.positionAppend')}</option>
                </select>
              </div>
            </div>
          )}
        </div>

        {/* プレビューテーブル */}
        <div className="flex-1 overflow-y-auto mx-5 mb-3 border border-gray-200 dark:border-gray-700 rounded text-xs min-h-0">
          <table className="w-full">
            <thead className="sticky top-0 bg-gray-50 dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700">
              <tr>
                <th className="text-left px-2 py-1.5 text-gray-500 dark:text-gray-400 font-medium">{t('bulkRename.before')}</th>
                <th className="text-left px-2 py-1.5 text-gray-500 dark:text-gray-400 font-medium">{t('bulkRename.after')}</th>
              </tr>
            </thead>
            <tbody>
              {previews.map(({ video, newName }) => {
                const { basename } = getFileParts(video.path);
                const unchanged = basename === newName;
                const conflict = conflictNames.has(newName);
                return (
                  <tr key={video.id} className={`border-b border-gray-100 dark:border-gray-700/50 last:border-0 ${unchanged ? 'opacity-40' : ''}`}>
                    <td className="px-2 py-1 text-gray-600 dark:text-gray-400 break-all">{basename}</td>
                    <td className={`px-2 py-1 break-all font-medium ${
                      conflict
                        ? 'text-red-600 dark:text-red-400'
                        : unchanged
                        ? 'text-gray-400 dark:text-gray-600'
                        : 'text-green-700 dark:text-green-400'
                    }`}>
                      {newName}
                      {conflict && <span className="ml-1 text-red-500 font-normal">{t('bulkRename.duplicate')}</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* 結果表示 */}
        {results && (
          <div className={`mx-5 mb-3 px-3 py-2 rounded text-xs shrink-0 ${
            results.failed.length > 0
              ? 'bg-yellow-50 dark:bg-yellow-950/30 text-yellow-700 dark:text-yellow-300'
              : 'bg-green-50 dark:bg-green-950/30 text-green-700 dark:text-green-400'
          }`}>
            <p className="font-medium">{results.ok} 件リネーム完了{results.failed.length > 0 && `、${results.failed.length} 件失敗`}</p>
            {results.failed.map((msg, i) => <p key={i} className="mt-0.5">{msg}</p>)}
          </div>
        )}

        {/* フッターボタン */}
        <div className="px-5 pb-5 flex items-center justify-between shrink-0">
          <p className="text-xs text-gray-400 dark:text-gray-500">
            {unchangedCount > 0 && t('bulkRename.unchanged', { count: unchangedCount })}
            {hasConflict && <span className="text-red-500 ml-2">{t('bulkRename.hasDuplicate')}</span>}
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              className="px-3 py-1.5 text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
              onClick={results ? onDone : onClose}
            >
              {results ? t('bulkRename.close') : t('bulkRename.cancel')}
            </button>
            {!results && (
              <button
                type="button"
                disabled={loading || hasConflict || allUnchanged}
                className="px-4 py-1.5 text-xs bg-blue-600 hover:bg-blue-700 text-white rounded disabled:opacity-50"
                onClick={handleApply}
              >
                {loading ? t('bulkRename.renaming') : t('bulkRename.rename', { count: previews.filter(({ video, newName }) => getFileParts(video.path).basename !== newName).length })}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
