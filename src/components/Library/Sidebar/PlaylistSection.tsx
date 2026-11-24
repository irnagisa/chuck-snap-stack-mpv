import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useTranslation } from "react-i18next";
import { ListMusic, Sparkles, Trash2 } from "lucide-react";
import type { Playlist, SmartPlaylist } from "../../../types";
import { usePlaylistStore } from "../../../store/usePlaylistStore";
import { useLibraryStore, type RatingMode, type SortBy, type SortOrder, type WatchedStatus } from "../../../store/useLibraryStore";
import { toast } from "../../../store/useToastStore";
import { AddButton, EditorForm, MenuRow, SidebarSection, useConfirm } from "./parts";
import styles from "./Sidebar.module.css";

interface Props {
  search: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onOpenPlaylist: (playlist: Playlist) => void;
}

export function PlaylistSection({ search, open, onOpenChange, onOpenPlaylist }: Props) {
  const { t } = useTranslation();
  const playlists = usePlaylistStore((s) => s.playlists);
  const createPlaylist = usePlaylistStore((s) => s.createPlaylist);
  const deletePlaylist = usePlaylistStore((s) => s.deletePlaylist);
  const { confirm, dialog } = useConfirm();
  const [adding, setAdding] = useState(false);
  const [smartPlaylists, setSmartPlaylists] = useState<SmartPlaylist[]>([]);

  useEffect(() => {
    invoke<SmartPlaylist[]>("db_get_smart_playlists")
      .then(setSmartPlaylists)
      .catch((e: unknown) => toast.error(t("playlist.smartLoadError", { error: e instanceof Error ? e.message : String(e) })));
  }, [t]);

  const applySmartPlaylist = async (sp: SmartPlaylist) => {
    const s = useLibraryStore.getState();
    try {
      const f = JSON.parse(sp.filter_json);
      if (f.filterSearch !== undefined) await s.setSearch(f.filterSearch);
      if (f.filterCategoryId !== undefined) await s.setCategoryFilter(f.filterCategoryId);
      if (f.filterMinRating !== undefined) await s.setMinRating(f.filterMinRating);
      if (f.filterRatingMode !== undefined) await s.setRatingMode(f.filterRatingMode as RatingMode);
      if (f.filterHasAudio !== undefined) await s.setHasAudio(f.filterHasAudio);
      if (f.filterMinDuration !== undefined) await s.setMinDuration(f.filterMinDuration);
      if (f.filterMaxDuration !== undefined) await s.setMaxDuration(f.filterMaxDuration);
      if (f.filterWatchedStatus !== undefined) await s.setWatchedStatus(f.filterWatchedStatus as WatchedStatus);
      if (f.filterSortBy !== undefined && f.filterSortOrder !== undefined) {
        await s.setSort(f.filterSortBy as SortBy, f.filterSortOrder as SortOrder);
      }
    } catch {
      // 壊れた条件は無視する
    }
  };

  const q = search.toLowerCase();
  const shownPlaylists = q ? playlists.filter((p) => p.name.toLowerCase().includes(q)) : playlists;
  const shownSmart = q ? smartPlaylists.filter((p) => p.name.toLowerCase().includes(q)) : smartPlaylists;
  const hidden = !!search && shownPlaylists.length === 0 && shownSmart.length === 0;

  const deleteAction = (name: string, onDelete: () => Promise<void>) => ({
    key: "delete", label: t("playlist.delete"), icon: <Trash2 />, danger: true,
    onSelect: () => confirm({
      title: t("playlist.deleteConfirmTitle", { name }),
      description: t("playlist.deleteConfirmDescription"),
      confirmLabel: t("playlist.delete"),
      onConfirm: async () => {
        try {
          await onDelete();
        } catch (e) {
          toast.error(String(e));
        }
      },
    }),
  });

  return (
    <>
      {!hidden && (
        <SidebarSection
          title={t("playlist.title")}
          open={open || !!search}
          onOpenChange={onOpenChange}
          action={
            <AddButton label={t("playlist.create")} open={adding} onOpenChange={setAdding}>
              <EditorForm
                title={t("playlist.create")}
                placeholder={t("playlist.namePlaceholder")}
                submitLabel={t("category.add")}
                onSubmit={async ({ name }) => {
                  try {
                    await createPlaylist(name);
                    setAdding(false);
                  } catch (e) {
                    toast.error(String(e));
                  }
                }}
                onCancel={() => setAdding(false)}
              />
            </AddButton>
          }
        >
          <div className={styles.list}>
            {playlists.length === 0 && smartPlaylists.length === 0 && (
              <span className={styles.empty}>{t("playlist.empty")}</span>
            )}
            {shownPlaylists.map((pl) => (
              <MenuRow
                key={pl.id}
                moreLabel={t("sidebar.moreActions", { name: pl.name })}
                actions={[deleteAction(pl.name, () => deletePlaylist(pl.id))]}
              >
                <button type="button" className={styles.row} onClick={() => onOpenPlaylist(pl)}>
                  <span className={styles.iconBadge} data-neutral="">
                    <ListMusic className={styles.badgeIcon} aria-hidden />
                  </span>
                  <span className={styles.rowText}>{pl.name}</span>
                </button>
              </MenuRow>
            ))}
            {shownSmart.map((sp) => (
              <MenuRow
                key={`smart-${sp.id}`}
                moreLabel={t("sidebar.moreActions", { name: sp.name })}
                actions={[deleteAction(sp.name, async () => {
                  await invoke("db_delete_smart_playlist", { id: sp.id });
                  setSmartPlaylists((prev) => prev.filter((p) => p.id !== sp.id));
                })]}
              >
                <button
                  type="button"
                  className={styles.row}
                  title={t("playlist.applyFilter")}
                  onClick={() => applySmartPlaylist(sp)}
                >
                  <span className={styles.iconBadge} data-neutral="">
                    <Sparkles className={styles.badgeIcon} aria-hidden />
                  </span>
                  <span className={styles.rowText}>{sp.name}</span>
                </button>
              </MenuRow>
            ))}
          </div>
        </SidebarSection>
      )}
      {dialog}
    </>
  );
}
