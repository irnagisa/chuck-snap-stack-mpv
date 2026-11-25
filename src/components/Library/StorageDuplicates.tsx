import { useTranslation } from "react-i18next";
import { Fingerprint, LoaderCircle } from "lucide-react";
import { formatFileSize } from "../../utils/time";
import { Button } from "../ui";
import { StorageCandidateRow } from "./StorageCandidateRow";
import type { DuplicateGroup, DuplicateGroups } from "./storageTypes";
import modal from "./LibraryModal.module.css";
import styles from "./StorageModal.module.css";

/** 残すもの以外の id (おすすめの選択) */
export function suggestedIds(groups: DuplicateGroup[]): number[] {
  return groups.flatMap((g) => g.items.filter((i) => i.id !== g.keepId).map((i) => i.id));
}

interface Props {
  data: DuplicateGroups;
  selected: Set<number>;
  onToggle: (id: number, on: boolean) => void;
  onSelectSuggested: () => void;
  onClearSelection: () => void;
  onComputePhash: () => void;
  /** pHash の計算中の進み具合 */
  phashProgress: { done: number; total: number } | null;
  disabled: boolean;
}

/** 重複のグループ一覧。グループのすべてを選ぶことはできない (最低 1 つは残す) */
export function StorageDuplicates({
  data,
  selected,
  onToggle,
  onSelectSuggested,
  onClearSelection,
  onComputePhash,
  phashProgress,
  disabled,
}: Props) {
  const { t } = useTranslation();
  const hasClones = data.groups.some((g) => g.items.some((i) => i.cloneGroup != null));

  return (
    <div className={styles.dupList}>
      {hasClones && <p className={modal.callout}>{t("storage.dupCloneNote")}</p>}
      {(data.phashMissingCount > 0 || phashProgress) && (
        <div className={modal.callout}>
          <div className={styles.calloutBody}>
            <span>
              {phashProgress
                ? t("storage.dupPhashProgress", phashProgress)
                : t("storage.dupPhashMissing", { count: data.phashMissingCount })}
            </span>
            <Button variant="soft" size="sm" disabled={disabled || !!phashProgress} onClick={onComputePhash}>
              {phashProgress ? <LoaderCircle className={modal.spinner} aria-hidden /> : <Fingerprint aria-hidden />}
              {t("storage.dupPhashCompute")}
            </Button>
          </div>
        </div>
      )}

      {data.groups.length === 0 ? (
        <div className={modal.status}>{t("storage.candidatesEmpty")}</div>
      ) : (
        <>
          <div className={styles.dupActions}>
            {data.totalGroups > data.groups.length && (
              <span className={styles.headNote}>{t("storage.dupShowing", { shown: data.groups.length })}</span>
            )}
            <Button variant="ghost" size="sm" disabled={disabled || selected.size === 0} onClick={onClearSelection}>
              {t("storage.dupClearSelection")}
            </Button>
            <Button variant="soft" size="sm" disabled={disabled} onClick={onSelectSuggested}>
              {t("storage.dupSelectSuggested")}
            </Button>
          </div>

          {data.groups.map((group) => {
            const unselected = group.items.filter((i) => !selected.has(i.id)).length;
            return (
              <div key={group.keepId} className={modal.panel}>
                <div className={modal.panelHead}>
                  <span className={modal.badge} data-tone={group.exact ? undefined : "warning"}>
                    {group.exact ? t("storage.dupExact") : t("storage.dupSimilar")}
                  </span>
                  <span>{t("storage.itemsCount", { count: group.items.length })}</span>
                  <span className={styles.headNote}>
                    {t("storage.dupReclaimable", { size: formatFileSize(group.reclaimableBytes) })}
                  </span>
                </div>
                {group.items.map((item) => {
                  const checked = selected.has(item.id);
                  // 選ばれていない最後の 1 つは選べない
                  const lastOne = !checked && unselected === 1;
                  return (
                    <StorageCandidateRow
                      key={item.id}
                      item={item}
                      checked={checked}
                      onToggle={onToggle}
                      disabled={disabled || lastOne}
                      checkboxTitle={lastOne ? t("storage.dupKeepOne") : undefined}
                      badge={
                        <>
                          {item.cloneGroup != null && (
                            <span className={modal.badge} data-tone="warning" title={t("storage.dupCloneHint")}>
                              {t("storage.dupClone", { n: item.cloneGroup + 1 })}
                            </span>
                          )}
                          {item.id === group.keepId && <span className={modal.badge}>{t("storage.dupKeep")}</span>}
                        </>
                      }
                    />
                  );
                })}
              </div>
            );
          })}
        </>
      )}
    </div>
  );
}
