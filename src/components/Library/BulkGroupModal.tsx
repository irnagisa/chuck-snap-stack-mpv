import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { MediaGroupKind, MediaGroupSummary, Video } from '../../types';
import { addToGroup, commonNamePrefix, createGroup, listGroups } from '../../lib/groups';
import { toast } from '../../store/useToastStore';
import { Button, Dialog, Input, RadioGroup, RadioGroupItem, SegmentedControl, useDialogClose } from '../ui';
import { ThumbImage } from './MediaThumb';
import styles from './LibraryModal.module.css';

interface Props {
  videoIds: number[];
  /** 名前の案を作るため (いまのページで選んでいるもの) */
  videos: Video[];
  onClose: () => void;
  onDone: () => void;
}

type Mode = 'new' | 'existing';

/** 選んだ動画をグループにまとめる (新しく作る / 既存のグループに足す) */
export function BulkGroupModal({ videoIds, videos, onClose, onDone }: Props) {
  const { t } = useTranslation();
  const [mode, setMode] = useState<Mode>('new');
  const [name, setName] = useState(() =>
    commonNamePrefix(videos.map((v) => v.title ?? v.path.split(/[/\\]/).pop() ?? '')),
  );
  const [kind, setKind] = useState<MediaGroupKind>('variants');
  const [groups, setGroups] = useState<MediaGroupSummary[]>([]);
  const [groupId, setGroupId] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const dialog = useDialogClose(onClose, { locked: loading });

  useEffect(() => {
    listGroups()
      .then(setGroups)
      .catch((e) => toast.error(String(e)));
  }, []);

  const canApply = mode === 'new' ? name.trim().length > 0 : groupId !== '';

  const handleApply = async () => {
    if (!canApply) return;
    setLoading(true);
    try {
      if (mode === 'new') {
        await createGroup(name.trim(), kind, videoIds);
        toast.success(t('groups.created', { name: name.trim(), count: videoIds.length }));
      } else {
        await addToGroup(Number(groupId), videoIds);
        const g = groups.find((x) => String(x.id) === groupId);
        toast.success(t('groups.added', { name: g?.name ?? '', count: videoIds.length }));
      }
      dialog.close(onDone);
    } catch (e) {
      toast.error(String(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog
      {...dialog.props}
      size="sm"
      title={t('groups.bulkTitle')}
      description={t('groups.bulkDesc', { count: videoIds.length })}
      showClose={false}
      footer={
        <>
          <Button variant="secondary" disabled={loading} onClick={() => dialog.close()}>
            {t('groups.cancel')}
          </Button>
          <Button variant="primary" disabled={loading || !canApply} onClick={handleApply}>
            {mode === 'new' ? t('groups.create') : t('groups.add')}
          </Button>
        </>
      }
    >
      <div className={styles.stack}>
        <SegmentedControl<Mode>
          size="sm"
          fullWidth
          aria-label={t('groups.bulkTitle')}
          value={mode}
          onValueChange={setMode}
          options={[
            { value: 'new', label: t('groups.modeNew') },
            { value: 'existing', label: t('groups.modeExisting'), disabled: groups.length === 0 },
          ]}
        />

        {mode === 'new' ? (
          <>
            <div className={styles.stackTight}>
              <label className={styles.label} htmlFor="bulk-group-name">{t('groups.name')}</label>
              <Input
                id="bulk-group-name"
                size="md"
                className={styles.fullWidth}
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleApply(); }}
                autoFocus
              />
            </div>
            <div className={styles.stackTight}>
              <span className={styles.label}>{t('groups.kind')}</span>
              <SegmentedControl<MediaGroupKind>
                size="sm"
                fullWidth
                aria-label={t('groups.kind')}
                value={kind}
                onValueChange={setKind}
                options={[
                  { value: 'variants', label: t('groups.kindVariants') },
                  { value: 'series', label: t('groups.kindSeries') },
                ]}
              />
              <p className={styles.note}>
                {kind === 'series' ? t('groups.kindSeriesNote') : t('groups.kindVariantsNote')}
              </p>
            </div>
          </>
        ) : (
          <RadioGroup value={groupId} onValueChange={setGroupId} className={styles.optionList}>
            {groups.map((g) => (
              <label key={g.id} className={styles.option}>
                <RadioGroupItem value={String(g.id)} />
                <span className={`${styles.miniThumb} ${styles.thumbBox}`}>
                  {g.thumbnail && <ThumbImage src={g.thumbnail} alt="" />}
                </span>
                <span className={styles.optionText}>{g.name}</span>
                <span className={styles.badge}>{t('groups.memberCount', { count: g.memberCount })}</span>
              </label>
            ))}
          </RadioGroup>
        )}
      </div>
    </Dialog>
  );
}
