import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useTranslation } from "react-i18next";
import { AudioLines, CircleStop, Gauge, LoaderCircle, Shrink, Sparkles, Trash2, VolumeX } from "lucide-react";
import { useLibraryStore } from "../../store/useLibraryStore";
import { useTranscodeStore } from "../../store/useTranscodeStore";
import { toast } from "../../store/useToastStore";
import { formatFileSize } from "../../utils/time";
import { Button, Checkbox, ConfirmDialog, Dialog, SegmentedControl, useDialogClose } from "../ui";
import { StorageAiModelsPanel } from "./StorageAiModelsPanel";
import { StorageCandidateRow } from "./StorageCandidateRow";
import { StorageDuplicates, suggestedIds } from "./StorageDuplicates";
import { StorageLeftoversPanel } from "./StorageLeftoversPanel";
import { StorageTrashPanel } from "./StorageTrashPanel";
import { checkSilence } from "./silenceCheck";
import { PHASH_CONCURRENCY, computePhash, type VideoForPhash } from "./phashCompute";
import { beginForegroundCheck } from "../../lib/foregroundChecks";
import { runPool } from "../../utils/runPool";
import { TranscodeBatchDialog, type BatchKind } from "./TranscodeBatchDialog";
import {
  bitrateKbps,
  freedBytes,
  roundedSavingPercent,
  type CandidateKind,
  type CleanupCandidates,
  type CleanupItem,
  type DuplicateGroups,
  type StorageOverview,
  type ThumbnailCleanupResult,
  type UncheckedVideo,
  type UnprobedVideo,
} from "./storageTypes";
import modal from "./LibraryModal.module.css";
import styles from "./StorageModal.module.css";

/** 一度に表示する整理候補の件数 */
const CANDIDATE_LIMIT = 200;
/** 無音の確認を一度に調べる件数 (大きいファイルから) */
const SILENCE_CHUNK = 100;
/** 無音の確認中、この件数ごとに一覧を読み直す */
const SILENCE_REFRESH_EVERY = 20;
/** 映像の情報 (ffprobe) を同時に調べる数。先頭を読むだけなので軽い */
const PROBE_CONCURRENCY = 4;
/** 映像の情報を調べている間、この件数ごとに一覧を読み直す */
const PROBE_REFRESH_EVERY = 50;
/** 減る割合の見積もりがこれ未満なら「あまり減らない」と出す (変換後に破棄される基準と同じ 15%) */
const LOW_SAVING_RATIO = 0.15;
/** 拡張子の内訳で個別に出す件数 (残りは「その他」にまとめる) */
const EXTENSION_ROWS = 8;

const KINDS: CandidateKind[] = [
  "large",
  "highBitrate",
  "duplicates",
  "silentAudio",
  "unwatched",
  "staleInbox",
  "longUnviewed",
];
const KIND_LABEL: Record<CandidateKind, string> = {
  large: "storage.kindLarge",
  highBitrate: "storage.kindHighBitrate",
  duplicates: "storage.kindDuplicates",
  silentAudio: "storage.kindSilentAudio",
  unwatched: "storage.kindUnwatched",
  staleInbox: "storage.kindStaleInbox",
  longUnviewed: "storage.kindLongUnviewed",
};
const KIND_DESC: Record<CandidateKind, string> = {
  large: "storage.kindDescLarge",
  highBitrate: "storage.kindDescHighBitrate",
  duplicates: "storage.kindDescDuplicates",
  silentAudio: "storage.kindDescSilentAudio",
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

/**
 * ストレージの使用状況と整理
 * (容量の内訳・サムネイルの掃除・ゴミ箱と退避フォルダ・整理候補のゴミ箱移動・重複の整理・まとめて AV1 変換)
 */
export function StorageModal({ onClose }: Props) {
  const { t } = useTranslation();
  const removeMultiple = useLibraryStore((s) => s.removeMultiple);
  const generateThumbnails = useLibraryStore((s) => s.generateThumbnails);
  const removedSourcePaths = useTranscodeStore((s) => s.removedSourcePaths);
  const discardedPaths = useTranscodeStore((s) => s.discardedPaths);

  const [overview, setOverview] = useState<StorageOverview | null>(null);
  const [overviewError, setOverviewError] = useState<string | null>(null);
  const [kind, setKind] = useState<CandidateKind>("large");
  const [loadedCandidates, setCandidates] = useState<CleanupCandidates | null>(null);
  const [dupes, setDupes] = useState<DuplicateGroups | null>(null);
  const [candidatesLoading, setCandidatesLoading] = useState(true);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [cleaningThumbs, setCleaningThumbs] = useState(false);
  /** ゴミ箱・AI モデル・残りファイルのパネルで削除中 */
  const [panelBusy, setPanelBusy] = useState(false);
  const [trashing, setTrashing] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [batchOpen, setBatchOpen] = useState(false);
  /** 変換ダイアログに渡す動画 (開いた時点の選択。閉じるアニメーション中も表示を保つ) */
  const [batchItems, setBatchItems] = useState<CleanupItem[]>([]);
  const [batchKinds, setBatchKinds] = useState<BatchKind[] | undefined>(undefined);
  const [phashProgress, setPhashProgress] = useState<{ done: number; total: number } | null>(null);
  /** 無音の音声トラックを調べている間の進み具合 */
  const [silenceProgress, setSilenceProgress] = useState<{ done: number; total: number } | null>(null);
  /** 止めるボタンを押し、いま調べている分の終わりを待っている */
  const [silenceStopping, setSilenceStopping] = useState(false);
  /** 高ビットレートの一覧で、映像の情報を調べている間の進み具合 */
  const [probeProgress, setProbeProgress] = useState<{ done: number; total: number } | null>(null);
  const dialog = useDialogClose(onClose, { locked: trashing || cleaningThumbs || panelBusy });

  /** 無音の確認中に別の種類へ切り替えたら、その一覧を無音の一覧で上書きしない */
  const kindRef = useRef(kind);
  kindRef.current = kind;
  /** 種類を切り替えたとき、前の種類の結果で上書きしないための番号 */
  const loadSeq = useRef(0);
  /** 閉じたら pHash の計算・無音の確認を止める */
  const phashCancelled = useRef(false);
  const silenceCancelled = useRef(false);
  const probeCancelled = useRef(false);
  /** 映像の情報を読めなかった動画 (この画面では試し直さない) */
  const probeFailed = useRef(new Set<number>());
  /** 高ビットレートの一覧を開いたときの自動の確認は、画面を開いている間に 1 回だけ */
  const probeAutoStarted = useRef(false);
  /** 閉じたあとは一覧の読み直しや通知をしない (止めるボタンとは分ける) */
  const silenceUnmounted = useRef(false);
  useEffect(
    () => () => {
      phashCancelled.current = true;
      silenceCancelled.current = true;
      probeCancelled.current = true;
      silenceUnmounted.current = true;
    },
    [],
  );

  const loadOverview = useCallback(async () => {
    try {
      setOverview(await invoke<StorageOverview>("get_storage_overview"));
      setOverviewError(null);
    } catch (e) {
      setOverviewError(errorText(e));
    }
  }, []);

  const loadCandidates = useCallback(async (k: CandidateKind) => {
    const seq = ++loadSeq.current;
    setCandidatesLoading(true);
    try {
      if (k === "duplicates") {
        const result = await invoke<DuplicateGroups>("get_duplicate_groups");
        if (seq === loadSeq.current) setDupes(result);
      } else {
        const result = await invoke<CleanupCandidates>("get_cleanup_candidates", { kind: k, limit: CANDIDATE_LIMIT });
        if (seq === loadSeq.current) setCandidates(result);
      }
    } catch (e) {
      if (seq === loadSeq.current) {
        setCandidates(null);
        setDupes(null);
      }
      toast.error(t("storage.candidatesError", { error: errorText(e) }));
    } finally {
      if (seq === loadSeq.current) setCandidatesLoading(false);
    }
  }, [t]);

  useEffect(() => {
    loadOverview();
  }, [loadOverview]);

  useEffect(() => {
    // 前の種類の一覧・基準日数を出したままにしない
    setCandidates(null);
    setDupes(null);
    setSelected(new Set());
    loadCandidates(kind);
  }, [kind, loadCandidates]);

  /**
   * 一覧を読み直さずにすぐ外す動画。変換をこの画面から始める高ビットレート・無音の一覧だけ
   * - 変換後に元ファイルをゴミ箱へ移した動画 (元ファイルを残した場合はそのまま表示する)
   * - 高ビットレートの一覧では、再エンコードしても縮まず変換後のファイルを破棄した動画も
   */
  const candidates = useMemo(() => {
    if (!loadedCandidates || (kind !== "highBitrate" && kind !== "silentAudio")) return loadedCandidates;
    const hidden = (path: string) =>
      removedSourcePaths.has(path) || (kind === "highBitrate" && discardedPaths.has(path));
    const removed = loadedCandidates.items.filter((i) => hidden(i.path));
    if (removed.length === 0) return loadedCandidates;
    return {
      ...loadedCandidates,
      items: loadedCandidates.items.filter((i) => !hidden(i.path)),
      totalCount: Math.max(0, loadedCandidates.totalCount - removed.length),
      totalBytes: Math.max(0, loadedCandidates.totalBytes - removed.reduce((s, i) => s + i.fileSize, 0)),
    };
  }, [loadedCandidates, kind, removedSourcePaths, discardedPaths]);

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

  // ── 重複: pHash の計算 ──────────────────────────────────────────────────

  const handleComputePhash = async () => {
    phashCancelled.current = false;
    const end = beginForegroundCheck();
    try {
      const pending = await invoke<VideoForPhash[]>("db_get_videos_without_phash");
      setPhashProgress({ done: 0, total: pending.length });
      // 読めないファイルは飛ばす (次回また試す)
      await runPool(pending, async (v) => void (await computePhash(v)), {
        concurrency: PHASH_CONCURRENCY,
        isCancelled: () => phashCancelled.current,
        onProgress: (done, total) => {
          if (!phashCancelled.current) setPhashProgress({ done, total });
        },
      });
    } catch (e) {
      toast.error(t("storage.candidatesError", { error: errorText(e) }));
    } finally {
      end();
      setPhashProgress(null);
    }
    if (!phashCancelled.current) await loadCandidates("duplicates");
  };

  // ── 無音の音声トラック: まだ調べていない動画を調べる ────────────────────

  /** `limit` 件 (省くとすべて) を大きい順に調べる。調べた分は途中でも一覧に出す */
  const handleCheckSilence = async (limit?: number) => {
    silenceCancelled.current = false;
    let lastRefresh = 0;
    try {
      const pending = await invoke<UncheckedVideo[]>("get_videos_without_silence_check", { limit: limit ?? null });
      setSilenceProgress({ done: 0, total: pending.length });
      const result = await checkSilence(
        pending.map((v) => v.id),
        {
          isCancelled: () => silenceCancelled.current,
          onProgress: (done, total) => {
            setSilenceProgress({ done, total });
            if (done - lastRefresh >= SILENCE_REFRESH_EVERY && !silenceUnmounted.current && kindRef.current === "silentAudio") {
              lastRefresh = done;
              void loadCandidates("silentAudio");
            }
          },
        },
      );
      if (!silenceUnmounted.current) {
        toast.success(t("storage.silenceDone", { count: result.done, found: result.found }));
        if (result.failed > 0) toast.error(t("storage.silenceFailed", { count: result.failed }));
      }
    } catch (e) {
      toast.error(t("storage.candidatesError", { error: errorText(e) }));
    } finally {
      setSilenceProgress(null);
      setSilenceStopping(false);
    }
    if (!silenceUnmounted.current && kindRef.current === "silentAudio") await loadCandidates("silentAudio");
  };

  // ── 高ビットレート: 映像の情報を調べて、減る割合を見積もれるようにする ───

  const handleProbe = useCallback(async () => {
    probeCancelled.current = false;
    const end = beginForegroundCheck();
    try {
      const pending = (await invoke<UnprobedVideo[]>("get_videos_without_probe", { limit: null })).filter(
        (v) => !probeFailed.current.has(v.id),
      );
      if (pending.length === 0) return;
      setProbeProgress({ done: 0, total: pending.length });
      let lastRefresh = 0;
      await runPool(
        pending,
        async (v) => {
          try {
            await invoke("probe_video_info", { videoId: v.id });
          } catch (e) {
            probeFailed.current.add(v.id);
            console.debug("[StorageModal] probe_video_info:", v.id, e);
          }
        },
        {
          concurrency: PROBE_CONCURRENCY,
          isCancelled: () => probeCancelled.current,
          onProgress: (done, total) => {
            if (silenceUnmounted.current) return;
            setProbeProgress({ done, total });
            if (done - lastRefresh >= PROBE_REFRESH_EVERY && kindRef.current === "highBitrate") {
              lastRefresh = done;
              void loadCandidates("highBitrate");
            }
          },
        },
      );
    } catch (e) {
      if (!silenceUnmounted.current) toast.error(t("storage.candidatesError", { error: errorText(e) }));
    } finally {
      end();
      if (!silenceUnmounted.current) setProbeProgress(null);
    }
    if (!silenceUnmounted.current && kindRef.current === "highBitrate") await loadCandidates("highBitrate");
  }, [loadCandidates, t]);

  // 高ビットレートの一覧を開いたら、まだ調べていない分を自動で調べる (ffprobe は先頭を読むだけで軽い)
  const unprobedCount = kind === "highBitrate" ? (candidates?.uncheckedCount ?? 0) : 0;
  useEffect(() => {
    if (unprobedCount === 0 || probeAutoStarted.current) return;
    probeAutoStarted.current = true;
    void handleProbe();
  }, [unprobedCount, handleProbe]);

  // ── 整理候補の選択とゴミ箱移動 ──────────────────────────────────────────

  const items: CleanupItem[] = useMemo(
    () => (kind === "duplicates" ? (dupes?.groups.flatMap((g) => g.items) ?? []) : (candidates?.items ?? [])),
    [kind, dupes, candidates],
  );
  const selectedItems = items.filter((i) => selected.has(i.id));
  // 重複は APFS のクローンで共有している分を除いた、空く見込みの容量
  const selectedBytes = useMemo(
    () =>
      kind === "duplicates"
        ? (dupes?.groups ?? []).reduce((s, g) => s + freedBytes(g.items, (i) => selected.has(i.id)), 0)
        : items.filter((i) => selected.has(i.id)).reduce((s, i) => s + i.fileSize, 0),
    [kind, dupes, items, selected],
  );
  const selectedSilentBytes = selectedItems.reduce((s, i) => s + (i.silentBytes ?? 0), 0);
  const allChecked = items.length > 0 && selectedItems.length === items.length;
  const headChecked = allChecked ? true : selectedItems.length > 0 ? "indeterminate" : false;
  const busy = trashing || !!phashProgress || !!silenceProgress;

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

        <StorageTrashPanel
          trash={overview.trash}
          disabled={trashing || panelBusy}
          onBusyChange={setPanelBusy}
          onEmptied={loadOverview}
        />

        <StorageLeftoversPanel
          refreshKey={overview}
          disabled={trashing || panelBusy}
          onBusyChange={setPanelBusy}
          onDeleted={loadOverview}
        />

        {overview.aiModels.length > 0 && (
          <StorageAiModelsPanel
            models={overview.aiModels}
            aiEnabled={overview.aiEnabled}
            disabled={trashing || panelBusy}
            onBusyChange={setPanelBusy}
            onRemoved={loadOverview}
          />
        )}
      </>
    );
  };

  /** 無音の一覧の上に出す、まだ調べていない動画の案内 (一部だけ・すべて・途中で止める) */
  const renderSilenceCheck = () => {
    const unchecked = candidates?.uncheckedCount ?? 0;
    if (kind !== "silentAudio" || (unchecked === 0 && !silenceProgress)) return null;
    return (
      <div className={modal.callout}>
        <div className={styles.calloutBody}>
          <span>
            {silenceProgress
              ? t("storage.silenceProgress", silenceProgress)
              : t("storage.silenceUnchecked", { count: unchecked })}
          </span>
          {silenceProgress ? (
            <Button
              variant="secondary"
              size="sm"
              disabled={silenceStopping}
              onClick={() => {
                silenceCancelled.current = true;
                setSilenceStopping(true);
              }}
            >
              {silenceStopping ? <LoaderCircle className={modal.spinner} aria-hidden /> : <CircleStop aria-hidden />}
              {t(silenceStopping ? "storage.silenceStopping" : "storage.silenceStop")}
            </Button>
          ) : (
            <span className={styles.calloutActions}>
              {unchecked > SILENCE_CHUNK && (
                <Button variant="soft" size="sm" disabled={busy} onClick={() => handleCheckSilence(SILENCE_CHUNK)}>
                  <AudioLines aria-hidden />
                  {t("storage.silenceCheckSome", { count: SILENCE_CHUNK })}
                </Button>
              )}
              <Button
                variant={unchecked > SILENCE_CHUNK ? "secondary" : "soft"}
                size="sm"
                disabled={busy}
                onClick={() => handleCheckSilence()}
              >
                {unchecked <= SILENCE_CHUNK && <AudioLines aria-hidden />}
                {t(unchecked > SILENCE_CHUNK ? "storage.silenceCheckAll" : "storage.silenceCheck")}
              </Button>
            </span>
          )}
        </div>
      </div>
    );
  };

  /** 高ビットレートの一覧の上に出す、映像の情報を調べている進み具合 (または調べていない動画の案内) */
  const renderProbeCheck = () => {
    if (kind !== "highBitrate" || (unprobedCount === 0 && !probeProgress)) return null;
    return (
      <div className={modal.callout}>
        <div className={styles.calloutBody}>
          <span>
            {probeProgress
              ? t("storage.probeProgress", probeProgress)
              : t("storage.probeUnchecked", { count: unprobedCount })}
          </span>
          {probeProgress ? (
            <Button variant="secondary" size="sm" onClick={() => {
                probeCancelled.current = true;
              }}>
              <CircleStop aria-hidden />
              {t("storage.silenceStop")}
            </Button>
          ) : (
            <Button variant="soft" size="sm" disabled={busy} onClick={() => void handleProbe()}>
              <Gauge aria-hidden />
              {t("storage.probeCheck")}
            </Button>
          )}
        </div>
      </div>
    );
  };

  const savingMeta = (item: CleanupItem) => {
    const kbps = bitrateKbps(item);
    const ratio = item.savingRatio;
    return (
      <>
        {kbps != null && <span>· {t("storage.bitrate", { mbps: (kbps / 1000).toFixed(1) })}</span>}
        {ratio != null && (
          <span className={ratio >= LOW_SAVING_RATIO ? styles.savingHigh : undefined}>
            ·{" "}
            {ratio >= LOW_SAVING_RATIO
              ? t("storage.savingEstimate", { percent: roundedSavingPercent(ratio) })
              : t("storage.savingLow")}
          </span>
        )}
      </>
    );
  };

  const silentMeta = (item: CleanupItem) => {
    const count = item.silentStreams?.length ?? 0;
    if (count === 0) return null;
    return (
      <span>
        · {t("storage.silentTracks", { count })}
        {item.silentSampled && <> ({t("storage.silentSampled")})</>}
        {(item.silentBytes ?? 0) > 0 && <> · {t("storage.silentFreed", { size: formatFileSize(item.silentBytes ?? 0) })}</>}
      </span>
    );
  };

  const renderList = () => {
    if (!candidates || items.length === 0) {
      return (
        <>
          {renderSilenceCheck()}
          {renderProbeCheck()}
          <div className={modal.status}>{t("storage.candidatesEmpty")}</div>
        </>
      );
    }
    return (
      <>
      {renderSilenceCheck()}
      {renderProbeCheck()}
      <div className={modal.panel}>
        <label className={modal.panelHead}>
          <Checkbox checked={headChecked} onCheckedChange={toggleAll} disabled={busy} />
          <span>{t("storage.selectAll")}</span>
          {candidates.totalCount > items.length && (
            <span className={styles.headNote}>
              {t(kind === "highBitrate" ? "storage.candidatesShowingBitrate" : "storage.candidatesShowing", { shown: items.length })}
            </span>
          )}
        </label>
        {items.map((item) => (
          <StorageCandidateRow
            key={item.id}
            item={item}
            checked={selected.has(item.id)}
            onToggle={toggle}
            disabled={busy}
            extraMeta={kind === "silentAudio" ? silentMeta(item) : kind === "highBitrate" ? savingMeta(item) : null}
          />
        ))}
      </div>
      </>
    );
  };

  const renderCandidates = () => {
    const loaded = kind === "duplicates" ? dupes : candidates;
    if (candidatesLoading && !loaded) {
      return (
        <div className={modal.status}>
          <LoaderCircle className={modal.spinner} aria-hidden />
          {t(kind === "duplicates" ? "storage.dupLoading" : "storage.loading")}
        </div>
      );
    }
    if (kind !== "duplicates") return renderList();
    if (!dupes) return <div className={modal.status}>{t("storage.candidatesEmpty")}</div>;
    return (
      <StorageDuplicates
        data={dupes}
        selected={selected}
        onToggle={toggle}
        onSelectSuggested={() => setSelected(new Set(suggestedIds(dupes.groups)))}
        onClearSelection={() => setSelected(new Set())}
        onComputePhash={handleComputePhash}
        phashProgress={phashProgress}
        disabled={busy}
      />
    );
  };

  const renderSummary = () => {
    if (kind === "duplicates") {
      return dupes && dupes.totalGroups > 0 ? (
        <span className={modal.strong}>
          {t("storage.dupSummary", { groups: dupes.totalGroups, size: formatFileSize(dupes.totalReclaimableBytes) })}
        </span>
      ) : null;
    }
    return candidates && candidates.totalCount > 0 ? (
      <span className={modal.strong}>
        {t(kind === "silentAudio" ? "storage.silentSummary" : "storage.candidatesSummary", {
          count: candidates.totalCount,
          size: formatFileSize(candidates.totalBytes),
        })}
      </span>
    ) : null;
  };

  const summary = renderSummary();

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
                (kind === "silentAudio"
                  ? t("storage.silentSelectedSummary", {
                      count: selectedItems.length,
                      size: formatFileSize(selectedSilentBytes),
                    })
                  : t(kind === "duplicates" ? "storage.dupSelectedSummary" : "storage.selectedSummary", {
                      count: selectedItems.length,
                      size: formatFileSize(selectedBytes),
                    }))}
            </span>
            <Button variant="secondary" disabled={trashing} onClick={() => dialog.close()}>
              {t("storage.close")}
            </Button>
            {kind === "highBitrate" && (
              <Button
                variant="soft"
                disabled={selectedItems.length === 0 || busy}
                onClick={() => {
                  setBatchItems(selectedItems);
                  setBatchKinds(undefined);
                  setBatchOpen(true);
                }}
              >
                <Shrink aria-hidden />
                {t("storage.convertAv1")}
              </Button>
            )}
            {kind === "silentAudio" && (
              <Button
                variant="soft"
                disabled={selectedItems.length === 0 || busy}
                onClick={() => {
                  setBatchItems(selectedItems);
                  setBatchKinds(["dropSilent"]);
                  setBatchOpen(true);
                }}
              >
                <VolumeX aria-hidden />
                {t("storage.dropSilent")}
              </Button>
            )}
            <Button variant="danger" disabled={selectedItems.length === 0 || busy} onClick={() => setConfirmOpen(true)}>
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
                options={KINDS.map((k) => ({
                  value: k,
                  label: t(KIND_LABEL[k]),
                  disabled: busy,
                }))}
              />
            </div>
            <p className={modal.note}>
              {t(KIND_DESC[kind], {
                days: candidates?.thresholdDays ?? 0,
                mbps: ((candidates?.minBitrateKbps ?? 0) / 1000).toFixed(0),
              })}
              {summary && <> {summary}</>}
            </p>
            {kind === "highBitrate" && <p className={modal.note}>{t("storage.savingDisclaimer")}</p>}
            {renderCandidates()}
          </section>
        </div>
      </Dialog>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={t("storage.confirmTitle", { count: selectedItems.length })}
        description={t(kind === "duplicates" ? "storage.confirmDescDup" : "storage.confirmDesc", {
          size: formatFileSize(selectedBytes),
        })}
        confirmLabel={t("storage.moveToTrash")}
        cancelLabel={t("storage.cancel")}
        onConfirm={handleTrash}
        danger
      />

      <TranscodeBatchDialog
        open={batchOpen}
        onOpenChange={setBatchOpen}
        items={batchItems}
        kinds={batchKinds}
        onQueued={() => setSelected(new Set())}
      />
    </>
  );
}
