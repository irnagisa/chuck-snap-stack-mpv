import { useTranslation } from "react-i18next";
import { useLibraryStore } from "../store/useLibraryStore";
import { useShallow } from "zustand/shallow";

export function ThumbnailProgressBar() {
  const { t } = useTranslation();
  const { isThumbnailGenerating, isThumbnailPaused, thumbnailProgress } =
    useLibraryStore(
      useShallow((s) => ({
        isThumbnailGenerating: s.isThumbnailGenerating,
        isThumbnailPaused: s.isThumbnailPaused,
        thumbnailProgress: s.thumbnailProgress,
      }))
    );
  const pauseThumbnails = useLibraryStore((s) => s.pauseThumbnails);
  const resumeThumbnails = useLibraryStore((s) => s.resumeThumbnails);

  if (!isThumbnailGenerating) return null;

  return (
    <div className="px-4 py-1.5 flex items-center gap-3 bg-gray-50 dark:bg-gray-900 border-b border-gray-100 dark:border-gray-800">
      <span className="text-xs text-gray-500 dark:text-gray-400 shrink-0">
        {isThumbnailPaused
          ? t("app.thumbnailPaused")
          : t("app.thumbnailGenerating")}
        {thumbnailProgress && ` ${thumbnailProgress.done}/${thumbnailProgress.total}`}
      </span>
      <div className="flex-1 bg-gray-200 dark:bg-gray-700 rounded-full h-1">
        <div
          className={`h-1 rounded-full transition-all duration-300 ${
            isThumbnailPaused
              ? "bg-gray-400 dark:bg-gray-500"
              : "bg-blue-500"
          }`}
          style={{
            width: thumbnailProgress
              ? `${(thumbnailProgress.done / thumbnailProgress.total) * 100}%`
              : "0%",
          }}
        />
      </div>
      {isThumbnailPaused ? (
        <button
          type="button"
          onClick={resumeThumbnails}
          className="text-xs px-2 py-0.5 rounded bg-blue-500 hover:bg-blue-600 text-white shrink-0"
        >
          {t("app.thumbnailResume")}
        </button>
      ) : (
        <button
          type="button"
          onClick={pauseThumbnails}
          className="text-xs px-2 py-0.5 rounded bg-gray-300 hover:bg-gray-400 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 shrink-0"
        >
          {t("app.thumbnailPause")}
        </button>
      )}
    </div>
  );
}
