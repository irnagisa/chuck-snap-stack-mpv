import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useLibraryStore } from '../../store/useLibraryStore';
import { useTagStore } from '../../store/useTagStore';
import { useTranscodeStore } from '../../store/useTranscodeStore';
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
function suggestCrf(bitrateKbps: number): { crf: number; reason: string } {
  if (bitrateKbps > 20_000) return { crf: 28, reason: '高ビットレート — 大幅な圧縮が期待できます' };
  if (bitrateKbps > 10_000) return { crf: 32, reason: '中〜高ビットレート — 標準的な圧縮' };
  if (bitrateKbps > 5_000)  return { crf: 36, reason: '中ビットレート — やや控えめな圧縮' };
  if (bitrateKbps > 2_000)  return { crf: 42, reason: '低ビットレート — 元が既に圧縮済みのため保守的な設定を推奨' };
  return { crf: 50, reason: '非常に低ビットレート — ファイルサイズが増える可能性があります' };
}

const PRESET_OPTIONS = [
  { value: 13, label: '超高速 (13)', desc: 'エンコード最速、圧縮効率低' },
  { value: 8,  label: '高速 (8)',   desc: '速度重視のバランス設定' },
  { value: 5,  label: 'バランス (5)', desc: '圧縮効率と速度のバランス' },
  { value: 3,  label: '高品質 (3)', desc: '圧縮効率優先、時間がかかる' },
] as const;

interface Props {
  video: Video;
  onClose: () => void;
}

export function TranscodeModal({ video, onClose }: Props) {
  const { addVideoFromPath, fetchVideos } = useLibraryStore();
  const { addTagToVideo, setVideoCategory, videoTags } = useTagStore();
  const { isRunning, start } = useTranscodeStore();

  const [inputSizeBytes, setInputSizeBytes] = useState<number | null>(null);
  const [crf, setCrf] = useState<number>(32);
  const [preset, setPreset] = useState<number>(8);
  const [crfReason, setCrfReason] = useState<string>('');

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
          setCrfReason(suggestion.reason);
        }
      })
      .catch(() => {});
  }, [video.path, video.duration]);

  const handleStart = async () => {
    const stem = previewOutput.split('/').pop()?.replace(/\.av1\.mkv$/, '') ?? previewOutput;
    // onSuccess 実行時点での category_id とタグを確定しておく
    const originalCategoryId = video.category_id;
    const originalTags = [...(videoTags[video.id] ?? [])];

    start({
      videoPath: video.path,
      videoName: displayName,
      durationSecs: video.duration ?? 0,
      inputSizeBytes,
      crf,
      preset,
      onSuccess: async (outputPath) => {
        const newId = await addVideoFromPath(outputPath, stem);
        if (newId == null) return;
        // カテゴリをコピー
        if (originalCategoryId != null) {
          await setVideoCategory(newId, originalCategoryId);
        }
        // タグをコピー
        for (const tag of originalTags) {
          await addTagToVideo(newId, tag.id);
        }
        if (originalCategoryId != null || originalTags.length > 0) {
          await fetchVideos();
        }
      },
    });
    onClose();
  };

  return (
    <div
      className="fixed inset-0 flex items-center justify-center bg-black/40"
      style={{ zIndex: 70 }}
      onClick={onClose}
    >
      <div
        className="bg-white dark:bg-gray-900 rounded-xl shadow-xl w-full max-w-md mx-4 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">AV1 変換</h2>
          <button
            type="button"
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 text-lg leading-none"
            onClick={onClose}
          >
            ✕
          </button>
        </div>

        <div className="p-5 flex flex-col gap-4">
          {isRunning ? (
            <div className="text-sm text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 rounded-lg px-4 py-3">
              別の動画が変換中です。完了後に再度お試しください。
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
                <p><span className="font-medium">エンコーダー:</span> SVT-AV1 + Opus 128k</p>
                <p>
                  <span className="font-medium">元ファイルサイズ:</span>{' '}
                  {inputSizeBytes != null ? (
                    <>
                      {formatSize(inputSizeBytes)}
                      {video.duration && video.duration > 0 && (
                        <span className="text-gray-400 dark:text-gray-500 ml-2">
                          ({((inputSizeBytes * 8) / 1000 / video.duration).toFixed(0)} kbps)
                        </span>
                      )}
                    </>
                  ) : '取得中...'}
                </p>
                <p><span className="font-medium">出力先:</span> <span className="break-all">{previewOutput}</span></p>
              </div>

              {/* CRF */}
              <div>
                <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                  CRF（品質）
                  <span className="ml-1.5 font-normal text-gray-400">0 = 最高品質・大 / 63 = 最低品質・小</span>
                </label>
                <div className="flex items-center gap-3">
                  <input
                    type="range"
                    min={0}
                    max={63}
                    value={crf}
                    onChange={(e) => { setCrf(Number(e.target.value)); setCrfReason(''); }}
                    className="flex-1"
                  />
                  <input
                    type="number"
                    min={0}
                    max={63}
                    value={crf}
                    onChange={(e) => { setCrf(Math.min(63, Math.max(0, Number(e.target.value)))); setCrfReason(''); }}
                    className="w-14 px-2 py-1 text-sm text-center border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
                  />
                </div>
                {crfReason && (
                  <p className="mt-1 text-xs text-blue-600 dark:text-blue-400">
                    提案: CRF {crf} — {crfReason}
                  </p>
                )}
                {inputSizeBytes != null && video.duration && video.duration > 0 && (
                  <p className="mt-0.5 text-xs text-gray-400 dark:text-gray-500">
                    AV1 後の目安: {formatSize(inputSizeBytes * 0.4)}〜{formatSize(inputSizeBytes * 0.6)}
                    <span className="ml-1">(コンテンツにより大きく異なります)</span>
                  </p>
                )}
              </div>

              {/* Preset */}
              <div>
                <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                  Preset（エンコード速度）
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
                      <div className="text-xs font-medium">{opt.label}</div>
                      <div className="text-[10px] text-gray-500 dark:text-gray-400 mt-0.5">{opt.desc}</div>
                    </button>
                  ))}
                </div>
              </div>

              <p className="text-xs text-yellow-600 dark:text-yellow-400">
                ※ Intel i5 の場合、1GB あたり 15〜30 分程度かかります（preset・CRF により変動）
              </p>
            </>
          )}

          <div className="flex gap-2 justify-end">
            <button
              type="button"
              className="px-4 py-1.5 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200"
              onClick={onClose}
            >
              閉じる
            </button>
            {!isRunning && (
              <button
                type="button"
                className="px-4 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-sm rounded font-medium"
                onClick={handleStart}
              >
                変換開始
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
