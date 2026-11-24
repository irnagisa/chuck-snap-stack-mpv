import { useTranslation } from "react-i18next";
import { useLibraryStore } from "../store/useLibraryStore";
import { useShallow } from "zustand/shallow";
import { motion } from "motion/react";
import { Pause, Play } from "lucide-react";
import { Button, Collapse, motionPresets } from "./ui";

/** サムネイル生成中だけ高さを開閉して表示するバー */
export function ThumbnailProgressBar() {
  const state = useLibraryStore(
    useShallow((s) => ({
      isThumbnailGenerating: s.isThumbnailGenerating,
      isThumbnailPaused: s.isThumbnailPaused,
      thumbnailProgress: s.thumbnailProgress,
    }))
  );

  // 退場アニメーション中は最後の進捗表示のまま閉じる
  return (
    <Collapse show={state.isThumbnailGenerating} data={state}>
      {(s) => <ThumbnailProgressContent isThumbnailPaused={s.isThumbnailPaused} thumbnailProgress={s.thumbnailProgress} />}
    </Collapse>
  );
}

function ThumbnailProgressContent({
  isThumbnailPaused,
  thumbnailProgress,
}: {
  isThumbnailPaused: boolean;
  thumbnailProgress: { done: number; total: number } | null;
}) {
  const { t } = useTranslation();
  const pauseThumbnails = useLibraryStore((s) => s.pauseThumbnails);
  const resumeThumbnails = useLibraryStore((s) => s.resumeThumbnails);

  return (
    <div className="px-4 py-1.5 flex items-center gap-3 bg-gray-50 dark:bg-gray-900 border-b border-gray-100 dark:border-gray-800">
      <span className="text-xs text-gray-500 dark:text-gray-400 shrink-0">
        {isThumbnailPaused
          ? t("app.thumbnailPaused")
          : t("app.thumbnailGenerating")}
        {thumbnailProgress && ` ${thumbnailProgress.done}/${thumbnailProgress.total}`}
      </span>
      <div className="flex-1 bg-gray-200 dark:bg-gray-700 rounded-full h-1">
        <motion.div
          className={`h-1 rounded-full transition-colors ${
            isThumbnailPaused
              ? "bg-gray-400 dark:bg-gray-500"
              : "bg-blue-500"
          }`}
          initial={false}
          animate={{
            width: thumbnailProgress
              ? `${(thumbnailProgress.done / thumbnailProgress.total) * 100}%`
              : "0%",
          }}
          transition={motionPresets.transitions.normal}
        />
      </div>
      {isThumbnailPaused ? (
        <Button size="xs" variant="primary" onClick={resumeThumbnails}>
          <Play aria-hidden />
          {t("app.thumbnailResume")}
        </Button>
      ) : (
        <Button size="xs" variant="secondary" onClick={pauseThumbnails}>
          <Pause aria-hidden />
          {t("app.thumbnailPause")}
        </Button>
      )}
    </div>
  );
}
