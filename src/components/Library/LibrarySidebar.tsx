import { useTranslation } from "react-i18next";
import { useShallow } from "zustand/shallow";
import { CategorySidebar } from "./CategorySidebar";
import { WatchDirSidebar } from "./WatchDirSidebar";
import { PlaylistSidebar } from "./PlaylistSidebar";
import { useLibraryStore } from "../../store/useLibraryStore";
import { useLibraryViewStore } from "../../store/useLibraryViewStore";
import { useModalStore } from "../../store/useModalStore";

export function LibrarySidebar() {
  const { t } = useTranslation();

  const { filterCategoryId, filterTagIds, filterWatchDir, setCategoryFilter, toggleTagFilter, setWatchDirFilter } =
    useLibraryStore(useShallow((s) => ({
      filterCategoryId: s.filterCategoryId,
      filterTagIds: s.filterTagIds,
      filterWatchDir: s.filterWatchDir,
      setCategoryFilter: s.setCategoryFilter,
      toggleTagFilter: s.toggleTagFilter,
      setWatchDirFilter: s.setWatchDirFilter,
    })));

  const { sidebarTab, setSidebarTab } = useLibraryViewStore(useShallow((s) => ({
    sidebarTab: s.sidebarTab,
    setSidebarTab: s.setSidebarTab,
  })));

  const openPlaylist = useModalStore((s) => s.openPlaylist);

  return (
    <div className="w-44 shrink-0 flex flex-col gap-2 min-h-0">
      <div className="flex gap-1 text-xs shrink-0">
        {(
          [
            { key: "category", label: t("sidebar.categoryTab") },
            { key: "folder", label: t("sidebar.folderTab") },
            { key: "playlist", label: t("sidebar.playlistTab") },
          ] as const
        ).map(({ key, label }) => (
          <button
            key={key}
            type="button"
            className={`flex-1 py-1 rounded font-medium transition-colors ${
              sidebarTab === key
                ? "bg-gray-200 dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                : "text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
            }`}
            onClick={() => setSidebarTab(key)}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden">
        {sidebarTab === "category" ? (
          <CategorySidebar
            selectedCategoryId={filterCategoryId}
            onSelectCategory={setCategoryFilter}
            selectedTagIds={filterTagIds}
            onToggleTag={toggleTagFilter}
          />
        ) : sidebarTab === "folder" ? (
          <WatchDirSidebar
            selectedDir={filterWatchDir}
            onSelectDir={setWatchDirFilter}
          />
        ) : (
          <PlaylistSidebar onOpenPlaylist={openPlaylist} />
        )}
      </div>
    </div>
  );
}
