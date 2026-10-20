import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useTranscodeStore } from "../store/useTranscodeStore";

export function TranscodeStatusBar() {
  const { t } = useTranslation();
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
  } = useTranscodeStore();
  const [showQueue, setShowQueue] = useState(false);

  const isRunning = current != null;
  if (!isRunning && !isDone) return null;

  const fmt = (b: number) =>
    b >= 1_073_741_824
      ? `${(b / 1_073_741_824).toFixed(2)} GB`
      : `${(b / 1_048_576).toFixed(1)} MB`;

  const isMulti = batch.total > 1;
  const hasError = isDone && batch.failed > 0;
  const position = batch.succeeded + batch.failed + 1;

  let doneLabel = "";
  if (isDone) {
    if (isMulti) {
      doneLabel = hasError
        ? t("app.transcodeBatchPartial", { total: batch.total, failed: batch.failed })
        : t("app.transcodeBatchSuccess", { total: batch.total });
    } else if (hasError && lastError) {
      doneLabel = t("app.transcodeError", { name: lastError.videoName });
    } else {
      doneLabel = t("app.transcodeSuccess", { name: batch.lastSucceededName });
    }
  }

  return (
    <div
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
              <div
                className={`h-1.5 rounded-full transition-all duration-300 ${
                  progress && progress.percent > 0
                    ? "bg-blue-500"
                    : "bg-blue-400 animate-pulse w-full"
                }`}
                style={{
                  width:
                    progress && progress.percent > 0
                      ? `${progress.percent}%`
                      : undefined,
                }}
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
            <button
              type="button"
              className="text-xs text-red-500 hover:text-red-700 dark:hover:text-red-300 shrink-0 ml-auto"
              onClick={cancel}
            >
              {t("app.transcodeCancel")}
            </button>
          </>
        )}

        {isDone && (
          <button
            type="button"
            className="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 shrink-0 ml-auto"
            onClick={dismiss}
          >
            {t("app.transcodeDismiss")}
          </button>
        )}
      </div>

      {isRunning && queue.length > 0 && (
        <div className="flex flex-col gap-1 pl-6">
          <div className="flex items-center gap-3">
            <button
              type="button"
              className="text-xs text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
              onClick={() => setShowQueue((v) => !v)}
              aria-expanded={showQueue}
            >
              {showQueue ? "▾" : "▸"} {t("app.transcodeQueued", { count: queue.length })}
            </button>
            <button
              type="button"
              className="text-xs text-red-500 hover:text-red-700 dark:hover:text-red-300 ml-auto"
              onClick={cancelAll}
            >
              {t("app.transcodeCancelAll")}
            </button>
          </div>
          {showQueue && (
            <ul className="max-h-32 overflow-y-auto flex flex-col gap-0.5">
              {queue.map((job) => (
                <li key={job.id} className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-400">
                  <span className="truncate flex-1" title={job.videoPath}>{job.videoName}</span>
                  <button
                    type="button"
                    className="text-gray-400 hover:text-red-500 shrink-0"
                    onClick={() => removeFromQueue(job.id)}
                    aria-label={t("app.transcodeRemoveFromQueue")}
                    title={t("app.transcodeRemoveFromQueue")}
                  >
                    ✕
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
