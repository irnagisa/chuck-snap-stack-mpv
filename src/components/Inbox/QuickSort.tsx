import { useEffect } from 'react';
import { useInboxStore, type InboxStack } from '../../store/useInboxStore';
import type { Video } from '../../types';

interface Props {
  stack: InboxStack;
  videos: Video[];
  onBack: () => void;
  onPlay: (v: Video) => void;
  onShowDetail: (v: Video) => void;
  onGraduate: (ids: number[]) => Promise<void>;
}

export default function QuickSort({ stack, videos, onBack, onPlay, onShowDetail, onGraduate }: Props) {
  const { quickSortIndex, setQuickSortIndex } = useInboxStore();

  const current = videos[quickSortIndex];
  const total = videos.length;
  const isLast = quickSortIndex >= total - 1;

  // Keyboard navigation
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight' || e.key === 'n') {
        if (!isLast) setQuickSortIndex(quickSortIndex + 1);
      }
      if (e.key === 'ArrowLeft' || e.key === 'p') {
        if (quickSortIndex > 0) setQuickSortIndex(quickSortIndex - 1);
      }
      if (e.key === 'Escape') {
        onBack();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [quickSortIndex, isLast]);

  if (total === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-gray-400">
        <p>このスタックは空です</p>
        <button type="button" className="mt-3 text-sm text-blue-500 hover:underline" onClick={onBack}>
          ← 戻る
        </button>
      </div>
    );
  }

  const handleGraduateCurrent = async () => {
    if (!current) return;
    await onGraduate([current.id]);
    if (!isLast) {
      setQuickSortIndex(quickSortIndex);
    } else if (quickSortIndex > 0) {
      setQuickSortIndex(quickSortIndex - 1);
    }
  };

  const handleGraduateAll = async () => {
    await onGraduate(videos.map((v) => v.id));
    onBack();
  };

  return (
    <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-2 border-b border-gray-100 dark:border-gray-800 shrink-0">
        <button
          type="button"
          className="text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
          onClick={onBack}
        >
          ← {stack.label}
        </button>
        <span className="text-xs text-gray-400 dark:text-gray-500 ml-auto">
          {quickSortIndex + 1} / {total}
        </span>
      </div>

      {/* Progress bar */}
      <div className="h-1 bg-gray-100 dark:bg-gray-800 shrink-0">
        <div
          className="h-1 bg-blue-500 transition-all duration-200"
          style={{ width: `${((quickSortIndex + 1) / total) * 100}%` }}
        />
      </div>

      {/* Current video */}
      {current && (
        <div className="flex flex-col flex-1 min-h-0 overflow-y-auto px-4 py-4">
          {/* Thumbnail */}
          <div className="w-full max-w-md mx-auto aspect-video rounded-lg overflow-hidden bg-gray-100 dark:bg-gray-800 mb-4 shrink-0">
            {current.thumbnail ? (
              <img
                src={`asset://${current.thumbnail}`}
                alt={current.title ?? ''}
                className="w-full h-full object-cover"
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-4xl text-gray-400">
                {current.media_type === 'image' ? '🖼' : current.media_type === 'audio' ? '♪' : '▶'}
              </div>
            )}
          </div>

          {/* Title */}
          <p className="text-sm font-medium text-center mb-1 truncate px-4">
            {current.title ?? current.path.split('/').pop()}
          </p>

          {/* Metadata badges */}
          <div className="flex justify-center gap-2 mb-4 flex-wrap">
            <span className={`text-xs px-2 py-0.5 rounded-full ${current.category_id ? 'bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300' : 'bg-gray-100 dark:bg-gray-800 text-gray-400'}`}>
              {current.category_id ? 'カテゴリ ✓' : 'カテゴリ —'}
            </span>
            <span className={`text-xs px-2 py-0.5 rounded-full ${(current.rating ?? 0) > 0 ? 'bg-yellow-100 dark:bg-yellow-900/40 text-yellow-700 dark:text-yellow-300' : 'bg-gray-100 dark:bg-gray-800 text-gray-400'}`}>
              {(current.rating ?? 0) > 0 ? `${'★'.repeat(current.rating ?? 0)}` : '評価 —'}
            </span>
          </div>

          {/* Action buttons */}
          <div className="flex justify-center gap-2 mb-4 flex-wrap">
            <button
              type="button"
              className="px-3 py-1.5 text-xs rounded bg-purple-600 hover:bg-purple-700 text-white"
              onClick={() => onPlay(current)}
            >
              ▶ 再生
            </button>
            <button
              type="button"
              className="px-3 py-1.5 text-xs rounded bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300"
              onClick={() => onShowDetail(current)}
            >
              詳細を開く
            </button>
            <button
              type="button"
              className="px-3 py-1.5 text-xs rounded bg-green-600 hover:bg-green-700 text-white"
              onClick={handleGraduateCurrent}
            >
              ✓ 整理完了
            </button>
          </div>

          {/* Navigation */}
          <div className="flex justify-center gap-3 mt-auto">
            <button
              type="button"
              className="px-4 py-2 text-sm rounded border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-40"
              disabled={quickSortIndex === 0}
              onClick={() => setQuickSortIndex(quickSortIndex - 1)}
            >
              ← 前
            </button>
            <button
              type="button"
              className="px-4 py-2 text-sm rounded border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-40"
              disabled={isLast}
              onClick={() => setQuickSortIndex(quickSortIndex + 1)}
            >
              次 →
            </button>
          </div>

          <div className="flex justify-center mt-3">
            <button
              type="button"
              className="text-xs text-gray-500 hover:text-red-500 hover:underline"
              onClick={handleGraduateAll}
            >
              スタック全件を整理完了にする
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
