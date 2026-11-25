import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useTranslation } from "react-i18next";
import { useLibraryStore } from '../../store/useLibraryStore';
import { useTagStore } from '../../store/useTagStore';
import { useTranscodeStore } from '../../store/useTranscodeStore';
import { toast } from '../../store/useToastStore';
import type { Video } from '../../types';
import { Button, Checkbox, Dialog, Input, Slider, useDialogClose } from "../ui";
import styles from "./LibraryModal.module.css";

function formatSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function outputPathFor(inputPath: string): string {
  const lastDot = inputPath.lastIndexOf('.');
  const lastSlash = Math.max(inputPath.lastIndexOf('/'), inputPath.lastIndexOf('\\'));
  const stem = lastDot > lastSlash ? inputPath.slice(0, lastDot) : inputPath;
  return `${stem}.av1.mkv`;
}

/** ビットレート (Mbps) から推奨 CRF を返す */
function suggestCrf(bitrateKbps: number): { crf: number; reasonKey: string } {
  if (bitrateKbps > 20_000) return { crf: 28, reasonKey: 'transcode.crfHighBitrate' };
  if (bitrateKbps > 10_000) return { crf: 32, reasonKey: 'transcode.crfMedHighBitrate' };
  if (bitrateKbps > 5_000)  return { crf: 36, reasonKey: 'transcode.crfMedBitrate' };
  if (bitrateKbps > 2_000)  return { crf: 42, reasonKey: 'transcode.crfLowBitrate' };
  return { crf: 50, reasonKey: 'transcode.crfVeryLowBitrate' };
}

/** estimate_transcode の戻り値 (src-tauri/src/commands/transcode.rs の TranscodeEstimate) */
interface TranscodeEstimate {
  verdict: 'worth' | 'alreadyAv1' | 'lowBitrate' | 'unknown';
  videoCodec: string | null;
  width: number | null;
  height: number | null;
  fps: number | null;
  videoBitrateKbps: number | null;
  bitsPerPixel: number | null;
  minSavingPercent: number;
}

/** 変換後にこの割合以上小さくならなければ破棄する (バックエンドの値が取れるまでの表示用) */
const DEFAULT_MIN_SAVING_PERCENT = 15;

/** trash_transcode_source の戻り値 */
type SourceDisposal =
  | { method: 'trash' }
  | { method: 'quarantine'; location: string };

interface Props {
  video: Video;
  onClose: () => void;
}

export function TranscodeModal({ video, onClose }: Props) {
  const { t } = useTranslation();
  const { addVideoFromPath, updateVideo, fetchVideos, removeVideo } = useLibraryStore();
  const { addTagToVideo, setVideoCategory, videoTags } = useTagStore();
  const enqueue = useTranscodeStore((s) => s.enqueue);
  const isBusy = useTranscodeStore((s) => s.current != null);
  const pendingCount = useTranscodeStore((s) => s.queue.length);
  const isQueued = useTranscodeStore((s) =>
    s.current?.videoPath === video.path || s.queue.some((j) => j.videoPath === video.path),
  );

  const [inputSizeBytes, setInputSizeBytes] = useState<number | null>(null);
  const [crf, setCrf] = useState<number>(32);
  const [preset, setPreset] = useState<number>(8);
  const [crfReasonKey, setCrfReasonKey] = useState<string>('');
  const [trashOriginal, setTrashOriginal] = useState(false);
  const [estimate, setEstimate] = useState<TranscodeEstimate | null>(null);
  const dialog = useDialogClose(onClose);

  const PRESET_OPTIONS = [
    { value: 13, labelKey: 'transcode.preset13Label', descKey: 'transcode.preset13Desc' },
    { value: 8,  labelKey: 'transcode.preset8Label',  descKey: 'transcode.preset8Desc' },
    { value: 5,  labelKey: 'transcode.preset5Label',  descKey: 'transcode.preset5Desc' },
    { value: 3,  labelKey: 'transcode.preset3Label',  descKey: 'transcode.preset3Desc' },
  ] as const;

  const displayName = video.title ?? video.path.split('/').pop() ?? video.path;
  const previewOutput = outputPathFor(video.path);

  useEffect(() => {
    invoke<number>('get_file_size', { path: video.path })
      .then((size) => {
        setInputSizeBytes(size);
        if (video.duration && video.duration > 0) {
          const bitrateKbps = (size * 8) / 1000 / video.duration;
          const suggestion = suggestCrf(bitrateKbps);
          setCrf(suggestion.crf);
          setCrfReasonKey(suggestion.reasonKey);
        }
      })
      .catch(() => {});
  }, [video.path, video.duration]);

  // 変換で縮みそうかを見積もる (既に AV1・低ビットレートなら警告を出す)
  useEffect(() => {
    let cancelled = false;
    invoke<TranscodeEstimate>('estimate_transcode', { inputPath: video.path })
      .then((e) => { if (!cancelled) setEstimate(e); })
      .catch((e: unknown) => console.warn('[transcode] 変換効果の見積もりに失敗:', e));
    return () => { cancelled = true; };
  }, [video.path]);

  const minSavingPercent = estimate?.minSavingPercent ?? DEFAULT_MIN_SAVING_PERCENT;
  const estimateWarning =
    estimate?.verdict === 'alreadyAv1'
      ? t('transcode.estimateAlreadyAv1')
      : estimate?.verdict === 'lowBitrate'
        ? t('transcode.estimateLowBitrate', {
            codec: estimate.videoCodec?.toUpperCase() ?? '',
            kbps: estimate.videoBitrateKbps?.toFixed(0) ?? '?',
            resolution: estimate.width && estimate.height ? `${estimate.width}×${estimate.height}` : '',
          })
        : null;

  const handleStart = async () => {
    const stem = previewOutput.split('/').pop()?.replace(/\.av1\.mkv$/, '') ?? previewOutput;
    // onSuccess 実行時点での category_id・評価・タグ・追加日を確定しておく
    const originalCategoryId = video.category_id;
    const originalRating = video.rating;
    const originalCreatedAt = video.created_at;
    const originalTags = [...(videoTags[video.id] ?? [])];
    const originalId = video.id;
    const originalPath = video.path;
    const shouldTrashOriginal = trashOriginal;

    const added = enqueue({
      videoPath: video.path,
      videoName: displayName,
      durationSecs: video.duration ?? 0,
      crf,
      preset,
      onSuccess: async (outputPath) => {
        const newId = await addVideoFromPath(outputPath, stem);
        if (newId == null) {
          if (shouldTrashOriginal) toast.error(t('transcode.trashOriginalSkipped'));
          return;
        }
        // カテゴリをコピー
        if (originalCategoryId != null) {
          await setVideoCategory(newId, originalCategoryId);
        }
        // 評価・追加日をコピー
        await updateVideo(newId, {
          ...(originalRating > 0 ? { rating: originalRating } : {}),
          ...(originalCreatedAt ? { created_at: originalCreatedAt } : {}),
        });
        // タグをコピー
        for (const tag of originalTags) {
          await addTagToVideo(newId, tag.id);
        }
        await fetchVideos();
        // 元ファイルをゴミ箱へ移動 (メタデータのコピー完了後のみ)。
        // 変換結果の検証はバックエンドで行い、失敗時は元ファイルを残す。
        if (shouldTrashOriginal) {
          let disposal: SourceDisposal;
          try {
            disposal = await invoke<SourceDisposal>('trash_transcode_source', { inputPath: originalPath, outputPath });
          } catch (e) {
            console.error('[transcode] 元ファイルのゴミ箱移動を中止:', e);
            toast.error(t('transcode.trashOriginalFailed', { error: String(e) }));
            return;
          }
          try {
            await removeVideo(originalId);
          } catch (e) {
            console.error('[transcode] 元ファイルのライブラリ登録解除に失敗:', e);
          }
          if (disposal.method === 'quarantine') {
            // ゴミ箱が使えない外部ストレージ等: 退避先を長めに表示する
            toast.info(t('transcode.trashOriginalQuarantined', { location: disposal.location }), 15000);
          } else {
            toast.success(t('transcode.trashOriginalDone'));
          }
        }
      },
    });
    if (!added) {
      toast.info(t('transcode.alreadyQueued'));
      return;
    }
    if (isBusy) toast.success(t('transcode.queued', { count: pendingCount + 1 }));
    dialog.close();
  };

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
            <Button variant="primary" onClick={handleStart}>
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
          {/* ファイル情報 */}
          <div className={styles.fileText}>
            <span className={styles.fileName}>{displayName}</span>
            <span className={styles.note}>{video.path}</span>
          </div>

          {/* エンコード情報 */}
          <ul className={styles.infoBox}>
            <li><b>{t('transcode.encoder')}</b> {t('transcode.encoderValue')}</li>
            <li>
              <b>{t('transcode.inputSize')}</b>{' '}
              {inputSizeBytes != null ? (
                <>
                  {formatSize(inputSizeBytes)}
                  {video.duration && video.duration > 0 && (
                    <span className={styles.labelHint}>
                      ({((inputSizeBytes * 8) / 1000 / video.duration).toFixed(0)} kbps)
                    </span>
                  )}
                </>
              ) : t('transcode.loadingSize')}
            </li>
            <li><b>{t('transcode.output')}</b> {previewOutput}</li>
          </ul>

          {estimateWarning && (
            <p className={styles.callout} data-tone="warning">{estimateWarning}</p>
          )}

          {/* CRF */}
          <div>
            <p className={styles.label}>
              {t('transcode.crfLabel')}
              <span className={styles.labelHint}>{t('transcode.crfHint')}</span>
            </p>
            <div className={styles.row}>
              <Slider
                min={0}
                max={63}
                value={[crf]}
                onValueChange={([v]) => { setCrf(v); setCrfReasonKey(''); }}
                thumbLabel={t('transcode.crfLabel')}
                className={styles.grow}
              />
              <Input
                size="sm"
                className={styles.numberInput}
                inputClassName={styles.center}
                type="number"
                min={0}
                max={63}
                value={crf}
                onChange={(e) => { setCrf(Math.min(63, Math.max(0, Number(e.target.value)))); setCrfReasonKey(''); }}
                aria-label={t('transcode.crfLabel')}
              />
            </div>
            {crfReasonKey && (
              <p className={styles.hintAccent}>
                {t('transcode.crfSuggestion', { crf, reason: t(crfReasonKey) })}
              </p>
            )}
            {inputSizeBytes != null && video.duration && video.duration > 0 && (
              <p className={styles.note}>
                {t('transcode.crfEstimate', { min: formatSize(inputSizeBytes * 0.4), max: formatSize(inputSizeBytes * 0.6) })}
              </p>
            )}
          </div>

          {/* Preset */}
          <div>
            <p className={styles.label}>{t('transcode.presetLabel')}</p>
            <div className={styles.cardGrid} role="radiogroup" aria-label={t('transcode.presetLabel')}>
              {PRESET_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  role="radio"
                  aria-checked={preset === opt.value}
                  className={styles.optionCard}
                  data-selected={preset === opt.value || undefined}
                  onClick={() => setPreset(opt.value)}
                >
                  <span className={styles.optionCardTitle}>{t(opt.labelKey)}</span>
                  <span className={styles.optionCardDesc}>{t(opt.descKey)}</span>
                </button>
              ))}
            </div>
          </div>

          {/* 元ファイルの扱い */}
          <div className={styles.stackTight}>
            <label className={styles.option}>
              <Checkbox checked={trashOriginal} onCheckedChange={(v) => setTrashOriginal(v === true)} />
              <span className={styles.strong}>{t('transcode.trashOriginal')}</span>
            </label>
            {trashOriginal && (
              <p className={styles.callout} data-tone="warning">{t('transcode.trashOriginalNote')}</p>
            )}
          </div>

          <p className={styles.note}>{t('transcode.discardNote', { percent: minSavingPercent })}</p>
          <p className={styles.note}>{t('transcode.timeEstimate')}</p>

          {isBusy && (
            <p className={styles.callout}>{t('transcode.queueNote', { count: pendingCount + 1 })}</p>
          )}
        </div>
      )}
    </Dialog>
  );
}
