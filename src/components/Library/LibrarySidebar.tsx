import { useTranslation } from "react-i18next";
import { useShallow } from "zustand/shallow";
import { CategorySidebar } from "./CategorySidebar";
import { WatchDirSidebar } from "./WatchDirSidebar";
import { PlaylistSidebar } from "./PlaylistSidebar";
import { useLibraryStore } from "../../store/useLibraryStore";
import { useLibraryViewStore } from "../../store/useLibraryViewStore";
import { useModalStore } from "../../store/useModalStore";
import type { SidebarTab } from "../../store/useLibraryViewStore";
import { SegmentedControl } from "../ui";

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
    <div className="w-full flex-1 flex flex-col gap-2 min-h-0">
      <SegmentedControl<SidebarTab>
        size="xs"
        fullWidth
        aria-label="サイドバー"
        value={sidebarTab}
        onValueChange={setSidebarTab}
        options={[
          { value: "category", label: t("sidebar.categoryTab") },
          { value: "folder", label: t("sidebar.folderTab") },
          { value: "playlist", label: t("sidebar.playlistTab") },
        ]}
      />

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
