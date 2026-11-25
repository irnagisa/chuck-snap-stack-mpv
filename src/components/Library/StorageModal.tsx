import { useCallback, useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useTranslation } from "react-i18next";
import { LoaderCircle, Sparkles, Star, Trash2 } from "lucide-react";
import { useLibraryStore } from "../../store/useLibraryStore";
import { toast } from "../../store/useToastStore";
import { formatFileSize, parseSqliteDate } from "../../utils/time";
import { Button, Checkbox, ConfirmDialog, Dialog, SegmentedControl, useDialogClose } from "../ui";
import { ThumbImage } from "./MediaThumb";
import modal from "./LibraryModal.module.css";
import styles from "./StorageModal.module.css";

// ── 型 (src-tauri/src/commands/storage.rs と対応) ─────────────────────────

interface SizeBucket {
  key: string;
  count: number;
  bytes: number;
}

interface StorageOverview {
  library: {
    count: number;
    bytes: number;
    unknownSizeCount: number;
    missingCount: number;
    byMediaType: SizeBucket[];
    byExtension: SizeBucket[];
  };
  thumbnails: {
    fileCount: number;
    bytes: number;
    orphanCount: number;
    orphanBytes: number;
    oversizedCount: number;
    oversizedBytes: number;
  };
  databaseBytes: number;
  aiModelBytes: number;
}

interface ThumbnailCleanupResult {
  removedOrphans: number;
  resetOversized: number;
  freedBytes: number;
}

type CandidateKind = "large" | "unwatched" | "staleInbox" | "longUnviewed";

interface CleanupItem {
  id: number;
  path: string;
  title: string | null;
  thumbnail: string | null;
  fileSize: number;
  mediaType: string;
  rating: number;
  watchCount: number;
  createdAt: string;
  lastSeenAt: string | null;
}

interface CleanupCandidates {
  totalCount: number;
  totalBytes: number;
  thresholdDays: number | null;
  items: CleanupItem[];
}

/** 一度に表示する整理候補の件数 */
const CANDIDATE_LIMIT = 200;
/** 拡張子の内訳で個別に出す件数 (残りは「その他」にまとめる) */
const EXTENSION_ROWS = 8;

const KIND_LABEL: Record<CandidateKind, string> = {
  large: "storage.kindLarge",
  unwatched: "storage.kindUnwatched",
  staleInbox: "storage.kindStaleInbox",
  longUnviewed: "storage.kindLongUnviewed",
};
const KIND_DESC: Record<CandidateKind, string> = {
  large: "storage.kindDescLarge",
  unwatched: "storage.kindDescUnwatched",
  staleInbox: "storage.kindDescStaleInbox",
  longUnviewed: "storage.kindDescLongUnviewed",
};
const MEDIA_LABEL: Record<string, string> = {
  video: "storage.mediaVideo",
  audio: "storage.mediaAudio",
  image: "storage.mediaImage",
};

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function fileName(path: string): string {
  return path.split("/").pop() ?? path;
}

function formatDate(value: string | null): string | null {
  return parseSqliteDate(value)?.toLocaleDateString() ?? null;
}

/** 容量の横棒グラフ */
function SizeBars({ items }: { items: { label: string; bytes: number; count: number }[] }) {
  const max = Math.max(...items.map((i) => i.bytes), 1);
  return (
    <div className={styles.bars}>
      {items.map((item) => (
        <div key={item.label} className={styles.barRow}>
          <span className={styles.barLabel} title={item.label}>
            {item.label}
          </span>
          <div className={styles.barTrack}>
            <div className={styles.barFill} style={{ width: `${(item.bytes / max) * 100}%` }} />
          </div>
          <span className={styles.barValue}>{formatFileSize(item.bytes)}</span>
        </div>
      ))}
    </div>
  );
}

interface Props {
  onClose: () => void;
}

/** ストレージの使用状況と整理 (容量の内訳・サムネイルの掃除・整理候補のゴミ箱移動) */
export function StorageModal({ onClose }: Props) {
  const { t } = useTranslation();
  const removeMultiple = useLibraryStore((s) => s.removeMultiple);
  const generateThumbnails = useLibraryStore((s) => s.generateThumbnails);

  const [overview, setOverview] = useState<StorageOverview | null>(null);
  const [overviewError, setOverviewError] = useState<string | null>(null);
  const [kind, setKind] = useState<CandidateKind>("large");
  const [candidates, setCandidates] = useState<CleanupCandidates | null>(null);
  const [candidatesLoading, setCandidatesLoading] = useState(true);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [cleaningThumbs, setCleaningThumbs] = useState(false);
  const [trashing, setTrashing] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const dialog = useDialogClose(onClose, { locked: trashing || cleaningThumbs });

  const loadOverview = useCallback(async () => {
    try {
      setOverview(await invoke<StorageOverview>("get_storage_overview"));
      setOverviewError(null);
    } catch (e) {
      setOverviewError(errorText(e));
    }
  }, []);

  const loadCandidates = useCallback(async (k: CandidateKind) => {
    setCandidatesLoading(true);
    try {
      setCandidates(await invoke<CleanupCandidates>("get_cleanup_candidates", { kind: k, limit: CANDIDATE_LIMIT }));
    } catch (e) {
      setCandidates(null);
      toast.error(t("storage.candidatesError", { error: errorText(e) }));
    } finally {
      setCandidatesLoading(false);
    }
  }, [t]);

  useEffect(() => {
    loadOverview();
  }, [loadOverview]);

  useEffect(() => {
    // 前の種類の一覧・基準日数を出したままにしない
    setCandidates(null);
    setSelected(new Set());
    loadCandidates(kind);
  }, [kind, loadCandidates]);

  // ── 内訳 ────────────────────────────────────────────────────────────────

  const mediaBars = useMemo(
    () =>
      (overview?.library.byMediaType ?? []).map((b) => ({
        label: MEDIA_LABEL[b.key] ? t(MEDIA_LABEL[b.key]) : b.key,
        bytes: b.bytes,
        count: b.count,
      })),
    [overview, t],
  );

  const extensionBars = useMemo(() => {
    const all = overview?.library.byExtension ?? [];
    const head = all.slice(0, EXTENSION_ROWS).map((b) => ({
      label: b.key ? `.${b.key}` : t("storage.noExtension"),
      bytes: b.bytes,
      count: b.count,
    }));
    const rest = all.slice(EXTENSION_ROWS);
    if (rest.length > 0) {
      head.push({
        label: t("storage.otherExtensions"),
        bytes: rest.reduce((s, b) => s + b.bytes, 0),
        count: rest.reduce((s, b) => s + b.count, 0),
      });
    }
    return head;
  }, [overview, t]);

  // ── サムネイルの整理 ────────────────────────────────────────────────────

  const thumbs = overview?.thumbnails;
  const hasThumbWork = !!thumbs && thumbs.orphanCount + thumbs.oversizedCount > 0;

  const handleCleanupThumbs = async () => {
    setCleaningThumbs(true);
    try {
      const r = await invoke<ThumbnailCleanupResult>("cleanup_thumbnails");
      toast.success(t("storage.thumbsDone", { size: formatFileSize(r.freedBytes) }));
      // 大きすぎて消したサムネイルは静止画で作り直す
      if (r.resetOversized > 0) {
        generateThumbnails().catch((e: unknown) => console.error("[StorageModal] generateThumbnails:", e));
      }
      await loadOverview();
    } catch (e) {
      toast.error(t("storage.thumbsError", { error: errorText(e) }));
    } finally {
      setCleaningThumbs(false);
    }
  };

  // ── 整理候補の選択とゴミ箱移動 ──────────────────────────────────────────

  const items = candidates?.items ?? [];
  const selectedItems = items.filter((i) => selected.has(i.id));
  const selectedBytes = selectedItems.reduce((s, i) => s + i.fileSize, 0);
  const allChecked = items.length > 0 && selectedItems.length === items.length;
  const headChecked = allChecked ? true : selectedItems.length > 0 ? "indeterminate" : false;

  const toggle = (id: number, on: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  const toggleAll = () => {
    setSelected(allChecked ? new Set() : new Set(items.map((i) => i.id)));
  };

  const handleTrash = async () => {
    setTrashing(true);
    try {
      // 返り値 [path, success][] を確認し、移動できたファイルだけライブラリから外す
      const results = await invoke<[string, boolean][]>("trash_multiple_video_files", {
        paths: selectedItems.map((i) => i.path),
      });
      const trashedPaths = new Set(results.filter(([, ok]) => ok).map(([p]) => p));
      const trashedIds = selectedItems.filter((i) => trashedPaths.has(i.path)).map((i) => i.id);
      const failCount = selectedItems.length - trashedIds.length;
      if (trashedIds.length > 0) {
        await removeMultiple(trashedIds);
        toast.success(t("storage.trashDone", { count: trashedIds.length }));
      }
      if (failCount > 0) toast.error(t("storage.trashFailed", { count: failCount }));
      setSelected(new Set());
      await Promise.all([loadCandidates(kind), loadOverview()]);
    } catch (e) {
      toast.error(t("storage.trashError", { error: errorText(e) }));
    } finally {
      setTrashing(false);
    }
  };

  // ── 描画 ────────────────────────────────────────────────────────────────

  const renderOverview = () => {
    if (overviewError) return <div className={modal.status}>{t("storage.error", { error: overviewError })}</div>;
    if (!overview) {
      return (
        <div className={modal.status}>
          <LoaderCircle className={modal.spinner} aria-hidden />
          {t("storage.loading")}
        </div>
      );
    }
    const { library } = overview;
    const tiles = [
      { label: t("storage.summaryLibrary"), value: formatFileSize(library.bytes), sub: t("storage.itemsCount", { count: library.count }) },
      { label: t("storage.summaryThumbnails"), value: formatFileSize(overview.thumbnails.bytes), sub: t("storage.itemsCount", { count: overview.thumbnails.fileCount }) },
      { label: t("storage.summaryDatabase"), value: formatFileSize(overview.databaseBytes) },
      { label: t("storage.summaryAiModel"), value: formatFileSize(overview.aiModelBytes) },
    ];
    return (
      <>
        <div className={styles.summary}>
          {tiles.map((tile) => (
            <div key={tile.label} className={styles.tile}>
              <p className={styles.tileLabel}>{tile.label}</p>
              <p className={styles.tileValue}>{tile.value}</p>
              {tile.sub && <p className={styles.tileSub}>{tile.sub}</p>}
            </div>
          ))}
        </div>
        {(library.unknownSizeCount > 0 || library.missingCount > 0) && (
          <p className={modal.note}>
            {library.unknownSizeCount > 0 && t("storage.unknownNote", { count: library.unknownSizeCount })}
            {library.unknownSizeCount > 0 && library.missingCount > 0 && " "}
            {library.missingCount > 0 && t("storage.missingNote", { count: library.missingCount })}
          </p>
        )}

        {library.count > 0 && (
          <div className={styles.cols2}>
            <section>
              <h3 className={styles.heading}>{t("storage.byMediaType")}</h3>
              <SizeBars items={mediaBars} />
            </section>
            <section>
              <h3 className={styles.heading}>{t("storage.byExtension")}</h3>
              <SizeBars items={extensionBars} />
            </section>
          </div>
        )}

        <section className={modal.panel}>
          <div className={styles.thumbsBody}>
            <div className={styles.thumbsText}>
              <h3 className={styles.heading}>{t("storage.thumbsHeading")}</h3>
              <p className={modal.note}>{t("storage.thumbsDesc")}</p>
              <dl className={styles.thumbStats}>
                <div>
                  <dt>{t("storage.thumbsOrphans")}</dt>
                  <dd>{t("storage.thumbsStat", { count: overview.thumbnails.orphanCount, size: formatFileSize(overview.thumbnails.orphanBytes) })}</dd>
                </div>
                <div>
                  <dt>{t("storage.thumbsOversized")}</dt>
                  <dd>{t("storage.thumbsStat", { count: overview.thumbnails.oversizedCount, size: formatFileSize(overview.thumbnails.oversizedBytes) })}</dd>
                </div>
              </dl>
            </div>
            <Button
              variant="soft"
              size="sm"
              disabled={!hasThumbWork || cleaningThumbs}
              onClick={handleCleanupThumbs}
              title={hasThumbWork ? undefined : t("storage.thumbsNothing")}
            >
              {cleaningThumbs ? <LoaderCircle className={modal.spinner} aria-hidden /> : <Sparkles aria-hidden />}
              {t("storage.thumbsCleanup")}
            </Button>
          </div>
        </section>
      </>
    );
  };

  const renderCandidates = () => {
    if (candidatesLoading && !candidates) {
      return (
        <div className={modal.status}>
          <LoaderCircle className={modal.spinner} aria-hidden />
          {t("storage.loading")}
        </div>
      );
    }
    if (!candidates || items.length === 0) {
      return <div className={modal.status}>{t("storage.candidatesEmpty")}</div>;
    }
    return (
      <div className={modal.panel}>
        <label className={modal.panelHead}>
          <Checkbox checked={headChecked} onCheckedChange={toggleAll} disabled={trashing} />
          <span>{t("storage.selectAll")}</span>
          {candidates.totalCount > items.length && (
            <span className={styles.headNote}>{t("storage.candidatesShowing", { shown: items.length })}</span>
          )}
        </label>
        {items.map((item) => {
          const checked = selected.has(item.id);
          const seen = formatDate(item.lastSeenAt);
          const added = formatDate(item.createdAt);
          return (
            <label key={item.id} className={modal.panelRow} data-selected={checked || undefined} data-tone="danger">
              <Checkbox checked={checked} onCheckedChange={(v) => toggle(item.id, v === true)} disabled={trashing} />
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
                </span>
              </span>
              <span className={styles.size}>{formatFileSize(item.fileSize)}</span>
            </label>
          );
        })}
      </div>
    );
  };

  return (
    <>
      <Dialog
        {...dialog.props}
        size="xl"
        title={t("storage.title")}
        closeLabel={t("confirm.close")}
        footer={
          <>
            <span className={`${modal.note} ${modal.footerLead}`}>
              {selectedItems.length > 0 &&
                t("storage.selectedSummary", { count: selectedItems.length, size: formatFileSize(selectedBytes) })}
            </span>
            <Button variant="secondary" disabled={trashing} onClick={() => dialog.close()}>
              {t("storage.close")}
            </Button>
            <Button variant="danger" disabled={selectedItems.length === 0 || trashing} onClick={() => setConfirmOpen(true)}>
              {trashing ? <LoaderCircle className={modal.spinner} aria-hidden /> : <Trash2 aria-hidden />}
              {t("storage.moveToTrash")}
            </Button>
          </>
        }
      >
        <div className={styles.root}>
          {renderOverview()}

          <section className={styles.candidates}>
            <div className={styles.candidatesHead}>
              <h3 className={styles.heading}>{t("storage.candidatesHeading")}</h3>
              <SegmentedControl
                aria-label={t("storage.candidatesHeading")}
                value={kind}
                onValueChange={setKind}
                options={(Object.keys(KIND_LABEL) as CandidateKind[]).map((k) => ({
                  value: k,
                  label: t(KIND_LABEL[k]),
                  disabled: trashing,
                }))}
              />
            </div>
            <p className={modal.note}>
              {t(KIND_DESC[kind], { days: candidates?.thresholdDays ?? 0 })}
              {candidates && candidates.totalCount > 0 && (
                <>
                  {" "}
                  <span className={modal.strong}>
                    {t("storage.candidatesSummary", { count: candidates.totalCount, size: formatFileSize(candidates.totalBytes) })}
                  </span>
                </>
              )}
            </p>
            {renderCandidates()}
          </section>
        </div>
      </Dialog>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={t("storage.confirmTitle", { count: selectedItems.length })}
        description={t("storage.confirmDesc", { size: formatFileSize(selectedBytes) })}
        confirmLabel={t("storage.moveToTrash")}
        cancelLabel={t("storage.cancel")}
        onConfirm={handleTrash}
        danger
      />
    </>
  );
}
