import { useState, useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { useLibraryStore } from '../../store/useLibraryStore';
import type { Video } from '../../types';

interface TranscodeProgressPayload {
  percent: number;
  speed: string;
  elapsed_secs: number;
}

type Phase = 'confirm' | 'encoding' | 'done' | 'error';

interface Props {
  video: Video;
  onClose: () => void;
}

function formatElapsed(secs: number): string {
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  if (m > 0) return `${m}分${String(s).padStart(2, '0')}秒`;
  return `${s}秒`;
}

function outputPathFor(inputPath: string): string {
  const lastDot = inputPath.lastIndexOf('.');
  const lastSlash = Math.max(inputPath.lastIndexOf('/'), inputPath.lastIndexOf('\\'));
  const stem = lastDot > lastSlash ? inputPath.slice(0, lastDot) : inputPath;
  return `${stem}.av1.mkv`;
}

export function TranscodeModal({ video, onClose }: Props) {
  const { addVideoFromPath, removeVideo } = useLibraryStore();

  const [phase, setPhase] = useState<Phase>('confirm');
  const [deleteOriginal, setDeleteOriginal] = useState(false);
  const [progress, setProgress] = useState<TranscodeProgressPayload | null>(null);
  const [outputPath, setOutputPath] = useState('');
  const [error, setError] = useState('');
  const [isDeleting, setIsDeleting] = useState(false);

  const unlistenRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    listen<TranscodeProgressPayload>('transcode://progress', (e) => {
      setProgress(e.payload);
    }).then((unlisten) => {
      unlistenRef.current = unlisten;
    });
    return () => {
      unlistenRef.current?.();
    };
  }, []);

  const handleStart = async () => {
    setPhase('encoding');
    setProgress(null);
    try {
      const result = await invoke<string>('transcode_video', {
        inputPath: video.path,
        durationSecs: video.duration ?? 0,
      });
      setOutputPath(result);

      const stem = result.split('/').pop()?.replace(/\.av1\.mkv$/, '') ?? result;
      await addVideoFromPath(result, stem);

      setPhase('done');
    } catch (e) {
      const msg = String(e);
      if (msg === 'キャンセルされました') {
        onClose();
        return;
      }
      setError(msg);
      setPhase('error');
    }
  };

  const handleCancel = async () => {
    await invoke('cancel_transcode').catch(() => {});
  };

  const handleDeleteOriginal = async () => {
    setIsDeleting(true);
    try {
      await invoke('delete_video_file', { path: video.path });
      await removeVideo(video.id);
      onClose();
    } catch (e) {
      setError(String(e));
      setPhase('error');
    } finally {
      setIsDeleting(false);
    }
  };

  const displayName = video.title ?? video.path.split('/').pop() ?? video.path;
  const previewOutput = outputPathFor(video.path);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={phase === 'encoding' ? undefined : onClose}
    >
      <div
        className="bg-white dark:bg-gray-900 rounded-xl shadow-xl w-full max-w-md mx-4 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">AV1 変換</h2>
          {phase !== 'encoding' && (
            <button
              type="button"
              className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 text-lg leading-none"
              onClick={onClose}
            >
              ✕
            </button>
          )}
        </div>

        <div className="p-5 flex flex-col gap-4">
          {phase === 'confirm' && (
            <>
              <div className="text-sm text-gray-700 dark:text-gray-300">
                <p className="font-medium mb-1 truncate">{displayName}</p>
                <p className="text-xs text-gray-500 dark:text-gray-400 break-all">{video.path}</p>
              </div>

              <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-3 text-xs text-gray-600 dark:text-gray-400 space-y-1">
                <p><span className="font-medium">エンコーダー:</span> SVT-AV1 (CRF 32, preset 8)</p>
                <p><span className="font-medium">音声:</span> Opus 128k</p>
                <p><span className="font-medium">出力先:</span> <span className="break-all">{previewOutput}</span></p>
                <p className="text-yellow-600 dark:text-yellow-400">※ Intel i5 の場合、1GB あたり 15〜30 分程度かかります</p>
              </div>

              <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300 cursor-pointer select-none">
                <input
                  type="checkbox"
                  className="w-4 h-4 rounded"
                  checked={deleteOriginal}
                  onChange={(e) => setDeleteOriginal(e.target.checked)}
                />
                変換完了後に元ファイルを削除する
              </label>

              <div className="flex gap-2 justify-end">
                <button
                  type="button"
                  className="px-4 py-1.5 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200"
                  onClick={onClose}
                >
                  閉じる
                </button>
                <button
                  type="button"
                  className="px-4 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-sm rounded font-medium"
                  onClick={handleStart}
                >
                  変換開始
                </button>
              </div>
            </>
          )}

          {phase === 'encoding' && (
            <>
              <div className="text-sm text-gray-700 dark:text-gray-300">
                <p className="font-medium truncate">{displayName}</p>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">AV1 に変換中...</p>
              </div>

              {/* Progress bar */}
              <div className="space-y-1.5">
                <div className="h-3 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-300 ${
                      progress && progress.percent > 0
                        ? 'bg-blue-500'
                        : 'bg-blue-400 animate-pulse w-full'
                    }`}
                    style={{
                      width:
                        progress && progress.percent > 0
                          ? `${progress.percent}%`
                          : undefined,
                    }}
                  />
                </div>
                <div className="flex justify-between text-xs text-gray-500 dark:text-gray-400">
                  <span>
                    {progress && progress.percent > 0
                      ? `${progress.percent.toFixed(1)}%`
                      : '開始中...'}
                  </span>
                  <span>
                    {progress
                      ? `速度: ${progress.speed}  経過: ${formatElapsed(progress.elapsed_secs)}`
                      : ''}
                  </span>
                </div>
              </div>

              <div className="flex justify-end">
                <button
                  type="button"
                  className="px-4 py-1.5 bg-red-600 hover:bg-red-700 text-white text-sm rounded font-medium"
                  onClick={handleCancel}
                >
                  キャンセル
                </button>
              </div>
            </>
          )}

          {phase === 'done' && (
            <>
              <div className="flex items-center gap-2 text-green-600 dark:text-green-400">
                <span className="text-xl">✓</span>
                <p className="text-sm font-medium">変換完了 — 出力ファイルを確認してください</p>
              </div>
              <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-3 text-xs text-gray-600 dark:text-gray-400 break-all">
                {outputPath}
              </div>
              {deleteOriginal ? (
                <div className="flex gap-2 justify-end">
                  <button
                    type="button"
                    className="px-4 py-1.5 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200"
                    onClick={onClose}
                    disabled={isDeleting}
                  >
                    削除せずに閉じる
                  </button>
                  <button
                    type="button"
                    className="px-4 py-1.5 bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white text-sm rounded font-medium"
                    onClick={handleDeleteOriginal}
                    disabled={isDeleting}
                  >
                    {isDeleting ? '削除中...' : '元ファイルを削除する'}
                  </button>
                </div>
              ) : (
                <div className="flex justify-end">
                  <button
                    type="button"
                    className="px-4 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-sm rounded font-medium"
                    onClick={onClose}
                  >
                    閉じる
                  </button>
                </div>
              )}
            </>
          )}

          {phase === 'error' && (
            <>
              <div className="flex items-center gap-2 text-red-600 dark:text-red-400">
                <span className="text-xl">✕</span>
                <p className="text-sm font-medium">変換失敗</p>
              </div>
              <div className="bg-red-50 dark:bg-red-900/20 rounded-lg p-3 text-xs text-red-700 dark:text-red-300 break-all">
                {error}
              </div>
              <div className="flex justify-end">
                <button
                  type="button"
                  className="px-4 py-1.5 bg-gray-600 hover:bg-gray-700 text-white text-sm rounded font-medium"
                  onClick={onClose}
                >
                  閉じる
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
