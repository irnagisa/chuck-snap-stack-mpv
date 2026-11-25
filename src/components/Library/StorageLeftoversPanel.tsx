import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { useTranslation } from "react-i18next";
import { FolderOpen, LoaderCircle, Trash2 } from "lucide-react";
import { toast } from "../../store/useToastStore";
import { formatFileSize } from "../../utils/time";
import { Button, ConfirmDialog } from "../ui";
import type { LeftoverCleanupResult, LeftoverFiles, LeftoverKind } from "./storageTypes";
import modal from "./LibraryModal.module.css";
import styles from "./StorageModal.module.css";

const KIND_LABEL: Record<LeftoverKind, string> = {
  download: "storage.leftoverKindDownload",
  transcode: "storage.leftoverKindTranscode",
  aiDownload: "storage.leftoverKindAiDownload",
};

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

interface Props {
  /** 変わったら探し直す (他の整理で状況が変わったとき) */
  refreshKey: unknown;
  disabled: boolean;
  onBusyChange: (busy: boolean) => void;
  /** 削除した後 (集計を取り直す) */
  onDeleted: () => Promise<void>;
}

/** 途中で止まったダウンロード・変換の残りファイル。ここで完全に削除できる */
export function StorageLeftoversPanel({ refreshKey, disabled, onBusyChange, onDeleted }: Props) {
  const { t } = useTranslation();
  const [data, setData] = useState<LeftoverFiles | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    try {
      setData(await invoke<LeftoverFiles>("get_leftover_files"));
      setError(null);
    } catch (e) {
      setError(errorText(e));
    }
  }, []);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  const files = data?.files ?? [];
  const shownBytes = files.reduce((s, f) => s + f.bytes, 0);

  const handleDelete = async () => {
    setDeleting(true);
    onBusyChange(true);
    try {
      const r = await invoke<LeftoverCleanupResult>("delete_leftover_files", { paths: files.map((f) => f.path) });
      toast.success(t("storage.leftoverDone", { count: r.removedFiles, size: formatFileSize(r.freedBytes) }));
      await onDeleted();
    } catch (e) {
      toast.error(t("storage.leftoverError", { error: errorText(e) }));
    } finally {
      setDeleting(false);
      onBusyChange(false);
    }
  };

  const reveal = (path: string) => {
    revealItemInDir(path).catch((e: unknown) => toast.error(t("detail.revealFailed", { error: errorText(e) })));
  };

  const stat = () => {
    if (error) return t("storage.leftoverLoadError", { error });
    if (!data) return t("storage.leftoverLoading");
    return t("storage.thumbsStat", { count: data.totalCount, size: formatFileSize(data.totalBytes) });
  };

  return (
    <section className={modal.panel}>
      <div className={styles.thumbsBody}>
        <div className={styles.thumbsText}>
          <h3 className={styles.heading}>{t("storage.leftoverHeading")}</h3>
          <p className={modal.note}>{t("storage.leftoverDesc")}</p>
          <dl className={styles.thumbStats}>
            <div>
              <dt>{t("storage.leftoverFound")}</dt>
              <dd>{stat()}</dd>
            </div>
          </dl>
        </div>
        <Button
          variant="danger"
          size="sm"
          disabled={files.length === 0 || disabled || deleting}
          onClick={() => setConfirmOpen(true)}
          title={data && files.length === 0 ? t("storage.leftoverNothing") : undefined}
        >
          {deleting || (!data && !error) ? <LoaderCircle className={modal.spinner} aria-hidden /> : <Trash2 aria-hidden />}
          {t("storage.leftoverDelete")}
        </Button>
      </div>

      {files.length > 0 && (
        <div className={styles.scrollList}>
          {files.map((f) => (
            <div key={f.path} className={styles.quarantineRow}>
              <span className={modal.badge}>{t(KIND_LABEL[f.kind])}</span>
              <span className={modal.fileText}>
                <span className={modal.filePath} title={f.path}>
                  {f.path}
                </span>
              </span>
              <span className={styles.size}>{formatFileSize(f.bytes)}</span>
              <Button variant="ghost" size="sm" onClick={() => reveal(f.path)} aria-label={t("storage.trashReveal")} title={t("storage.trashReveal")}>
                <FolderOpen aria-hidden />
              </Button>
            </div>
          ))}
        </div>
      )}
      {data && data.totalCount > files.length && (
        <p className={modal.note}>{t("storage.leftoverShowing", { shown: files.length })}</p>
      )}

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={t("storage.leftoverConfirmTitle", { count: files.length })}
        description={t("storage.leftoverConfirmDesc", { size: formatFileSize(shownBytes) })}
        confirmLabel={t("storage.trashEmptyConfirm")}
        cancelLabel={t("storage.cancel")}
        onConfirm={handleDelete}
        danger
      />
    </section>
  );
}
