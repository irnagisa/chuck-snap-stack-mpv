import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useShallow } from "zustand/react/shallow";
import { useLibraryStore } from "../../store/useLibraryStore";
import { useModalStore } from "../../store/useModalStore";
import {
  AudioLines,
  FolderInput,
  FolderOutput,
  FolderTree,
  LoaderCircle,
  PencilLine,
  RefreshCw,
  Star,
  Tags,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "../../store/useToastStore";
import { Button } from "../ui";
import { checkSilence } from "./silenceCheck";

interface Props {
  selectedVideoIds: Set<number>;
  isThumbnailGenerating: boolean;
  onClearSelection: () => void;
}

export function BatchActionBar({
  selectedVideoIds,
  isThumbnailGenerating,
  onClearSelection,
}: Props) {
  const { t } = useTranslation();
  const { openBulkModal } = useModalStore();
  const { assignCategoryFromPath, rescanMultiple, videos, fetchVideos } = useLibraryStore(
    useShallow((s) => ({
      assignCategoryFromPath: s.assignCategoryFromPath,
      rescanMultiple: s.rescanMultiple,
      videos: s.videos,
      fetchVideos: s.fetchVideos,
    }))
  );
  /** 無音の音声トラックを調べている間の進み具合 */
  const [silenceProgress, setSilenceProgress] = useState<{ done: number; total: number } | null>(null);
  const unmounted = useRef(false);
  useEffect(() => {
    unmounted.current = false;
    return () => {
      unmounted.current = true;
    };
  }, []);

  /** 選んだ動画の音声トラックが無音かを調べる (結果は絞り込み・整理画面に出る) */
  const handleCheckSilence = async () => {
    // いまのページで動画以外と分かっているものは除く (他のページで選んだものはそのまま送る)
    const nonVideo = new Set((videos ?? []).filter((v) => (v.media_type ?? "video") !== "video").map((v) => v.id));
    const targets = Array.from(selectedVideoIds).filter((id) => !nonVideo.has(id));
    if (targets.length === 0) {
      toast.info(t("batch.checkSilenceNoVideo"));
      return;
    }
    setSilenceProgress({ done: 0, total: targets.length });
    try {
      const r = await checkSilence(targets, {
        isCancelled: () => unmounted.current,
        onProgress: (done, total) => !unmounted.current && setSilenceProgress({ done, total }),
      });
      toast.success(t("batch.checkSilenceDone", { count: r.done, found: r.found }));
      if (r.failed > 0) toast.error(t("batch.checkSilenceFailed", { count: r.failed }));
      // 無音で絞り込んでいるときに結果を反映する
      await fetchVideos();
    } finally {
      if (!unmounted.current) setSilenceProgress(null);
    }
  };

  if (selectedVideoIds.size === 0) return null;

  const ids = () => Array.from(selectedVideoIds);

  return (
    <div className="flex flex-wrap items-center gap-1.5 mb-3 px-3 py-2 bg-blue-50 dark:bg-blue-950/50 border border-blue-200 dark:border-blue-800 rounded-2xl shrink-0">
      <span className="text-xs font-semibold text-blue-700 dark:text-blue-300 shrink-0 mr-1">
        {t("batch.selectedCount", { count: selectedVideoIds.size })}
      </span>
      <Button variant="soft" onClick={() => openBulkModal("tag")}>
        <Tags aria-hidden />
        {t("batch.setTag")}
      </Button>
      <Button variant="soft" onClick={() => openBulkModal("category")}>
        <FolderTree aria-hidden />
        {t("batch.setCategory")}
      </Button>
      <Button
        variant="soft"
        onClick={async () => {
          await assignCategoryFromPath(ids());
          onClearSelection();
        }}
      >
        <FolderInput aria-hidden />
        {t("batch.assignDirCategory")}
      </Button>
      <Button variant="soft" onClick={() => openBulkModal("rating")}>
        <Star aria-hidden />
        {t("batch.setRating")}
      </Button>
      <Button variant="soft" onClick={() => openBulkModal("moveDir")}>
        <FolderOutput aria-hidden />
        {t("batch.moveDir")}
      </Button>
      <Button variant="soft" onClick={() => openBulkModal("rename")}>
        <PencilLine aria-hidden />
        {t("batch.rename")}
      </Button>
      <Button variant="soft" disabled={!!silenceProgress} onClick={handleCheckSilence}>
        {silenceProgress ? <LoaderCircle className="animate-spin" aria-hidden /> : <AudioLines aria-hidden />}
        {silenceProgress ? t("batch.checkSilenceProgress", silenceProgress) : t("batch.checkSilence")}
      </Button>
      <Button
        variant="secondary"
        disabled={isThumbnailGenerating}
        onClick={async () => {
          await rescanMultiple(ids());
          onClearSelection();
        }}
      >
        <RefreshCw aria-hidden />
        {t("batch.rescan")}
      </Button>
      <Button variant="danger" onClick={() => openBulkModal("delete")}>
        <Trash2 aria-hidden />
        {t("batch.delete")}
      </Button>
      <Button variant="ghost" size="xs" className="ml-auto" onClick={onClearSelection}>
        <X aria-hidden />
        {t("batch.deselect")}
      </Button>
    </div>
  );
}
