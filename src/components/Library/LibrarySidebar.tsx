import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useShallow } from "zustand/shallow";
import { FolderMinus, LayoutGrid, Search } from "lucide-react";
import { useLibraryStore } from "../../store/useLibraryStore";
import { useModalStore } from "../../store/useModalStore";
import { Input } from "../ui";
import { CategorySection } from "./Sidebar/CategorySection";
import { FolderSection } from "./Sidebar/FolderSection";
import { PlaylistSection } from "./Sidebar/PlaylistSection";
import { TagSection } from "./Sidebar/TagSection";
import styles from "./Sidebar/Sidebar.module.css";

type SectionId = "playlist" | "category" | "folder" | "tag";
type SectionOpen = Record<SectionId, boolean>;

const SECTIONS_KEY = "librarySidebarSections";
const DEFAULT_OPEN: SectionOpen = { playlist: true, category: true, folder: true, tag: true };

function loadSectionOpen(): SectionOpen {
  try {
    const raw = localStorage.getItem(SECTIONS_KEY);
    return raw ? { ...DEFAULT_OPEN, ...JSON.parse(raw) } : DEFAULT_OPEN;
  } catch {
    return DEFAULT_OPEN;
  }
}

/** セクションの開閉状態 (次回起動時も保つ) */
function useSectionOpen() {
  const [state, setState] = useState(loadSectionOpen);
  const set = (id: SectionId) => (open: boolean) => setState((prev) => {
    const next = { ...prev, [id]: open };
    try {
      localStorage.setItem(SECTIONS_KEY, JSON.stringify(next));
    } catch {
      // 保存できなくても動作には影響しない
    }
    return next;
  });
  return [state, set] as const;
}

/**
 * ライブラリの左カラム。
 * プレイリスト・カテゴリ・フォルダ・タグを折りたためるセクションとして 1 本のスクロールに並べる。
 * カテゴリ・フォルダ・タグの絞り込みは同時に効くので、すべて見える場所に選択状態を出す。
 */
export function LibrarySidebar() {
  const { t } = useTranslation();
  const [search, setSearch] = useState("");
  const [open, setOpen] = useSectionOpen();

  const {
    filterCategoryId, filterTagIds, filterWatchDir,
    setCategoryFilter, toggleTagFilter, setWatchDirFilter, clearSidebarFilters,
  } = useLibraryStore(useShallow((s) => ({
    filterCategoryId: s.filterCategoryId,
    filterTagIds: s.filterTagIds,
    filterWatchDir: s.filterWatchDir,
    setCategoryFilter: s.setCategoryFilter,
    toggleTagFilter: s.toggleTagFilter,
    setWatchDirFilter: s.setWatchDirFilter,
    clearSidebarFilters: s.clearSidebarFilters,
  })));
  const openPlaylist = useModalStore((s) => s.openPlaylist);

  const noFilter = filterCategoryId === null && filterWatchDir === null && filterTagIds.length === 0;
  const uncategorized = filterCategoryId === -1;

  return (
    <div className={styles.root}>
      <Input
        size="xs"
        className={styles.search}
        icon={<Search />}
        placeholder={t("sidebar.searchPlaceholder")}
        aria-label={t("sidebar.searchPlaceholder")}
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        onClear={() => setSearch("")}
      />

      <nav className={styles.scroll} aria-label={t("sidebar.label")}>
        {!search && (
          <div className={styles.list}>
            <div className={styles.rowWrap}>
              <button
                type="button"
                className={styles.row}
                data-selected={noFilter || undefined}
                aria-current={noFilter || undefined}
                title={t("sidebar.allHint")}
                onClick={() => clearSidebarFilters()}
              >
                <span className={styles.iconBadge} data-neutral="">
                  <LayoutGrid className={styles.badgeIcon} aria-hidden />
                </span>
                <span className={styles.rowText}>{t("category.all")}</span>
              </button>
            </div>
            <div className={styles.rowWrap}>
              <button
                type="button"
                className={styles.row}
                data-selected={uncategorized || undefined}
                aria-current={uncategorized || undefined}
                onClick={() => setCategoryFilter(uncategorized ? null : -1)}
              >
                <span className={styles.iconBadge} data-neutral="">
                  <FolderMinus className={styles.badgeIcon} aria-hidden />
                </span>
                <span className={styles.rowText}>{t("category.uncategorized")}</span>
              </button>
            </div>
          </div>
        )}

        <PlaylistSection
          search={search}
          open={open.playlist}
          onOpenChange={setOpen("playlist")}
          onOpenPlaylist={openPlaylist}
        />
        <CategorySection
          search={search}
          open={open.category}
          onOpenChange={setOpen("category")}
          selectedId={filterCategoryId}
          onSelect={setCategoryFilter}
        />
        <FolderSection
          search={search}
          open={open.folder}
          onOpenChange={setOpen("folder")}
          selectedDir={filterWatchDir}
          onSelect={setWatchDirFilter}
        />
        <TagSection
          search={search}
          open={open.tag}
          onOpenChange={setOpen("tag")}
          selectedIds={filterTagIds}
          onToggle={toggleTagFilter}
        />
      </nav>
    </div>
  );
}
