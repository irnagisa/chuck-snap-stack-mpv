import { useTranslation } from "react-i18next";
import type { Playlist } from "../../types";
import { CategorySidebar } from "./CategorySidebar";
import { WatchDirSidebar } from "./WatchDirSidebar";
import { PlaylistSidebar } from "./PlaylistSidebar";

type SidebarTab = "category" | "playlist" | "folder";

interface Props {
  sidebarTab: SidebarTab;
  onTabChange: (tab: SidebarTab) => void;
  selectedCategoryId: number | null;
  onSelectCategory: (id: number | null) => void;
  selectedDir: string | null;
  onSelectDir: (dir: string | null) => void;
  onOpenPlaylist: (playlist: Playlist) => void;
}

export function LibrarySidebar({
  sidebarTab,
  onTabChange,
  selectedCategoryId,
  onSelectCategory,
  selectedDir,
  onSelectDir,
  onOpenPlaylist,
}: Props) {
  const { t } = useTranslation();

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
            onClick={() => onTabChange(key)}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden">
        {sidebarTab === "category" ? (
          <CategorySidebar
            selectedCategoryId={selectedCategoryId}
            onSelectCategory={onSelectCategory}
          />
        ) : sidebarTab === "folder" ? (
          <WatchDirSidebar
            selectedDir={selectedDir}
            onSelectDir={onSelectDir}
          />
        ) : (
          <PlaylistSidebar onOpenPlaylist={onOpenPlaylist} />
        )}
      </div>
    </div>
  );
}
