import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, ChevronUp, Crown, Film, Layers, ListVideo, LoaderCircle, Plus, Unlink, X } from 'lucide-react';
import type { MediaGroupCandidate, MediaGroupDetail, MediaGroupKind, MediaGroupSummary, Video } from '../../types';
import { useModalStore } from '../../store/useModalStore';
import { usePlayerStore } from '../../store/usePlayerStore';
import { toast } from '../../store/useToastStore';
import {
  addToGroup,
  createGroup,
  deleteGroup,
  getGroupCandidates,
  getGroupForVideo,
  listGroups,
  removeFromGroup,
  reorderGroup,
  setGroupCover,
  updateGroup,
} from '../../lib/groups';
import { formatTime } from '../../utils/time';
import { Button, Input, Popover, SegmentedControl } from '../ui';
import { ThumbImage } from './MediaThumb';
import detailStyles from './VideoDetailModal.module.css';
import styles from './GroupSection.module.css';

interface Props {
  video: Video;
}

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));
const nameOf = (v: Video) => v.title ?? v.path.split(/[/\\]/).pop() ?? '';

/** 詳細パネルの「グループ」欄: 入っているグループの中身と、一緒にまとめられそうな動画 */
export function GroupSection({ video }: Props) {
  const { t } = useTranslation();
  const openDetailVideo = useModalStore((s) => s.openDetailVideo);
  const playWithQueue = usePlayerStore((s) => s.playWithQueue);

  const [group, setGroup] = useState<MediaGroupDetail | null>(null);
  const [candidates, setCandidates] = useState<MediaGroupCandidate[]>([]);
  const [suggestedName, setSuggestedName] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [nameDraft, setNameDraft] = useState('');

  const reload = useCallback(async () => {
    const [g, c] = await Promise.all([getGroupForVideo(video.id), getGroupCandidates(video.id)]);
    setGroup(g);
    setNameDraft(g?.name ?? '');
    setCandidates(c.candidates);
    setSuggestedName(c.suggestedName || nameOf(video));
    setLoaded(true);
  }, [video]);

  useEffect(() => {
    let cancelled = false;
    setLoaded(false);
    reload().catch((e) => {
      if (!cancelled) toast.error(t('groups.loadFailed', { error: errorText(e) }));
    });
    return () => {
      cancelled = true;
    };
  }, [reload, t]);

  /** 変更を送って読み直す。失敗したらトーストで知らせる */
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
      await reload();
    } catch (e) {
      toast.error(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const commitName = () => {
    const name = nameDraft.trim();
    if (!group || !name || name === group.name) {
      setNameDraft(group?.name ?? '');
      return;
    }
    run(() => updateGroup(group.id, { name }));
  };

  const move = (index: number, delta: -1 | 1) => {
    if (!group) return;
    const ids = group.members.map((m) => m.id);
    const to = index + delta;
    if (to < 0 || to >= ids.length) return;
    [ids[index], ids[to]] = [ids[to], ids[index]];
    run(() => reorderGroup(group.id, ids));
  };

  const addCandidates = (list: MediaGroupCandidate[]) => {
    if (list.length === 0) return;
    const ids = list.map((c) => c.video.id);
    if (group) {
      run(() => addToGroup(group.id, ids));
    } else {
      // 別パターンが 1 つでもあれば別パターン、シリーズの回だけならシリーズとしてまとめる
      const kind: MediaGroupKind = list.some((c) => c.kind === 'variants') ? 'variants' : 'series';
      run(() => createGroup(suggestedName, kind, [video.id, ...ids]));
    }
  };

  const playable = useMemo(
    () => group?.members.filter((m) => m.media_type !== 'image' && m.media_type !== 'link') ?? [],
    [group],
  );
  const coverId = group ? (group.coverVideoId ?? group.members[0]?.id ?? null) : null;

  return (
    <section className={detailStyles.section}>
      <div className={detailStyles.sectionHead}>
        <h3 className={detailStyles.sectionTitle}>
          <span className={styles.titleRow}>
            <Layers aria-hidden />
            {t('groups.section')}
          </span>
        </h3>
        {group && (
          <SegmentedControl<MediaGroupKind>
            size="xs"
            aria-label={t('groups.kind')}
            value={group.kind}
            onValueChange={(kind) => run(() => updateGroup(group.id, { kind }))}
            options={[
              { value: 'variants', label: t('groups.kindVariants'), title: t('groups.kindVariantsNote') },
              { value: 'series', label: t('groups.kindSeries'), title: t('groups.kindSeriesNote') },
            ]}
          />
        )}
      </div>

      {!loaded ? (
        <div className={detailStyles.placeholder}>
          <LoaderCircle className={detailStyles.spinner} aria-hidden />
        </div>
      ) : group ? (
        <div className={styles.stack}>
          <Input
            size="sm"
            value={nameDraft}
            aria-label={t('groups.name')}
            onChange={(e) => setNameDraft(e.target.value)}
            onBlur={commitName}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur();
              if (e.key === 'Escape') setNameDraft(group.name);
            }}
          />

          <ol className={styles.members} aria-busy={busy || undefined}>
            {group.members.map((m, i) => {
              const isCurrent = m.id === video.id;
              const isCover = m.id === coverId;
              return (
                <li key={m.id} className={styles.member} data-current={isCurrent || undefined}>
                  <span className={styles.index}>{i + 1}</span>
                  <button
                    type="button"
                    className={styles.memberMain}
                    onClick={() => !isCurrent && openDetailVideo(m)}
                    aria-current={isCurrent || undefined}
                    title={m.path}
                  >
                    <span className={detailStyles.similarThumb}>
                      {m.thumbnail ? <ThumbImage src={m.thumbnail} alt="" /> : <Film aria-hidden />}
                    </span>
                    <span className={detailStyles.similarText}>
                      <span className={detailStyles.ellipsis}>{nameOf(m)}</span>
                      <span className={detailStyles.subtle}>
                        {isCover && <span className={styles.coverMark}>{t('groups.cover')}</span>}
                        {m.duration != null && m.duration > 0 && formatTime(m.duration)}
                      </span>
                    </span>
                  </button>
                  <span className={styles.memberActions}>
                    {!isCover && (
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        disabled={busy}
                        title={t('groups.setCover')}
                        aria-label={t('groups.setCover')}
                        onClick={() => run(() => setGroupCover(group.id, m.id))}
                      >
                        <Crown aria-hidden />
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      disabled={busy || i === 0}
                      aria-label={t('groups.moveUp')}
                      onClick={() => move(i, -1)}
                    >
                      <ChevronUp aria-hidden />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      disabled={busy || i === group.members.length - 1}
                      aria-label={t('groups.moveDown')}
                      onClick={() => move(i, 1)}
                    >
                      <ChevronDown aria-hidden />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      disabled={busy}
                      title={t('groups.removeMember')}
                      aria-label={t('groups.removeMember')}
                      onClick={() => run(() => removeFromGroup([m.id]))}
                    >
                      <X aria-hidden />
                    </Button>
                  </span>
                </li>
              );
            })}
          </ol>

          <div className={styles.actions}>
            {playable.length > 0 && (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  const start = Math.max(0, playable.findIndex((m) => m.id === video.id));
                  playWithQueue(playable, start);
                }}
              >
                <ListVideo aria-hidden />
                {t('groups.playInOrder')}
              </Button>
            )}
            <Button variant="ghost" size="sm" disabled={busy} onClick={() => run(() => deleteGroup(group.id))}>
              <Unlink aria-hidden />
              {t('groups.dissolve')}
            </Button>
          </div>
        </div>
      ) : (
        <div className={styles.stack}>
          <p className={detailStyles.muted}>{t('groups.notGrouped')}</p>
          <div className={styles.actions}>
            <Button
              variant="secondary"
              size="sm"
              disabled={busy}
              onClick={() => run(() => createGroup(suggestedName, 'variants', [video.id]))}
            >
              <Plus aria-hidden />
              {t('groups.createWithThis')}
            </Button>
            <ExistingGroupPicker disabled={busy} onPick={(g) => run(() => addToGroup(g.id, [video.id]))} />
          </div>
        </div>
      )}

      {loaded && candidates.length > 0 && (
        <div className={styles.candidates}>
          <div className={styles.candidatesHead}>
            <span className={detailStyles.label}>{t('groups.candidates')}</span>
            {candidates.length > 1 && (
              <Button variant="soft" size="xs" disabled={busy} onClick={() => addCandidates(candidates)}>
                <Plus aria-hidden />
                {group ? t('groups.addAll') : t('groups.groupAll')}
              </Button>
            )}
          </div>
          <ul className={styles.members}>
            {candidates.map((c) => (
              <li key={c.video.id} className={styles.member}>
                <button
                  type="button"
                  className={styles.memberMain}
                  onClick={() => openDetailVideo(c.video)}
                  title={c.video.path}
                >
                  <span className={detailStyles.similarThumb}>
                    {c.video.thumbnail ? <ThumbImage src={c.video.thumbnail} alt="" /> : <Film aria-hidden />}
                  </span>
                  <span className={detailStyles.similarText}>
                    <span className={detailStyles.ellipsis}>{nameOf(c.video)}</span>
                    <span className={detailStyles.subtle}>
                      {c.kind === 'series' ? t('groups.kindSeries') : t('groups.kindVariants')}
                      {c.groupId != null && ` · ${t('groups.inOtherGroup')}`}
                    </span>
                  </span>
                </button>
                <span className={styles.memberActions} data-visible>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    disabled={busy}
                    title={group ? t('groups.addToThisGroup') : t('groups.groupWithThis')}
                    aria-label={group ? t('groups.addToThisGroup') : t('groups.groupWithThis')}
                    onClick={() => addCandidates([c])}
                  >
                    <Plus aria-hidden />
                  </Button>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

/** 既存のグループを選ぶポップオーバー */
function ExistingGroupPicker({ disabled, onPick }: { disabled: boolean; onPick: (g: MediaGroupSummary) => void }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [groups, setGroups] = useState<MediaGroupSummary[] | null>(null);
  const [query, setQuery] = useState('');

  useEffect(() => {
    if (!open) return;
    setQuery('');
    listGroups()
      .then(setGroups)
      .catch((e) => toast.error(errorText(e)));
  }, [open]);

  const shown = (groups ?? []).filter((g) => g.name.toLowerCase().includes(query.trim().toLowerCase()));

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <Button variant="ghost" size="sm" disabled={disabled}>
          <Layers aria-hidden />
          {t('groups.addToExisting')}
        </Button>
      </Popover.Trigger>
      <Popover.Content align="start" className={styles.picker}>
        <Input
          size="sm"
          value={query}
          placeholder={t('groups.searchPlaceholder')}
          aria-label={t('groups.searchPlaceholder')}
          onChange={(e) => setQuery(e.target.value)}
          autoFocus
        />
        {groups === null ? (
          <div className={detailStyles.placeholder}>
            <LoaderCircle className={detailStyles.spinner} aria-hidden />
          </div>
        ) : shown.length === 0 ? (
          <p className={detailStyles.muted}>{groups.length === 0 ? t('groups.noGroups') : t('groups.noMatch')}</p>
        ) : (
          <ul className={styles.pickerList}>
            {shown.map((g) => (
              <li key={g.id}>
                <button
                  type="button"
                  className={styles.memberMain}
                  onClick={() => {
                    setOpen(false);
                    onPick(g);
                  }}
                >
                  <span className={detailStyles.similarThumb}>
                    {g.thumbnail ? <ThumbImage src={g.thumbnail} alt="" /> : <Layers aria-hidden />}
                  </span>
                  <span className={detailStyles.similarText}>
                    <span className={detailStyles.ellipsis}>{g.name}</span>
                    <span className={detailStyles.subtle}>
                      {g.kind === 'series' ? t('groups.kindSeries') : t('groups.kindVariants')} ·{' '}
                      {t('groups.memberCount', { count: g.memberCount })}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Popover.Content>
    </Popover.Root>
  );
}
