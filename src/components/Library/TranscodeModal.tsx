import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useTranslation } from "react-i18next";
import { useLibraryStore } from '../../store/useLibraryStore';
import { useTagStore } from '../../store/useTagStore';
import { useTranscodeStore } from '../../store/useTranscodeStore';
import { toast } from '../../store/useToastStore';
import type { Video } from '../../types';

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

  const handleStart = async () => {
    const stem = previewOutput.split('/').pop()?.replace(/\.av1\.mkv$/, '') ?? previewOutput;
    // onSuccess 実行時点での category_id・評価・タグを確定しておく
    const originalCategoryId = video.category_id;
    const originalRating = video.rating;
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
        // 評価をコピー
        if (originalRating > 0) {
          await updateVideo(newId, { rating: originalRating });
        }
        // タグをコピー
        for (const tag of originalTags) {
          await addTagToVideo(newId, tag.id);
        }
        if (originalCategoryId != null || originalRating > 0 || originalTags.length > 0) {
          await fetchVideos();
        }
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
    onClose();
  };

  return (
    <div
      className="fixed inset-0 flex items-center justify-center bg-black/40"
      role="dialog"
      aria-modal="true"
      style={{ zIndex: 70 }}
      onClick={onClose}
    >
      <div
        className="bg-white dark:bg-gray-900 rounded-xl shadow-xl w-full max-w-md mx-4 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">{t('transcode.title')}</h2>
          <button
            type="button"
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 text-lg leading-none"
            onClick={onClose}
          >
            ✕
          </button>
        </div>

        <div className="p-5 flex flex-col gap-4">
          {isQueued ? (
            <div className="text-sm text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 rounded-lg px-4 py-3">
              {t('transcode.alreadyQueued')}
            </div>
          ) : (
            <>
              {/* ファイル情報 */}
              <div className="text-sm text-gray-700 dark:text-gray-300">
                <p className="font-medium mb-1 truncate">{displayName}</p>
                <p className="text-xs text-gray-500 dark:text-gray-400 break-all">{video.path}</p>
              </div>

              {/* エンコード情報 */}
              <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-3 text-xs text-gray-600 dark:text-gray-400 space-y-1">
                <p><span className="font-medium">{t('transcode.encoder')}</span> {t('transcode.encoderValue')}</p>
                <p>
                  <span className="font-medium">{t('transcode.inputSize')}</span>{' '}
                  {inputSizeBytes != null ? (
                    <>
                      {formatSize(inputSizeBytes)}
                      {video.duration && video.duration > 0 && (
                        <span className="text-gray-400 dark:text-gray-500 ml-2">
                          ({((inputSizeBytes * 8) / 1000 / video.duration).toFixed(0)} kbps)
                        </span>
                      )}
                    </>
                  ) : t('transcode.loadingSize')}
                </p>
                <p><span className="font-medium">{t('transcode.output')}</span> <span className="break-all">{previewOutput}</span></p>
              </div>

              {/* CRF */}
              <div>
                <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                  {t('transcode.crfLabel')}
                  <span className="ml-1.5 font-normal text-gray-400">{t('transcode.crfHint')}</span>
                </label>
                <div className="flex items-center gap-3">
                  <input
                    type="range"
                    min={0}
                    max={63}
                    value={crf}
                    onChange={(e) => { setCrf(Number(e.target.value)); setCrfReasonKey(''); }}
                    className="flex-1"
                  />
                  <input
                    type="number"
                    min={0}
                    max={63}
                    value={crf}
                    onChange={(e) => { setCrf(Math.min(63, Math.max(0, Number(e.target.value)))); setCrfReasonKey(''); }}
                    className="w-14 px-2 py-1 text-sm text-center border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
                  />
                </div>
                {crfReasonKey && (
                  <p className="mt-1 text-xs text-blue-600 dark:text-blue-400">
                    {t('transcode.crfSuggestion', { crf, reason: t(crfReasonKey) })}
                  </p>
                )}
                {inputSizeBytes != null && video.duration && video.duration > 0 && (
                  <p className="mt-0.5 text-xs text-gray-400 dark:text-gray-500">
                    {t('transcode.crfEstimate', { min: formatSize(inputSizeBytes * 0.4), max: formatSize(inputSizeBytes * 0.6) })}
                  </p>
                )}
              </div>

              {/* Preset */}
              <div>
                <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                  {t('transcode.presetLabel')}
                </label>
                <div className="grid grid-cols-2 gap-1.5">
                  {PRESET_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => setPreset(opt.value)}
                      className={`px-3 py-2 rounded-lg border text-left transition-colors ${
                        preset === opt.value
                          ? 'border-blue-500 bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300'
                          : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600 text-gray-700 dark:text-gray-300'
                      }`}
                    >
                      <div className="text-xs font-medium">{t(opt.labelKey)}</div>
                      <div className="text-[10px] text-gray-500 dark:text-gray-400 mt-0.5">{t(opt.descKey)}</div>
                    </button>
                  ))}
                </div>
              </div>

              {/* 元ファイルの扱い */}
              <div>
                <label className="flex items-start gap-2 text-xs text-gray-700 dark:text-gray-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={trashOriginal}
                    onChange={(e) => setTrashOriginal(e.target.checked)}
                    className="mt-0.5"
                  />
                  <span className="font-medium">{t('transcode.trashOriginal')}</span>
                </label>
                {trashOriginal && (
                  <p className="mt-1.5 text-xs text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 rounded-lg px-3 py-2">
                    {t('transcode.trashOriginalNote')}
                  </p>
                )}
              </div>

              <p className="text-xs text-yellow-600 dark:text-yellow-400">
                {t('transcode.timeEstimate')}
              </p>

              {isBusy && (
                <p className="text-xs text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/40 rounded-lg px-3 py-2">
                  {t('transcode.queueNote', { count: pendingCount + 1 })}
                </p>
              )}
            </>
          )}

          <div className="flex gap-2 justify-end">
            <button
              type="button"
              className="px-4 py-1.5 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200"
              onClick={onClose}
            >
              {t('transcode.close')}
            </button>
            {!isQueued && (
              <button
                type="button"
                className="px-4 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-sm rounded font-medium"
                onClick={handleStart}
              >
                {isBusy ? t('transcode.addToQueue') : t('transcode.start')}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
