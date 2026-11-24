import { useTranslation } from "react-i18next";
import { useShallow } from "zustand/shallow";
import { Folder, FolderX, RefreshCw, RotateCw } from "lucide-react";
import { useLibraryStore } from "../../../store/useLibraryStore";
import { toast } from "../../../store/useToastStore";
import { Button } from "../../ui";
import { MenuRow, SidebarSection, useConfirm } from "./parts";
import styles from "./Sidebar.module.css";

interface Props {
  search: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedDir: string | null;
  onSelect: (dir: string | null) => void;
}

function basename(path: string): string {
  return path.replace(/\\/g, "/").replace(/\/$/, "").split("/").pop() ?? path;
}

export function FolderSection({ search, open, onOpenChange, selectedDir, onSelect }: Props) {
  const { t } = useTranslation();
  const { watchDirs, busy, removeWatchDir, rescanAllDirs } = useLibraryStore(useShallow((s) => ({
    watchDirs: s.watchDirs,
    busy: s.isScanning || s.isThumbnailGenerating,
    removeWatchDir: s.removeWatchDir,
    rescanAllDirs: s.rescanAllDirs,
  })));
  const { confirm, dialog } = useConfirm();

  const q = search.toLowerCase();
  const dirs = q ? watchDirs.filter((d) => d.toLowerCase().includes(q)) : watchDirs;
  const hidden = !!search && dirs.length === 0;

  return (
    <>
      {!hidden && (
        <SidebarSection
          title={t("watchDir.title")}
          open={open || !!search}
          onOpenChange={onOpenChange}
          active={selectedDir !== null}
          action={
            <Button
              variant="ghost"
              size="icon-sm"
              title={t("watchDir.rescanAll")}
              aria-label={t("watchDir.rescanAll")}
              disabled={busy || watchDirs.length === 0}
              onClick={() => rescanAllDirs()}
            >
              <RefreshCw aria-hidden className={busy ? styles.spinning : undefined} />
            </Button>
          }
        >
          <div className={styles.list}>
            {dirs.length === 0 && <span className={styles.empty}>{t("watchDir.empty")}</span>}
            {dirs.map((dir) => {
              const selected = selectedDir === dir;
              const name = basename(dir);
              return (
                <MenuRow
                  key={dir}
                  moreLabel={t("sidebar.moreActions", { name })}
                  actions={[
                    { key: "rescan", label: t("watchDir.rescan"), icon: <RotateCw />, disabled: busy, onSelect: () => rescanAllDirs(dir) },
                    {
                      key: "unwatch", label: t("watchDir.unwatch"), icon: <FolderX />, danger: true, separated: true,
                      onSelect: () => confirm({
                        title: t("watchDir.unwatchConfirmTitle", { name }),
                        description: t("watchDir.unwatchConfirmDescription"),
                        confirmLabel: t("watchDir.unwatch"),
                        onConfirm: async () => {
                          try {
                            await removeWatchDir(dir);
                          } catch (e) {
                            toast.error(String(e));
                          }
                        },
                      }),
                    },
                  ]}
                >
                  <button
                    type="button"
                    className={styles.row}
                    data-selected={selected || undefined}
                    aria-current={selected || undefined}
                    title={dir}
                    onClick={() => onSelect(selected ? null : dir)}
                  >
                    <span className={styles.iconBadge} data-neutral="">
                      <Folder className={styles.badgeIcon} aria-hidden />
                    </span>
                    <span className={styles.rowText}>{name}</span>
                  </button>
                </MenuRow>
              );
            })}
          </div>
        </SidebarSection>
      )}
      {dialog}
    </>
  );
}
