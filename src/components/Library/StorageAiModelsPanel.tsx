import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useTranslation } from "react-i18next";
import { LoaderCircle, Trash2 } from "lucide-react";
import { toast } from "../../store/useToastStore";
import { formatFileSize } from "../../utils/time";
import { Button, ConfirmDialog } from "../ui";
import type { AiModelUsage } from "./storageTypes";
import modal from "./LibraryModal.module.css";
import styles from "./StorageModal.module.css";

const MODEL_LABEL: Record<AiModelUsage["modelType"], string> = {
  "wd-tagger": "settings.aiModelWdTagger",
  joytag: "settings.aiModelJoyTag",
};

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

interface Props {
  models: AiModelUsage[];
  /** 設定で AI タグ提案を有効にしているか */
  aiEnabled: boolean;
  disabled: boolean;
  onBusyChange: (busy: boolean) => void;
  /** 削除した後 (集計を取り直す) */
  onRemoved: () => Promise<void>;
}

/** ダウンロード済みの AI モデルの容量。使っていないモデルはここで削除できる */
export function StorageAiModelsPanel({ models, aiEnabled, disabled, onBusyChange, onRemoved }: Props) {
  const { t } = useTranslation();
  /** 削除を確認中のモデル (閉じるアニメーション中も文言を保つため、閉じても消さない) */
  const [target, setTarget] = useState<AiModelUsage | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);

  const inUse = (m: AiModelUsage) => aiEnabled && m.selected;

  const handleRemove = async () => {
    if (!target) return;
    setRemoving(target.modelType);
    onBusyChange(true);
    try {
      await invoke("uninstall_ai_model", { modelType: target.modelType });
      toast.success(t("storage.aiRemoveDone", { size: formatFileSize(target.bytes) }));
      await onRemoved();
    } catch (e) {
      toast.error(t("storage.aiRemoveError", { error: errorText(e) }));
    } finally {
      setRemoving(null);
      onBusyChange(false);
    }
  };

  return (
    <section className={modal.panel}>
      <div className={styles.thumbsBody}>
        <div className={styles.thumbsText}>
          <h3 className={styles.heading}>{t("storage.aiHeading")}</h3>
          <p className={modal.note}>{t("storage.aiDesc")}</p>
        </div>
      </div>

      {models.map((m) => (
        <div key={m.modelType} className={styles.quarantineRow}>
          <span className={modal.fileText}>
            <span className={modal.fileName}>{t(MODEL_LABEL[m.modelType])}</span>
          </span>
          <span className={modal.badge} data-tone={inUse(m) ? undefined : "warning"}>
            {inUse(m) ? t("storage.aiInUse") : t("storage.aiUnused")}
          </span>
          <span className={styles.size}>{formatFileSize(m.bytes)}</span>
          <Button
            variant="ghost"
            size="sm"
            disabled={disabled || removing !== null}
            onClick={() => {
              setTarget(m);
              setConfirmOpen(true);
            }}
            aria-label={t("storage.aiRemove")}
            title={t("storage.aiRemove")}
          >
            {removing === m.modelType ? <LoaderCircle className={modal.spinner} aria-hidden /> : <Trash2 aria-hidden />}
          </Button>
        </div>
      ))}

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={t("storage.aiRemoveConfirmTitle", { name: target ? t(MODEL_LABEL[target.modelType]) : "" })}
        description={
          target && inUse(target)
            ? t("storage.aiRemoveConfirmDescInUse", { size: formatFileSize(target.bytes) })
            : t("storage.aiRemoveConfirmDesc", { size: formatFileSize(target?.bytes ?? 0) })
        }
        confirmLabel={t("storage.aiRemoveConfirm")}
        cancelLabel={t("storage.cancel")}
        onConfirm={handleRemove}
        danger
      />
    </section>
  );
}
