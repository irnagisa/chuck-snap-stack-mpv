import { useState, useEffect, useMemo } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useTranslation } from "react-i18next";
import { useTranscodeStore } from '../../store/useTranscodeStore';
import { toast } from '../../store/useToastStore';
import type { Video } from '../../types';
import { formatFileSize, formatTime, parseTimecode } from '../../utils/time';
import { Button, Checkbox, Dialog, SegmentedControl, useDialogClose } from "../ui";
import { AudioPanel, Av1Panel, HevcPanel, RemuxPanel } from "./TranscodeModePanels";
import {
  DEFAULT_PRESET,
  HEVC_PERCENT_RANGE,
  MIN_SAVING_PERCENT,
  enqueueTranscode,
  outputPathFor,
  suggestCrf,
  type TranscodeEstimate,
  type TranscodeKind,
  type TranscodeMode,
} from "./transcodeJob";
import styles from "./LibraryModal.module.css";

const KINDS: TranscodeKind[] = ['av1', 'hevc', 'audio', 'remux'];

interface Props {
  video: Video;
  onClose: () => void;
}

/** 1 本の動画を変換して容量を減らす (AV1 / HEVC / 音声だけ / トラック整理・切り詰め) */
export function TranscodeModal({ video, onClose }: Props) {
  const { t } = useTranslation();
  const isBusy = useTranscodeStore((s) => s.current != null);
  const pendingCount = useTranscodeStore((s) => s.queue.length);
  const isQueued = useTranscodeStore((s) =>
    s.current?.videoPath === video.path || s.queue.some((j) => j.videoPath === video.path),
  );

  const [kind, setKind] = useState<TranscodeKind>('av1');
  const [inputSizeBytes, setInputSizeBytes] = useState<number | null>(null);
  const [estimate, setEstimate] = useState<TranscodeEstimate | null>(null);
  const [trashOriginal, setTrashOriginal] = useState(false);
  // AV1
  const [crf, setCrf] = useState<number>(32);
  const [preset, setPreset] = useState<number>(DEFAULT_PRESET);
  const [crfReasonKey, setCrfReasonKey] = useState<string>('');
  // HEVC
  const [hevcPercent, setHevcPercent] = useState<number>(HEVC_PERCENT_RANGE.default);
  // トラック整理
  const [kept, setKept] = useState<Set<number>>(new Set());
  const [startText, setStartText] = useState('');
  const [endText, setEndText] = useState('');
  const dialog = useDialogClose(onClose);

  const displayName = video.title ?? video.path.split('/').pop() ?? video.path;
  const previewOutput = outputPathFor(video.path, kind);

  useEffect(() => {
    invoke<number>('get_file_size', { path: video.path })
      .then((size) => {
        setInputSizeBytes(size);
        if (video.duration && video.duration > 0) {
          const suggestion = suggestCrf((size * 8) / 1000 / video.duration);
          setCrf(suggestion.crf);
          setCrfReasonKey(suggestion.reasonKey);
        }
      })
      .catch(() => {});
  }, [video.path, video.duration]);

  // 縮みそうか・トラックの一覧・HEVC が使えるかを調べる
  useEffect(() => {
    let cancelled = false;
    invoke<TranscodeEstimate>('estimate_transcode', { inputPath: video.path })
      .then((e) => {
        if (cancelled) return;
        setEstimate(e);
        setKept(new Set(e.streams.filter((s) => s.remuxable).map((s) => s.index)));
      })
      .catch((e: unknown) => console.warn('[transcode] 変換効果の見積もりに失敗:', e));
    return () => { cancelled = true; };
  }, [video.path]);

  const duration = estimate?.duration ?? video.duration ?? 0;

  /** トラック整理の指定と、その誤り */
  const remux = useMemo((): { mode: TranscodeMode | null; error: string | null } => {
    if (!estimate) return { mode: null, error: null };
    const start = parseTimecode(startText);
    const end = parseTimecode(endText);
    if (Number.isNaN(start) || Number.isNaN(end)) return { mode: null, error: t('transcode.trimInvalid') };
    const from = start ?? 0;
    const to = end ?? duration;
    if (to > duration + 0.5) return { mode: null, error: t('transcode.trimBeyond', { duration: formatTime(duration) }) };
    if (to - from < 1) return { mode: null, error: t('transcode.trimTooShort') };
    const remuxable = estimate.streams.filter((s) => s.remuxable);
    const trimmed = from > 0 || to < duration - 0.5;
    if (!trimmed && remuxable.every((s) => kept.has(s.index))) {
      return { mode: null, error: t('transcode.remuxNothing') };
    }
    return {
      mode: {
        kind: 'remux',
        streams: remuxable.filter((s) => kept.has(s.index)).map((s) => s.index),
        trimStart: start,
        trimEnd: end,
      },
      error: null,
    };
  }, [estimate, kept, startText, endText, duration, t]);

  const mode: TranscodeMode | null = (() => {
    switch (kind) {
      case 'av1':
        return estimate && !estimate.av1Encoder ? null : { kind, crf, preset };
      case 'hevc':
        return estimate?.hevcAvailable && estimate.videoBitrateKbps != null ? { kind, bitratePercent: hevcPercent } : null;
      case 'audio':
        return estimate?.audio.some((a) => a.opusKbps != null) ? { kind } : null;
      case 'remux':
        return remux.mode;
    }
  })();

  const handleStart = () => {
    if (!mode) return;
    const added = enqueueTranscode(
      {
        id: video.id,
        path: video.path,
        title: video.title,
        duration: video.duration,
        categoryId: video.category_id,
        rating: video.rating,
        createdAt: video.created_at,
      },
      mode,
      { trashOriginal },
    );
    if (!added) {
      toast.info(t('transcode.alreadyQueued'));
      return;
    }
    if (isBusy) toast.success(t('transcode.queued', { count: pendingCount + 1 }));
    dialog.close();
  };

  const toggleStream = (index: number, on: boolean) => {
    setKept((prev) => {
      const next = new Set(prev);
      if (on) next.add(index);
      else next.delete(index);
      return next;
    });
  };

  const discardNote =
    kind === 'av1' || kind === 'hevc'
      ? t('transcode.discardNote', { percent: estimate?.minSavingPercent ?? MIN_SAVING_PERCENT })
      : t('transcode.discardNoteSmall');

  return (
    <Dialog
      {...dialog.props}
      size="md"
      title={t('transcode.title')}
      closeLabel={t('confirm.close')}
      footer={
        <>
          <Button variant="ghost" onClick={() => dialog.close()}>
            {t('transcode.close')}
          </Button>
          {!isQueued && (
            <Button variant="primary" disabled={!mode} onClick={handleStart}>
              {isBusy ? t('transcode.addToQueue') : t('transcode.start')}
            </Button>
          )}
        </>
      }
    >
      {isQueued ? (
        <p className={styles.callout} data-tone="warning">{t('transcode.alreadyQueued')}</p>
      ) : (
        <div className={styles.stack}>
          <div className={styles.fileText}>
            <span className={styles.fileName}>{displayName}</span>
            <span className={styles.note}>{video.path}</span>
          </div>

          <SegmentedControl
            aria-label={t('transcode.modeLabel')}
            value={kind}
            onValueChange={setKind}
            options={KINDS.map((k) => ({ value: k, label: t(`transcode.mode_${k}`) }))}
          />

          <ul className={styles.infoBox}>
            <li><b>{t('transcode.encoder')}</b> {t(`transcode.encoder_${kind}`)}</li>
            <li>
              <b>{t('transcode.inputSize')}</b>{' '}
              {inputSizeBytes != null ? (
                <>
                  {formatFileSize(inputSizeBytes)}
                  {video.duration != null && video.duration > 0 && (
                    <span className={styles.labelHint}>
                      ({((inputSizeBytes * 8) / 1000 / video.duration).toFixed(0)} kbps)
                    </span>
                  )}
                </>
              ) : t('transcode.loadingSize')}
            </li>
            <li><b>{t('transcode.output')}</b> {previewOutput}</li>
          </ul>

          {kind === 'av1' && (
            <Av1Panel
              estimate={estimate}
              inputSizeBytes={video.duration ? inputSizeBytes : null}
              crf={crf}
              onCrfChange={(v) => { setCrf(v); setCrfReasonKey(''); }}
              crfReasonKey={crfReasonKey}
              preset={preset}
              onPresetChange={setPreset}
            />
          )}
          {kind === 'hevc' && <HevcPanel estimate={estimate} percent={hevcPercent} onPercentChange={setHevcPercent} />}
          {kind === 'audio' && <AudioPanel estimate={estimate} />}
          {kind === 'remux' && (
            <RemuxPanel
              estimate={estimate}
              kept={kept}
              onToggle={toggleStream}
              startText={startText}
              endText={endText}
              onStartChange={setStartText}
              onEndChange={setEndText}
              error={remux.error}
              durationLabel={formatTime(duration)}
            />
          )}

          <div className={styles.stackTight}>
            <label className={styles.option}>
              <Checkbox checked={trashOriginal} onCheckedChange={(v) => setTrashOriginal(v === true)} />
              <span className={styles.strong}>{t('transcode.trashOriginal')}</span>
            </label>
            {trashOriginal && (
              <p className={styles.callout} data-tone="warning">{t('transcode.trashOriginalNote')}</p>
            )}
          </div>

          <p className={styles.note}>{discardNote}</p>
          {kind === 'av1' && <p className={styles.note}>{t('transcode.timeEstimate')}</p>}

          {isBusy && (
            <p className={styles.callout}>{t('transcode.queueNote', { count: pendingCount + 1 })}</p>
          )}
        </div>
      )}
    </Dialog>
  );
}
