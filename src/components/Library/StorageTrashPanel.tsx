import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { useTranslation } from "react-i18next";
import { FolderOpen, LoaderCircle, Trash2 } from "lucide-react";
import { toast } from "../../store/useToastStore";
import { formatFileSize } from "../../utils/time";
import { Button, ConfirmDialog } from "../ui";
import type { QuarantineCleanupResult, TrashUsage } from "./storageTypes";
import modal from "./LibraryModal.module.css";
import styles from "./StorageModal.module.css";

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

interface Props {
  trash: TrashUsage;
  disabled: boolean;
  onBusyChange: (busy: boolean) => void;
  /** 退避フォルダを空にした後 (集計を取り直す) */
  onEmptied: () => Promise<void>;
}

/** ゴミ箱と退避フォルダの容量。退避フォルダはここで完全に削除できる */
export function StorageTrashPanel({ trash, disabled, onBusyChange, onEmptied }: Props) {
  const { t } = useTranslation();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [emptying, setEmptying] = useState(false);
  const quarantineCount = trash.quarantine.reduce((s, q) => s + q.fileCount, 0);

  const handleEmpty = async () => {
    setEmptying(true);
    onBusyChange(true);
    try {
      const r = await invoke<QuarantineCleanupResult>("empty_quarantine", {
        dirs: trash.quarantine.map((q) => q.path),
      });
      toast.success(t("storage.trashEmptyDone", { size: formatFileSize(r.freedBytes) }));
      await onEmptied();
    } catch (e) {
      toast.error(t("storage.trashEmptyError", { error: errorText(e) }));
    } finally {
      setEmptying(false);
      onBusyChange(false);
    }
  };

  const reveal = (path: string) => {
    revealItemInDir(path).catch((e: unknown) => toast.error(t("detail.revealFailed", { error: errorText(e) })));
  };

  return (
    <section className={modal.panel}>
      <div className={styles.thumbsBody}>
        <div className={styles.thumbsText}>
          <h3 className={styles.heading}>{t("storage.trashHeading")}</h3>
          <p className={modal.note}>{t("storage.trashDesc")}</p>
          <dl className={styles.thumbStats}>
            <div>
              <dt>{t("storage.trashOs")}</dt>
              <dd>{trash.osTrashBytes != null ? formatFileSize(trash.osTrashBytes) : t("storage.trashOsUnknown")}</dd>
            </div>
            <div>
              <dt>{t("storage.trashQuarantine")}</dt>
              <dd>{t("storage.thumbsStat", { count: quarantineCount, size: formatFileSize(trash.quarantineBytes) })}</dd>
            </div>
          </dl>
          <p className={modal.note}>
            {trash.osTrashBytes == null ? t("storage.trashOsUnknownHint") : t("storage.trashOsHint")}
          </p>
        </div>
        <Button
          variant="danger"
          size="sm"
          disabled={quarantineCount === 0 || disabled || emptying}
          onClick={() => setConfirmOpen(true)}
          title={quarantineCount === 0 ? t("storage.trashQuarantineEmpty") : undefined}
        >
          {emptying ? <LoaderCircle className={modal.spinner} aria-hidden /> : <Trash2 aria-hidden />}
          {t("storage.trashEmptyQuarantine")}
        </Button>
      </div>

      {trash.quarantine.map((q) => (
        <div key={q.path} className={styles.quarantineRow}>
          <span className={modal.fileText}>
            <span className={modal.filePath}>{q.path}</span>
          </span>
          <span className={styles.size}>
            {t("storage.thumbsStat", { count: q.fileCount, size: formatFileSize(q.bytes) })}
          </span>
          <Button variant="ghost" size="sm" onClick={() => reveal(q.path)} aria-label={t("storage.trashReveal")} title={t("storage.trashReveal")}>
            <FolderOpen aria-hidden />
          </Button>
        </div>
      ))}

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={t("storage.trashEmptyConfirmTitle")}
        description={t("storage.trashEmptyConfirmDesc", { count: quarantineCount, size: formatFileSize(trash.quarantineBytes) })}
        confirmLabel={t("storage.trashEmptyConfirm")}
        cancelLabel={t("storage.cancel")}
        onConfirm={handleEmpty}
        danger
      />
    </section>
  );
}
