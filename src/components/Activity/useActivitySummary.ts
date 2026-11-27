import { useShallow } from "zustand/shallow";
import { useDownloadStore, isFinishedDownload } from "../../store/useDownloadStore";
import { useLibraryStore } from "../../store/useLibraryStore";
import { useTranscodeStore } from "../../store/useTranscodeStore";

/** ヘッダーの作業アイコンに出す、すべての作業 (サムネイル生成・変換・ダウンロード) のまとめ */
export interface ActivitySummary {
  /** 動いている・待っている作業の数 */
  running: number;
  /** 終わって一覧に残っている作業の数 (変換はバッチで 1 件) */
  finished: number;
  /** 終わった作業に失敗したものがある */
  failed: boolean;
  /** 動いている作業の進み具合の平均 (0〜100)。どれも分からなければ null */
  percent: number | null;
}

export function useActivitySummary(): ActivitySummary {
  const thumb = useLibraryStore(
    useShallow((s) => ({ generating: s.isThumbnailGenerating, progress: s.thumbnailProgress }))
  );
  const transcode = useTranscodeStore(
    useShallow((s) => ({
      running: s.current != null,
      queued: s.queue.length,
      percent: s.progress?.percent ?? 0,
      isDone: s.isDone,
      failed: s.isDone && s.batch.failed > 0,
    }))
  );
  const jobs = useDownloadStore((s) => s.jobs);

  const percents: number[] = [];
  let running = 0;

  if (thumb.generating) {
    running += 1;
    if (thumb.progress && thumb.progress.total > 0) {
      percents.push((thumb.progress.done / thumb.progress.total) * 100);
    }
  }
  if (transcode.running) {
    running += 1;
    if (transcode.percent > 0) percents.push(transcode.percent);
  }
  running += transcode.queued;

  let finished = transcode.isDone ? 1 : 0;
  let failed = transcode.failed;
  for (const job of jobs) {
    if (isFinishedDownload(job)) {
      finished += 1;
      if (job.phase === "error") failed = true;
    } else {
      running += 1;
      if (job.phase === "downloading" && job.progress.percent > 0) percents.push(job.progress.percent);
    }
  }

  const percent = percents.length > 0 ? percents.reduce((a, b) => a + b, 0) / percents.length : null;
  return { running, finished, failed, percent };
}
