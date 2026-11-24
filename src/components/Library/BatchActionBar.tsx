import { useTranslation } from "react-i18next";
import { useShallow } from "zustand/react/shallow";
import { useLibraryStore } from "../../store/useLibraryStore";
import { useModalStore } from "../../store/useModalStore";
import { FolderInput, FolderOutput, FolderTree, PencilLine, RefreshCw, Star, Tags, Trash2, X } from "lucide-react";
import { Button } from "../ui";

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
  const { assignCategoryFromPath, rescanMultiple } = useLibraryStore(
    useShallow((s) => ({ assignCategoryFromPath: s.assignCategoryFromPath, rescanMultiple: s.rescanMultiple }))
  );

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
