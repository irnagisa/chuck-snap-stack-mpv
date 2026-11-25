import { useState } from "react";
import { useTranslation } from "react-i18next";
import { AnimatePresence, motion } from "motion/react";
import { finishedCount, useTranscodeStore } from "../store/useTranscodeStore";
import { ChevronRight, X } from "lucide-react";
import { Button, motionPresets, useFrozenWhileExiting } from "./ui";

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
      style={{ zIndex: 60 }}
      className={`fixed bottom-20 left-1/2 -translate-x-1/2 w-full max-w-xl mx-auto px-4 py-2 flex flex-col gap-1.5 rounded-xl shadow-lg border ${
        hasError
          ? "bg-red-50 dark:bg-red-950 border-red-300 dark:border-red-700"
          : isDone
          ? "bg-green-50 dark:bg-green-950 border-green-300 dark:border-green-700"
          : "bg-white dark:bg-gray-900 border-blue-300 dark:border-blue-700"
      }`}
    >
      <div className="flex items-start gap-3">
        <span
          className={`text-xs shrink-0 ${
            hasError
              ? "text-red-500"
              : isDone
              ? "text-green-600 dark:text-green-400"
              : "text-blue-600 dark:text-blue-400"
          }`}
        >
          {hasError ? "✕" : isDone ? "✓" : "⟳"}
        </span>

        {isDone ? (
          <div className="flex flex-col min-w-0 flex-1">
            <span
              className={`text-xs font-medium truncate ${
                hasError ? "text-red-700 dark:text-red-300" : "text-green-700 dark:text-green-300"
              }`}
            >
              {doneLabel}
            </span>
            {hasError && lastError && (
              <span className="text-xs text-red-600 dark:text-red-400 line-clamp-2 break-all leading-tight mt-0.5">
                {isMulti && `${lastError.videoName}: `}
                {lastError.message}
              </span>
            )}
          </div>
        ) : (
          <span className="text-xs shrink-0 font-medium truncate max-w-48 text-blue-700 dark:text-blue-300">
            {isMulti && <span className="tabular-nums mr-1">{position}/{batch.total}</span>}
            {t("app.transcodeInProgress", { name: current?.videoName ?? "" })}
          </span>
        )}

        {isDone && batch.succeeded > 0 && batch.inputSizeBytes > 0 && (() => {
          const saved = batch.inputSizeBytes - batch.outputSizeBytes;
          const ratio = ((saved / batch.inputSizeBytes) * 100).toFixed(1);
          return (
            <span className="text-xs text-green-600 dark:text-green-400 shrink-0">
              {fmt(batch.inputSizeBytes)} → {fmt(batch.outputSizeBytes)}
              {saved > 0 && ` (−${ratio}%)`}
            </span>
          );
        })()}

        {isRunning && (
          <>
            <div className="flex-1 bg-blue-200 dark:bg-blue-900/50 rounded-full h-1.5 min-w-0 self-center">
              <motion.div
                className={`h-1.5 rounded-full ${
                  progress && progress.percent > 0
                    ? "bg-blue-500"
                    : "bg-blue-400 animate-pulse"
                }`}
                initial={false}
                animate={{
                  width: progress && progress.percent > 0 ? `${progress.percent}%` : "100%",
                }}
                transition={transitions.normal}
              />
            </div>
            <span className="text-xs text-blue-600 dark:text-blue-400 shrink-0 tabular-nums">
              {progress && progress.percent > 0
                ? `${progress.percent.toFixed(1)}%`
                : t("app.transcodeStarting")}
            </span>
            {progress?.speed && progress.speed !== "N/A" && (
              <span className="text-xs text-blue-500 dark:text-blue-500 shrink-0">
                {progress.speed}
              </span>
            )}
            <Button size="xs" variant="danger-soft" className="ml-auto" onClick={cancel}>
              {t("app.transcodeCancel")}
            </Button>
          </>
        )}

        {isDone && (
          <Button size="icon-sm" variant="ghost" className="ml-auto" aria-label="閉じる" onClick={dismiss}>
            <X aria-hidden />
          </Button>
        )}
      </div>

      {isRunning && queue.length > 0 && (
        <div className="flex flex-col gap-1 pl-6">
          <div className="flex items-center gap-3">
            <Button size="xs" variant="ghost" onClick={() => setShowQueue((v) => !v)} aria-expanded={showQueue}>
              <ChevronRight
                aria-hidden
                className={`transition-transform ${showQueue ? "rotate-90" : ""}`}
              />
              {t("app.transcodeQueued", { count: queue.length })}
            </Button>
            <Button size="xs" variant="danger-soft" className="ml-auto" onClick={cancelAll}>
              {t("app.transcodeCancelAll")}
            </Button>
          </div>
          <AnimatePresence initial={false}>
            {showQueue && (
              <motion.ul
                key="queue"
                variants={motionPresets.collapse}
                {...presenceProps}
                className="max-h-32 overflow-y-auto flex flex-col gap-0.5"
              >
                {queue.map((job) => (
                  <li key={job.id} className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-400">
                    <span className="truncate flex-1" title={job.videoPath}>{job.videoName}</span>
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
