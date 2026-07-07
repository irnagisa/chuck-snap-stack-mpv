import { useTranslation } from "react-i18next";
import { useShallow } from "zustand/react/shallow";
import { useLibraryStore } from "../../store/useLibraryStore";
import { useModalStore } from "../../store/useModalStore";

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

  return (
    <div className="flex items-center gap-2 mb-3 px-3 py-2 bg-blue-50 dark:bg-blue-950/50 border border-blue-200 dark:border-blue-800 rounded-lg shrink-0">
      <span className="text-xs font-medium text-blue-700 dark:text-blue-300 shrink-0">
        {t("batch.selectedCount", { count: selectedVideoIds.size })}
      </span>
      <button
        type="button"
        className="px-2.5 py-1 text-xs bg-blue-600 hover:bg-blue-700 text-white rounded"
        onClick={() => openBulkModal("tag")}
      >
        {t("batch.setTag")}
      </button>
      <button
        type="button"
        className="px-2.5 py-1 text-xs bg-purple-600 hover:bg-purple-700 text-white rounded"
        onClick={() => openBulkModal("category")}
      >
        {t("batch.setCategory")}
      </button>
      <button
        type="button"
        className="px-2.5 py-1 text-xs bg-teal-600 hover:bg-teal-700 text-white rounded"
        onClick={async () => {
          await assignCategoryFromPath(Array.from(selectedVideoIds));
          onClearSelection();
        }}
      >
        {t("batch.assignDirCategory")}
      </button>
      <button
        type="button"
        className="px-2.5 py-1 text-xs bg-yellow-500 hover:bg-yellow-600 text-white rounded"
        onClick={() => openBulkModal("rating")}
      >
        {t("batch.setRating")}
      </button>
      <button
        type="button"
        className="px-2.5 py-1 text-xs bg-orange-600 hover:bg-orange-700 text-white rounded"
        onClick={() => openBulkModal("rename")}
      >
        {t("batch.rename")}
      </button>
      <button
        type="button"
        className="px-2.5 py-1 text-xs bg-red-600 hover:bg-red-700 text-white rounded"
        onClick={() => openBulkModal("delete")}
      >
        {t("batch.delete")}
      </button>
      <button
        type="button"
        className="px-2.5 py-1 text-xs bg-gray-600 hover:bg-gray-700 dark:bg-gray-500 dark:hover:bg-gray-400 text-white rounded disabled:opacity-50"
        disabled={isThumbnailGenerating}
        onClick={async () => {
          await rescanMultiple(Array.from(selectedVideoIds));
          onClearSelection();
        }}
      >
        {t("batch.rescan")}
      </button>
      <button
        type="button"
        className="ml-auto text-xs text-blue-500 dark:text-blue-400 hover:underline"
        onClick={onClearSelection}
      >
        {t("batch.deselect")}
      </button>
    </div>
  );
}
