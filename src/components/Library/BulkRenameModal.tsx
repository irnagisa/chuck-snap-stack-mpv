import { useMemo, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useTranslation } from "react-i18next";
import { useLibraryStore } from '../../store/useLibraryStore';
import type { Video } from '../../types';
import { Button, Checkbox, Dialog, Input, SegmentedControl, Select, useDialogClose } from '../ui';
import modal from './LibraryModal.module.css';
import styles from './BulkRenameModal.module.css';

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
  // 結果が出たあとに閉じたら onDone (一覧の更新など) を呼ぶ
  const dialog = useDialogClose(results ? onDone : onClose, { locked: loading });

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
        failed.push(t('bulkRename.skippedDuplicate', { name: basename }));
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

  const changeCount = previews.filter(({ video, newName }) => getFileParts(video.path).basename !== newName).length;

  return (
    <Dialog
      {...dialog.props}
      size="lg"
      title={t('bulkRename.title', { count: videos.length })}
      showClose={false}
      footer={
        <>
          <p className={`${modal.note} ${modal.footerLead}`}>
            {unchangedCount > 0 && t('bulkRename.unchanged', { count: unchangedCount })}
            {hasConflict && <span className={styles.conflictNote}>{t('bulkRename.hasDuplicate')}</span>}
          </p>
          <Button variant="ghost" disabled={loading} onClick={() => dialog.close()}>
            {results ? t('bulkRename.close') : t('bulkRename.cancel')}
          </Button>
          {!results && (
            <Button variant="primary" disabled={loading || hasConflict || allUnchanged} onClick={handleApply}>
              {loading ? t('bulkRename.renaming') : t('bulkRename.rename', { count: changeCount })}
            </Button>
          )}
        </>
      }
    >
      <div className={styles.root}>
        <SegmentedControl<RenameMode>
          size="sm"
          aria-label={t('bulkRename.modeLabel')}
          value={mode}
          onValueChange={setMode}
          options={[
            { value: 'replace', label: t('bulkRename.modeReplace') },
            { value: 'prefix', label: t('bulkRename.modePrefix') },
            { value: 'suffix', label: t('bulkRename.modeSuffix') },
            { value: 'number', label: t('bulkRename.modeSequential') },
          ]}
        />

        {/* モードごとの設定 */}
        {mode === 'replace' && (
          <div className={styles.form}>
            <label className={styles.fieldLabel} htmlFor="rename-search">{t('bulkRename.searchLabel')}</label>
            <div className={modal.row}>
              <Input
                id="rename-search"
                size="sm"
                className={modal.grow}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t('bulkRename.searchPlaceholder')}
                autoFocus
              />
              <label className={styles.inlineCheck}>
                <Checkbox checked={useRegex} onCheckedChange={(v) => setUseRegex(v === true)} />
                {t('bulkRename.useRegex')}
              </label>
            </div>
            <label className={styles.fieldLabel} htmlFor="rename-replace">{t('bulkRename.replaceLabel')}</label>
            <Input
              id="rename-replace"
              size="sm"
              className={modal.fullWidth}
              value={replace}
              onChange={(e) => setReplace(e.target.value)}
              placeholder={t('bulkRename.replacePlaceholder')}
            />
          </div>
        )}
        {mode === 'prefix' && (
          <div className={styles.form}>
            <label className={styles.fieldLabel} htmlFor="rename-prefix">{t('bulkRename.prefixLabel')}</label>
            <Input
              id="rename-prefix"
              size="sm"
              className={modal.fullWidth}
              value={prefix}
              onChange={(e) => setPrefix(e.target.value)}
              placeholder={t('bulkRename.prefixPlaceholder')}
              autoFocus
            />
          </div>
        )}
        {mode === 'suffix' && (
          <div className={styles.form}>
            <label className={styles.fieldLabel} htmlFor="rename-suffix">{t('bulkRename.suffixLabel')}</label>
            <Input
              id="rename-suffix"
              size="sm"
              className={modal.fullWidth}
              value={suffix}
              onChange={(e) => setSuffix(e.target.value)}
              placeholder={t('bulkRename.suffixPlaceholder')}
              autoFocus
            />
          </div>
        )}
        {mode === 'number' && (
          <div className={styles.numberFields}>
            <label className={styles.inlineField}>
              {t('bulkRename.startNumLabel')}
              <Input
                size="sm"
                className={styles.w4}
                type="number"
                value={numStart}
                min={0}
                onChange={(e) => setNumStart(Number(e.target.value))}
              />
            </label>
            <label className={styles.inlineField}>
              {t('bulkRename.digitsLabel')}
              <Input
                size="sm"
                className={styles.w3}
                type="number"
                value={numDigits}
                min={1}
                max={8}
                onChange={(e) => setNumDigits(Number(e.target.value))}
              />
            </label>
            <label className={styles.inlineField}>
              {t('bulkRename.separatorLabel')}
              <Input size="sm" className={styles.w3} value={numSep} onChange={(e) => setNumSep(e.target.value)} />
            </label>
            <div className={styles.inlineField}>
              {t('bulkRename.positionLabel')}
              <Select<'prefix' | 'suffix'>
                value={numPosition}
                onValueChange={setNumPosition}
                aria-label={t('bulkRename.positionLabel')}
                options={[
                  { value: 'prefix', label: t('bulkRename.positionPrepend') },
                  { value: 'suffix', label: t('bulkRename.positionAppend') },
                ]}
              />
            </div>
          </div>
        )}

        {/* プレビュー */}
        <div className={styles.preview}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>{t('bulkRename.before')}</th>
                <th>{t('bulkRename.after')}</th>
              </tr>
            </thead>
            <tbody>
              {previews.map(({ video, newName }) => {
                const { basename } = getFileParts(video.path);
                const unchanged = basename === newName;
                const conflict = conflictNames.has(newName);
                return (
                  <tr
                    key={video.id}
                    data-unchanged={unchanged || undefined}
                    data-conflict={conflict || undefined}
                  >
                    <td>{basename}</td>
                    <td className={styles.after}>
                      {newName}
                      {conflict && <span className={styles.conflictNote}>{t('bulkRename.duplicate')}</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {results && (
          <div className={modal.callout} data-tone={results.failed.length > 0 ? 'warning' : 'success'}>
            <p className={styles.resultTitle}>
              {t('bulkRename.resultDone', { count: results.ok })}
              {results.failed.length > 0 && t('bulkRename.resultFailed', { count: results.failed.length })}
            </p>
            {results.failed.map((msg, i) => <p key={i} className={styles.resultLine}>{msg}</p>)}
          </div>
        )}
      </div>
    </Dialog>
  );
}
