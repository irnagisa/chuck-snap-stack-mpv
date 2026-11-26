import { convertFileSrc } from '@tauri-apps/api/core';
import { useEffect } from 'react';
import { useInboxStore, type InboxStack } from '../../store/useInboxStore';
import { useLibraryStore } from '../../store/useLibraryStore';
import { VideoDetailsPanel } from '../common/VideoDetailsPanel';
import { VideoOrganizerPanel } from '../common/VideoOrganizerPanel';
import type { Video } from '../../types';
import { ArrowLeft, ArrowRight, Check, ChevronLeft, ChevronRight, Play } from "lucide-react";
import { Button } from "../ui";
import styles from "./Inbox.module.css";

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
      <div className={styles.qsEmpty}>
        <p>このスタックは空です</p>
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
    <div className={styles.view}>
      {/* Header */}
      <div className={styles.qsHeader}>
        <Button
          variant="ghost"
          size="sm"
          onClick={onBack}
        >
          <ChevronLeft aria-hidden />
          {stack.label}
        </Button>
        <span className={styles.qsPosition}>
          {quickSortIndex + 1} <span className={styles.qsSlash}>/</span> {total}
        </span>
      </div>

      {/* Progress bar */}
      <div className={styles.qsProgress}>
        <div
          className={styles.qsProgressBar}
          style={{ width: `${((quickSortIndex + 1) / total) * 100}%` }}
        />
      </div>

      {/* 2-pane layout */}
      {current && (
        <div className={styles.qsPanes}>

          {/* ── Left pane ── */}
          <div className={styles.qsLeft}>
            {/* Thumbnail */}
            <div className={styles.qsThumbWrap}>
              <div
                className={styles.qsThumb}
                onDoubleClick={() => onPlay(current)}
              >
                {current.thumbnail ? (
                  <img src={convertFileSrc(current.thumbnail)} alt={current.title ?? ''} />
                ) : (
                  <span aria-hidden>
                    {current.media_type === 'image' ? '🖼' : current.media_type === 'audio' ? '♪' : '▶'}
                  </span>
                )}
              </div>
            </div>

            {/* Title */}
            <div className={styles.qsSection}>
              <p className={styles.qsTitle}>
                {current.title ?? current.path.split('/').pop()}
              </p>
              <div className={styles.qsFolderRow}>
                <p className={styles.qsFolder}>
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
            <div className={styles.qsPlay}>
              <Button
                variant="primary"
                size="md"
                onClick={() => onPlay(current)}
              >
                <Play aria-hidden fill="currentColor" />
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
            <div className={styles.qsNav}>
              <Button
                variant="secondary"
                size="md"
                disabled={quickSortIndex === 0}
                onClick={() => setQuickSortIndex(quickSortIndex - 1)}
              >
                <ChevronLeft aria-hidden />
                前
              </Button>
              <span className={styles.qsKeys} aria-hidden>← →</span>
              <Button
                variant="secondary"
                size="md"
                disabled={isLast}
                onClick={() => setQuickSortIndex(quickSortIndex + 1)}
              >
                次
                <ChevronRight aria-hidden />
              </Button>
            </div>
          </div>

          {/* ── Right pane ── */}
          <div className={styles.qsRight}>
            <VideoOrganizerPanel video={current} />

            <div className={styles.qsDetails}>
              <VideoDetailsPanel video={current} />
            </div>

            {/* Graduate actions */}
            <div className={styles.qsGraduate}>
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
