import { useTranslation } from "react-i18next";
import { useTranscodeStore } from "../store/useTranscodeStore";

export function TranscodeStatusBar() {
  const { t } = useTranslation();
  const {
    isRunning,
    isDone,
    error,
    progress,
    videoName,
    inputSizeBytes,
    outputSizeBytes,
    cancel,
    dismiss,
  } = useTranscodeStore();

  if (!isRunning && !isDone && !error) return null;

  const fmt = (b: number) =>
    b >= 1_073_741_824
      ? `${(b / 1_073_741_824).toFixed(2)} GB`
      : `${(b / 1_048_576).toFixed(1)} MB`;

  return (
    <div
      style={{ zIndex: 60 }}
      className={`fixed bottom-20 left-1/2 -translate-x-1/2 w-full max-w-xl mx-auto px-4 py-2 flex items-start gap-3 rounded-xl shadow-lg border ${
        error
          ? "bg-red-50 dark:bg-red-950 border-red-300 dark:border-red-700"
          : isDone
          ? "bg-green-50 dark:bg-green-950 border-green-300 dark:border-green-700"
          : "bg-white dark:bg-gray-900 border-blue-300 dark:border-blue-700"
      }`}
    >
      <span
        className={`text-xs shrink-0 ${
          error
            ? "text-red-500"
            : isDone
            ? "text-green-600 dark:text-green-400"
            : "text-blue-600 dark:text-blue-400"
        }`}
      >
        {error ? "✕" : isDone ? "✓" : "⟳"}
      </span>

      {error ? (
        <div className="flex flex-col min-w-0 flex-1">
          <span className="text-xs font-medium text-red-700 dark:text-red-300 truncate">
            {t("app.transcodeError", { name: videoName })}
          </span>
          <span className="text-xs text-red-600 dark:text-red-400 line-clamp-2 break-all leading-tight mt-0.5">
            {error}
          </span>
        </div>
      ) : (
        <span
          className={`text-xs shrink-0 font-medium truncate max-w-48 ${
            isDone
              ? "text-green-700 dark:text-green-300"
              : "text-blue-700 dark:text-blue-300"
          }`}
        >
          {isDone
            ? t("app.transcodeSuccess", { name: videoName })
            : t("app.transcodeInProgress", { name: videoName })}
        </span>
      )}

      {isDone && inputSizeBytes != null && outputSizeBytes != null && (() => {
        const saved = inputSizeBytes - outputSizeBytes;
        const ratio = ((saved / inputSizeBytes) * 100).toFixed(1);
        return (
          <span className="text-xs text-green-600 dark:text-green-400 shrink-0">
            {fmt(inputSizeBytes)} → {fmt(outputSizeBytes)}
            {saved > 0 && ` (−${ratio}%)`}
          </span>
        );
      })()}

      {isRunning && (
        <>
          <div className="flex-1 bg-blue-200 dark:bg-blue-900/50 rounded-full h-1.5 min-w-0">
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

      {(isDone || error) && (
        <button
          type="button"
          className="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 shrink-0 ml-auto"
          onClick={dismiss}
        >
          {t("app.transcodeDismiss")}
        </button>
      )}
    </div>
  );
}
