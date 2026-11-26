import { useState } from "react";
import { useTranslation } from "react-i18next";
import { AnimatePresence, motion } from "motion/react";
import { finishedCount, useTranscodeStore } from "../store/useTranscodeStore";
import { ChevronRight, X } from "lucide-react";
import { Button, cx, motionPresets, useFrozenWhileExiting } from "./ui";
import styles from "./TranscodeStatusBar.module.css";

const { floatUp, presenceProps, transitions } = motionPresets;

/** 変換中・変換完了時に画面下部へ浮かぶステータスカード */
export function TranscodeStatusBar() {
  const visible = useTranscodeStore((s) => s.current != null || s.isDone);
  return <AnimatePresence>{visible && <TranscodeStatusCard key="transcode-status" />}</AnimatePresence>;
}

function TranscodeStatusCard() {
  const { t } = useTranslation();
  // 閉じるアニメーション中に中身が消えないよう、退場中は直前のストア状態で描画する
  const {
    current,
    queue,
    progress,
    batch,
    isDone,
    lastError,
    cancel,
    cancelAll,
    removeFromQueue,
    dismiss,
  } = useFrozenWhileExiting(useTranscodeStore());
  const [showQueue, setShowQueue] = useState(false);

  const isRunning = current != null;

  const fmt = (b: number) =>
    b >= 1_073_741_824
      ? `${(b / 1_073_741_824).toFixed(2)} GB`
      : `${(b / 1_048_576).toFixed(1)} MB`;

  const isMulti = batch.total > 1;
  const hasError = isDone && batch.failed > 0;
  const position = finishedCount(batch) + 1;

  let doneLabel = "";
  if (isDone) {
    if (isMulti) {
      doneLabel = hasError
        ? t("app.transcodeBatchPartial", { total: batch.total, failed: batch.failed })
        : t("app.transcodeBatchSuccess", { total: batch.total });
      if (batch.discarded > 0) doneLabel += t("app.transcodeBatchDiscarded", { count: batch.discarded });
    } else if (hasError && lastError) {
      doneLabel = t("app.transcodeError", { name: lastError.videoName });
    } else if (batch.discarded > 0) {
      doneLabel = t("app.transcodeDiscarded", { name: batch.lastDiscardedName });
    } else {
      doneLabel = t("app.transcodeSuccess", { name: batch.lastSucceededName });
    }
  }

  return (
    <motion.div
      variants={floatUp}
      {...presenceProps}
      className={styles.card}
      data-tone={hasError ? "error" : isDone ? "success" : undefined}
      role="status"
    >
      <div className={styles.row}>
        <span className={styles.icon} aria-hidden>
          {hasError ? "✕" : isDone ? "✓" : "⟳"}
        </span>

        {isDone ? (
          <div className={styles.doneText}>
            <span className={cx(styles.doneLabel, styles.truncate)}>
              {doneLabel}
            </span>
            {hasError && lastError && (
              <span className={styles.errorMessage}>
                {isMulti && `${lastError.videoName}: `}
                {lastError.message}
              </span>
            )}
          </div>
        ) : (
          <span className={cx(styles.runningLabel, styles.truncate)}>
            {isMulti && <span className={styles.position}>{position}/{batch.total}</span>}
            {t("app.transcodeInProgress", { name: current?.videoName ?? "" })}
          </span>
        )}

        {isDone && batch.succeeded > 0 && batch.inputSizeBytes > 0 && (() => {
          const saved = batch.inputSizeBytes - batch.outputSizeBytes;
          const ratio = ((saved / batch.inputSizeBytes) * 100).toFixed(1);
          return (
            <span className={styles.saved}>
              {fmt(batch.inputSizeBytes)} → {fmt(batch.outputSizeBytes)}
              {saved > 0 && ` (−${ratio}%)`}
            </span>
          );
        })()}

        {isRunning && (
          <>
            <div className={styles.track}>
              <motion.div
                className={styles.fill}
                data-indeterminate={progress && progress.percent > 0 ? undefined : true}
                initial={false}
                animate={{
                  width: progress && progress.percent > 0 ? `${progress.percent}%` : "100%",
                }}
                transition={transitions.normal}
              />
            </div>
            <span className={styles.percent}>
              {progress && progress.percent > 0
                ? `${progress.percent.toFixed(1)}%`
                : t("app.transcodeStarting")}
            </span>
            {progress?.speed && progress.speed !== "N/A" && (
              <span className={styles.speed}>
                {progress.speed}
              </span>
            )}
            <Button size="xs" variant="danger-soft" className={styles.end} onClick={cancel}>
              {t("app.transcodeCancel")}
            </Button>
          </>
        )}

        {isDone && (
          <Button size="icon-sm" variant="ghost" className={styles.end} aria-label="閉じる" onClick={dismiss}>
            <X aria-hidden />
          </Button>
        )}
      </div>

      {isRunning && queue.length > 0 && (
        <div className={styles.queue}>
          <div className={styles.queueHead}>
            <Button size="xs" variant="ghost" onClick={() => setShowQueue((v) => !v)} aria-expanded={showQueue}>
              <ChevronRight
                aria-hidden
                className={styles.chevron}
                data-open={showQueue || undefined}
              />
              {t("app.transcodeQueued", { count: queue.length })}
            </Button>
            <Button size="xs" variant="danger-soft" className={styles.end} onClick={cancelAll}>
              {t("app.transcodeCancelAll")}
            </Button>
          </div>
          <AnimatePresence initial={false}>
            {showQueue && (
              <motion.ul
                key="queue"
                variants={motionPresets.collapse}
                {...presenceProps}
                className={styles.queueList}
              >
                {queue.map((job) => (
                  <li key={job.id} className={styles.queueItem}>
                    <span className={cx(styles.queueName, styles.truncate)} title={job.videoPath}>{job.videoName}</span>
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
        </div>
      )}
    </motion.div>
  );
}
