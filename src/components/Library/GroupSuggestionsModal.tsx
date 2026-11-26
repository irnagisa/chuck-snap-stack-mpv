import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Layers, LoaderCircle } from 'lucide-react';
import type { MediaGroupSuggestion } from '../../types';
import { createGroup, getGroupSuggestions } from '../../lib/groups';
import { toast } from '../../store/useToastStore';
import { Button, Dialog, Input, useDialogClose } from '../ui';
import { ThumbImage } from './MediaThumb';
import styles from './LibraryModal.module.css';
import own from './GroupSuggestionsModal.module.css';

interface Props {
  onClose: () => void;
}

/** 一度に見せるサムネイルの数 */
const THUMBS = 5;

/**
 * ライブラリ全体から、ファイル名が似ている動画 (同じフォルダの別パターン・連番) をまとめる候補として出す。
 * 候補ごとに名前を直してまとめられる。
 */
export function GroupSuggestionsModal({ onClose }: Props) {
  const { t } = useTranslation();
  const [suggestions, setSuggestions] = useState<MediaGroupSuggestion[] | null>(null);
  const [names, setNames] = useState<Record<string, string>>({});
  const [done, setDone] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const dialog = useDialogClose(onClose, { locked: busy.size > 0 });

  useEffect(() => {
    getGroupSuggestions()
      .then((s) => {
        setSuggestions(s);
        setNames(Object.fromEntries(s.map((x) => [x.key, x.name])));
      })
      .catch((e) => {
        toast.error(String(e));
        setSuggestions([]);
      });
  }, []);

  const apply = async (list: MediaGroupSuggestion[]) => {
    const keys = list.map((s) => s.key);
    setBusy((b) => new Set([...b, ...keys]));
    let created = 0;
    for (const s of list) {
      try {
        await createGroup((names[s.key] ?? s.name).trim() || s.name, s.kind, s.videos.map((v) => v.id));
        created++;
        setDone((d) => new Set(d).add(s.key));
      } catch (e) {
        toast.error(String(e));
      }
    }
    setBusy((b) => {
      const next = new Set(b);
      keys.forEach((k) => next.delete(k));
      return next;
    });
    if (created > 0) toast.success(t('groups.suggestCreated', { count: created }));
  };

  const pending = (suggestions ?? []).filter((s) => !done.has(s.key));

  return (
    <Dialog
      {...dialog.props}
      size="lg"
      title={t('groups.suggestTitle')}
      description={t('groups.suggestDesc')}
      footer={
        <>
          <Button variant="secondary" disabled={busy.size > 0} onClick={() => dialog.close()}>
            {t('groups.close')}
          </Button>
          <Button variant="primary" disabled={busy.size > 0 || pending.length === 0} onClick={() => apply(pending)}>
            <Layers aria-hidden />
            {t('groups.suggestApplyAll', { count: pending.length })}
          </Button>
        </>
      }
    >
      {suggestions === null ? (
        <div className={styles.status}>
          <LoaderCircle className={styles.spinner} aria-hidden />
          {t('groups.suggestLoading')}
        </div>
      ) : suggestions.length === 0 ? (
        <p className={styles.emptyText}>{t('groups.suggestEmpty')}</p>
      ) : (
        <ul className={own.list}>
          {suggestions.map((s) => {
            const isDone = done.has(s.key);
            const isBusy = busy.has(s.key);
            const folder = s.videos[0]?.path.replace(/[/\\][^/\\]*$/, '') ?? '';
            return (
              <li key={s.key} className={own.item} data-done={isDone || undefined}>
                <div className={own.head}>
                  <Input
                    size="sm"
                    className={styles.grow}
                    value={names[s.key] ?? s.name}
                    disabled={isDone || isBusy}
                    aria-label={t('groups.name')}
                    onChange={(e) => setNames((n) => ({ ...n, [s.key]: e.target.value }))}
                  />
                  <span className={styles.badge}>
                    {s.kind === 'series' ? t('groups.kindSeries') : t('groups.kindVariants')}
                  </span>
                  <span className={styles.badge} data-tone="warning">
                    {t('groups.memberCount', { count: s.videos.length })}
                  </span>
                  {isDone ? (
                    <span className={own.doneMark}>
                      <Check aria-hidden />
                      {t('groups.suggestDone')}
                    </span>
                  ) : (
                    <Button variant="soft" size="sm" disabled={isBusy} onClick={() => apply([s])}>
                      {isBusy ? <LoaderCircle className={styles.spinner} aria-hidden /> : <Layers aria-hidden />}
                      {t('groups.create')}
                    </Button>
                  )}
                </div>
                <p className={styles.filePath} title={folder}>{folder}</p>
                <div className={own.thumbs}>
                  {s.videos.slice(0, THUMBS).map((v) => (
                    <span key={v.id} className={own.thumb} title={v.title ?? v.path}>
                      {v.thumbnail && <ThumbImage src={v.thumbnail} alt="" />}
                      <span className={own.thumbName}>{v.title ?? v.path.split(/[/\\]/).pop()}</span>
                    </span>
                  ))}
                  {s.videos.length > THUMBS && <span className={own.more}>+{s.videos.length - THUMBS}</span>}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Dialog>
  );
}
