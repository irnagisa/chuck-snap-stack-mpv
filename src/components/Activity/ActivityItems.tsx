import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useShallow } from "zustand/shallow";
import { AnimatePresence, motion } from "motion/react";
import { ChevronRight, Pause, Play, X } from "lucide-react";
import { useLibraryStore } from "../../store/useLibraryStore";
import { finishedCount, transcodeResultLabel, useTranscodeStore } from "../../store/useTranscodeStore";
import { downloadJobLabel, useDownloadStore, type DownloadJob } from "../../store/useDownloadStore";
import { Button, motionPresets } from "../ui";
import styles from "./Activity.module.css";

const { collapse, presenceProps, transitions } = motionPresets;

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

/** 進み具合の帯。percent が null のあいだは幅いっぱいで明滅させる */
function ProgressTrack({ percent, paused }: { percent: number | null; paused?: boolean }) {
  return (
    <div className={styles.track}>
      <motion.div
        className={styles.fill}
        data-indeterminate={percent == null ? true : undefined}
        data-paused={paused || undefined}
        initial={false}
        animate={{ width: `${percent ?? 100}%` }}
        transition={transitions.normal}
      />
    </div>
  );
}

function DismissButton({ onClick }: { onClick: () => void }) {
  const { t } = useTranslation();
  return (
    <Button size="icon-sm" variant="ghost" aria-label={t("activity.dismiss")} title={t("activity.dismiss")} onClick={onClick}>
      <X aria-hidden />
    </Button>
  );
}

// ---- サムネイル生成 ----

export function ThumbnailActivity() {
  const { t } = useTranslation();
  const { paused, progress, pause, resume } = useLibraryStore(
    useShallow((s) => ({
      paused: s.isThumbnailPaused,
      progress: s.thumbnailProgress,
      pause: s.pauseThumbnails,
      resume: s.resumeThumbnails,
    }))
  );
  const percent = progress && progress.total > 0 ? (progress.done / progress.total) * 100 : null;

  return (
    <div className={styles.item}>
      <div className={styles.row}>
        <span className={styles.name}>
          {paused ? t("app.thumbnailPaused") : t("app.thumbnailGenerating")}
        </span>
        {progress && (
          <span className={styles.meta}>
            {progress.done}/{progress.total}
          </span>
        )}
        {paused ? (
          <Button size="xs" variant="primary" onClick={resume}>
            <Play aria-hidden />
            {t("app.thumbnailResume")}
          </Button>
        ) : (
          <Button size="xs" variant="secondary" onClick={pause}>
            <Pause aria-hidden />
            {t("app.thumbnailPause")}
          </Button>
        )}
      </div>
      <ProgressTrack percent={percent} paused={paused} />
    </div>
  );
}

// ---- 変換 ----

export function TranscodeActivity() {
  const { t } = useTranslation();
  const { current, queue, progress, batch, isDone, lastError, cancel, cancelAll, removeFromQueue, dismiss } =
    useTranscodeStore();
  const [showQueue, setShowQueue] = useState(false);

  if (isDone) {
    const hasError = batch.failed > 0;
    const saved = batch.inputSizeBytes - batch.outputSizeBytes;
    return (
      // 小さくならず破棄しただけのときは、成功の色にしない
      <div className={styles.item} data-tone={hasError ? "error" : batch.succeeded > 0 ? "success" : undefined}>
        <div className={styles.row}>
          <span className={styles.icon} aria-hidden>{hasError ? "✕" : batch.succeeded > 0 ? "✓" : "–"}</span>
          <span className={styles.name} title={transcodeResultLabel(batch, lastError)}>
            {transcodeResultLabel(batch, lastError)}
          </span>
          <DismissButton onClick={dismiss} />
        </div>
        {batch.succeeded > 0 && batch.inputSizeBytes > 0 && (
          <span className={styles.saved}>
            {formatBytes(batch.inputSizeBytes)} → {formatBytes(batch.outputSizeBytes)}
            {saved > 0 && ` (−${((saved / batch.inputSizeBytes) * 100).toFixed(1)}%)`}
          </span>
        )}
        {hasError && lastError && (
          <span className={styles.error}>
            {batch.total > 1 && `${lastError.videoName}: `}
            {lastError.message}
          </span>
        )}
      </div>
    );
  }

  if (!current) return null;

  const percent = progress && progress.percent > 0 ? progress.percent : null;
  return (
    <div className={styles.item}>
      <div className={styles.row}>
        <span className={styles.icon} aria-hidden>⟳</span>
        <span className={styles.name} title={current.videoPath}>
          {current.videoName}
        </span>
        <Button size="xs" variant="danger-soft" onClick={cancel}>
          {t("app.transcodeCancel")}
        </Button>
      </div>
      <ProgressTrack percent={percent} />
      <div className={styles.meta}>
        <span>
          {batch.total > 1 && `${finishedCount(batch) + 1}/${batch.total} · `}
          {percent != null ? `${percent.toFixed(1)}%` : t("app.transcodeStarting")}
        </span>
        {progress?.speed && progress.speed !== "N/A" && <span>{progress.speed}</span>}
      </div>

      {queue.length > 0 && (
        <>
          <div className={styles.queueHead}>
            <Button size="xs" variant="ghost" onClick={() => setShowQueue((v) => !v)} aria-expanded={showQueue}>
              <ChevronRight aria-hidden className={styles.chevron} data-open={showQueue || undefined} />
              {t("app.transcodeQueued", { count: queue.length })}
            </Button>
            <Button size="xs" variant="danger-soft" onClick={cancelAll}>
              {t("app.transcodeCancelAll")}
            </Button>
          </div>
          <AnimatePresence initial={false}>
            {showQueue && (
              <motion.ul key="queue" variants={collapse} {...presenceProps} className={styles.queueList}>
                {queue.map((job) => (
                  <li key={job.id} className={styles.queueItem}>
                    <span className={styles.name} title={job.videoPath}>{job.videoName}</span>
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      onClick={() => removeFromQueue(job.id)}
                      aria-label={t("app.transcodeRemoveFromQueue")}
                      title={t("app.transcodeRemoveFromQueue")}
                    >
                      <X aria-hidden />
                    </Button>
                  </li>
                ))}
              </motion.ul>
            )}
          </AnimatePresence>
        </>
      )}
    </div>
  );
}

// ---- ダウンロード ----

function DownloadItem({ job }: { job: DownloadJob }) {
  const { t } = useTranslation();
  const { cancelActive, dismissJob } = useDownloadStore(
    useShallow((s) => ({ cancelActive: s.cancelActive, dismissJob: s.dismissJob }))
  );
  const label = downloadJobLabel(job);
  const finished = job.phase === "done" || job.phase === "error" || job.phase === "cancelled";
  const tone = job.phase === "error" ? "error" : job.phase === "done" ? "success" : undefined;

  return (
    <div className={styles.item} data-tone={tone}>
      <div className={styles.row}>
        <span className={styles.icon} aria-hidden>
          {job.phase === "done" ? "✓" : job.phase === "error" ? "✕" : job.phase === "queued" ? "…" : "↓"}
        </span>
        <span className={styles.name} title={label}>{label}</span>
        {job.phase === "downloading" && (
          <Button size="xs" variant="danger-soft" onClick={cancelActive}>
            {t("downloadQueue.cancel")}
          </Button>
        )}
        {finished && <DismissButton onClick={() => dismissJob(job.id)} />}
      </div>

      {job.phase === "downloading" && (
        <>
          <ProgressTrack percent={job.progress.percent > 0 ? job.progress.percent : null} />
          <div className={styles.meta}>
            <span>
              {!job.useYtdlp && job.progress.total > 0
                ? `${formatBytes(job.progress.downloaded)} / ${formatBytes(job.progress.total)}`
                : job.useYtdlp
                  ? t("downloadQueue.downloading")
                  : formatBytes(job.progress.downloaded)}
            </span>
            {job.progress.percent > 0 && <span>{job.progress.percent.toFixed(1)}%</span>}
          </div>
        </>
      )}
      {job.phase === "queued" && <span className={styles.meta}>{t("downloadQueue.queued")}</span>}
      {job.phase === "cancelled" && <span className={styles.meta}>{t("downloadQueue.cancelled")}</span>}
      {job.phase === "error" && <span className={styles.error}>{job.errorMsg}</span>}
    </div>
  );
}

export function DownloadActivity({ jobs }: { jobs: DownloadJob[] }) {
  return (
    <>
      {jobs.map((job) => (
        <DownloadItem key={job.id} job={job} />
      ))}
    </>
  );
}
