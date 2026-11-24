import { convertFileSrc } from '@tauri-apps/api/core';
import { useEffect } from 'react';
import { useInboxStore, type InboxStack } from '../../store/useInboxStore';
import { useLibraryStore } from '../../store/useLibraryStore';
import { VideoDetailsPanel } from '../common/VideoDetailsPanel';
import { VideoOrganizerPanel } from '../common/VideoOrganizerPanel';
import type { Video } from '../../types';
import { ArrowLeft, ArrowRight, Check } from "lucide-react";
import { Button } from "../ui";

interface Props {
  stack: InboxStack;
  videos: Video[];
  onBack: () => void;
  onPlay: (v: Video) => void;
  onShowDetail: (v: Video) => void;
  onGraduate: (ids: number[]) => Promise<void>;
}

export default function QuickSort({ stack, videos, onBack, onPlay, onShowDetail, onGraduate }: Props) {
  const { quickSortIndex, setQuickSortIndex, fetchInbox } = useInboxStore();
  const { assignCategoryFromPath } = useLibraryStore();

  const current = videos[quickSortIndex];
  const total = videos.length;
  const isLast = quickSortIndex >= total - 1;

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
      <div className="flex flex-col items-center justify-center h-full gap-3 text-gray-400 dark:text-gray-500">
        <p className="text-sm">このスタックは空です</p>
        <Button variant="soft" size="sm" onClick={onBack}>
          <ArrowLeft aria-hidden />戻る
        </Button>
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

  const handleAssignCategory = async () => {
    if (!current) return;
    await assignCategoryFromPath([current.id]);
    await fetchInbox();
  };

  return (
    <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 px-5 py-3 border-b border-gray-100 dark:border-gray-800 shrink-0">
        <Button
          variant="ghost"
          size="sm"
          onClick={onBack}
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
          {stack.label}
        </Button>
        <span className="ml-auto text-xs font-medium tabular-nums text-gray-400 dark:text-gray-500">
          {quickSortIndex + 1} <span className="text-gray-300 dark:text-gray-600">/</span> {total}
        </span>
      </div>

      {/* Progress bar */}
      <div className="h-0.5 bg-gray-100 dark:bg-gray-800 shrink-0">
        <div
          className="h-0.5 bg-blue-500 transition-all duration-300 ease-out"
          style={{ width: `${((quickSortIndex + 1) / total) * 100}%` }}
        />
      </div>

      {/* 2-pane layout */}
      {current && (
        <div className="flex flex-1 min-h-0 overflow-hidden">

          {/* ── Left pane ── */}
          <div className="flex flex-col w-2/5 border-r border-gray-100 dark:border-gray-800 overflow-y-auto">
            {/* Thumbnail */}
            <div className="px-5 pt-5 pb-4">
              <div
                className="w-full aspect-video rounded-xl overflow-hidden bg-gray-100 dark:bg-gray-800 shadow-sm cursor-pointer"
                onDoubleClick={() => onPlay(current)}
              >
                {current.thumbnail ? (
                  <img
                    src={convertFileSrc(current.thumbnail)}
                    alt={current.title ?? ''}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-5xl text-gray-300 dark:text-gray-600">
                    {current.media_type === 'image' ? '🖼' : current.media_type === 'audio' ? '♪' : '▶'}
                  </div>
                )}
              </div>
            </div>

            {/* Title */}
            <div className="px-5 pb-4">
              <p className="text-sm font-semibold text-gray-900 dark:text-gray-100 leading-snug line-clamp-2">
                {current.title ?? current.path.split('/').pop()}
              </p>
              <div className="flex items-center gap-1.5 mt-0.5">
                <p className="text-[11px] text-gray-400 dark:text-gray-500 truncate min-w-0">
                  {current.path.split('/').slice(-2, -1)[0]}
                </p>
                <Button
                  variant="soft"
                  size="xs"
                  title="フォルダ名をカテゴリに変換して割り当て"
                  onClick={handleAssignCategory}
                >
                  <ArrowRight aria-hidden />カテゴリ化
                </Button>
              </div>
            </div>

            {/* Play + Detail */}
            <div className="px-5 pb-5 flex items-center gap-3">
              <Button
                variant="primary"
                size="md"
                onClick={() => onPlay(current)}
              >
                <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M8 5v14l11-7z" />
                </svg>
                再生
              </Button>
              <Button
                variant="ghost"
                size="xs"
                onClick={() => onShowDetail(current)}
              >
                詳細を開く<ArrowRight aria-hidden />
              </Button>
            </div>

            {/* Navigation */}
            <div className="mt-auto px-5 pb-5 flex items-center justify-between gap-2">
              <Button
                variant="secondary"
                size="md"
                disabled={quickSortIndex === 0}
                onClick={() => setQuickSortIndex(quickSortIndex - 1)}
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
                </svg>
                前
              </Button>
              <span className="text-[10px] text-gray-300 dark:text-gray-600 select-none">← →</span>
              <Button
                variant="secondary"
                size="md"
                disabled={isLast}
                onClick={() => setQuickSortIndex(quickSortIndex + 1)}
              >
                次
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                </svg>
              </Button>
            </div>
          </div>

          {/* ── Right pane ── */}
          <div className="flex flex-col w-3/5 overflow-y-auto px-6 py-5 gap-5">
            <VideoOrganizerPanel video={current} />

            <div className="border-t border-gray-100 dark:border-gray-800 pt-5">
              <VideoDetailsPanel video={current} />
            </div>

            {/* Graduate actions */}
            <div className="mt-auto pt-5 border-t border-gray-100 dark:border-gray-800 flex flex-col gap-2">
              <Button
                variant="primary"
                size="md"
                fullWidth
                onClick={handleGraduateCurrent}
              >
                <Check aria-hidden />整理完了
              </Button>
              <Button
                variant="danger-soft"
                size="sm"
                onClick={handleGraduateAll}
              >
                スタック全件を整理完了にする
              </Button>
            </div>
          </div>

        </div>
      )}
    </div>
  );
}
