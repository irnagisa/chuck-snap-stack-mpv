import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Star } from "lucide-react";
import { formatFileSize, parseSqliteDate } from "../../utils/time";
import { Checkbox } from "../ui";
import { ThumbImage } from "./MediaThumb";
import type { CleanupItem } from "./storageTypes";
import modal from "./LibraryModal.module.css";
import styles from "./StorageModal.module.css";

function fileName(path: string): string {
  return path.split("/").pop() ?? path;
}

function formatDate(value: string | null): string | null {
  return parseSqliteDate(value)?.toLocaleDateString() ?? null;
}

interface Props {
  item: CleanupItem;
  checked: boolean;
  onToggle: (id: number, on: boolean) => void;
  disabled?: boolean;
  /** 名前の横に出すバッジ (重複の「残す」など) */
  badge?: ReactNode;
  /** 日付の後ろに足す情報 (ビットレートなど) */
  extraMeta?: ReactNode;
  /** チェックボックスの説明 (選べない理由など) */
  checkboxTitle?: string;
}

/** 整理候補の 1 行 (選んでゴミ箱へ移動する) */
export function StorageCandidateRow({ item, checked, onToggle, disabled, badge, extraMeta, checkboxTitle }: Props) {
  const { t } = useTranslation();
  const seen = formatDate(item.lastSeenAt);
  const added = formatDate(item.createdAt);
  return (
    <label className={modal.panelRow} data-selected={checked || undefined} data-tone="danger">
      <Checkbox
        checked={checked}
        onCheckedChange={(v) => onToggle(item.id, v === true)}
        disabled={disabled}
        title={checkboxTitle}
      />
      <span className={`${modal.miniThumb} ${modal.thumbBox}`}>
        {item.thumbnail && <ThumbImage src={item.thumbnail} alt="" />}
      </span>
      <span className={modal.fileText}>
        <span className={modal.fileName}>{item.title ?? fileName(item.path)}</span>
        <span className={modal.filePath}>{item.path}</span>
        <span className={styles.meta}>
          {item.rating > 0 && (
            <span className={styles.rating} aria-label={`★${item.rating}`}>
              <Star aria-hidden fill="currentColor" />
              {item.rating}
            </span>
          )}
          {seen ? t("storage.lastSeen", { date: seen }) : added && t("storage.addedAt", { date: added })}
          {extraMeta}
        </span>
      </span>
      {badge}
      <span className={styles.size}>{formatFileSize(item.fileSize)}</span>
    </label>
  );
}
