import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useTranslation } from "react-i18next";
import { toast } from "../../store/useToastStore";
import { formatFileSize } from "../../utils/time";
import { Button, Checkbox, Dialog, SegmentedControl, Slider } from "../ui";
import {
  DEFAULT_PRESET,
  HEVC_PERCENT_RANGE,
  MIN_SAVING_PERCENT,
  PRESET_OPTIONS,
  enqueueTranscode,
  suggestCrf,
  type Av1Encoder,
  type TranscodeEstimate,
  type TranscodeMode,
} from "./transcodeJob";
import { bitrateKbps, type CleanupItem, type SilenceReport } from "./storageTypes";
import modal from "./LibraryModal.module.css";

/**
 * まとめて変換で選べる種類 (トラック整理は動画ごとに選ぶので対象外)。
 * dropSilent は無音と分かった音声トラックを外す (整理画面の無音の一覧から開いたときだけ)
 */
export type BatchKind = "av1" | "hevc" | "audio" | "dropSilent";
const DEFAULT_KINDS: BatchKind[] = ["av1", "hevc", "audio"];

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  items: CleanupItem[];
  /** 選べる種類 (既定は AV1 / HEVC / 音声だけ)。1 つだけなら切り替えを出さない */
  kinds?: BatchKind[];
  /** キューに追加した後 */
  onQueued: () => void;
}

/** 選んだ動画をまとめて変換のキューに入れる。AV1 の CRF は動画ごとにビットレートから決める */
export function TranscodeBatchDialog({ open, onOpenChange, items, kinds = DEFAULT_KINDS, onQueued }: Props) {
  const { t } = useTranslation();
  const firstKind = kinds[0];
  const [kind, setKind] = useState<BatchKind>(firstKind);
  const [preset, setPreset] = useState<string>(String(DEFAULT_PRESET));
  const [hevcPercent, setHevcPercent] = useState<number>(HEVC_PERCENT_RANGE.default);
  const [trashOriginal, setTrashOriginal] = useState(false);
  /** HEVC (VideoToolbox) が使えるか (先頭の動画で調べる) */
  const [hevcAvailable, setHevcAvailable] = useState<boolean | null>(null);
  /** AV1 に使うエンコーダー (先頭の動画で調べる)。undefined は未確認 (調べられなかったときも変換は止めない) */
  const [av1Encoder, setAv1Encoder] = useState<Av1Encoder | null | undefined>(undefined);
  const totalBytes = items.reduce((s, i) => s + i.fileSize, 0);
  const presetDesc = PRESET_OPTIONS.find((o) => String(o.value) === preset)?.descKey;
  const firstPath = items[0]?.path;
  // 開くたびに、その画面で選べる最初の種類から始める
  useEffect(() => {
    if (open) setKind(firstKind);
  }, [open, firstKind]);
  /** 無音のトラックを外すとき、外すトラックが分かっている動画 */
  const dropTargets = items.filter((i) => (i.silentStreams?.length ?? 0) > 0);
  const silentBytes = dropTargets.reduce((s, i) => s + (i.silentBytes ?? 0), 0);
  /** 簡易判定の動画 (外す前に全体を読んで確かめる) */
  const sampledCount = dropTargets.filter((i) => i.silentSampled).length;

  useEffect(() => {
    if (!open || !firstPath || hevcAvailable != null || !kinds.some((k) => k !== "dropSilent")) return;
    invoke<TranscodeEstimate>("estimate_transcode", { inputPath: firstPath })
      .then((e) => {
        setHevcAvailable(e.hevcAvailable);
        setAv1Encoder(e.av1Encoder);
      })
      .catch(() => setHevcAvailable(false));
  }, [open, firstPath, hevcAvailable]);

  const modeFor = (item: CleanupItem): TranscodeMode | null => {
    switch (kind) {
      case "dropSilent":
        return item.silentStreams?.length ? { kind: "dropStreams", streams: item.silentStreams } : null;
      case "av1": {
        const kbps = bitrateKbps(item);
        return { kind, crf: kbps != null ? suggestCrf(kbps).crf : 32, preset: Number(preset) };
      }
      case "hevc":
        return { kind, bitratePercent: hevcPercent };
      case "audio":
        return { kind };
    }
  };

  /**
   * 簡易判定で無音とした動画は、変換の直前にファイル全体を読んで確かめ、本当に無音のトラックだけ外す。
   * 音が見つかって外すものがなくなったら変換しない
   */
  const confirmSilent = (item: CleanupItem) => async (): Promise<TranscodeMode | null> => {
    const report = await invoke<SilenceReport>("detect_silent_audio", { videoId: item.id, thorough: true });
    if (report.silentStreams.length === 0) {
      toast.info(t("transcode.dropSilentNotSilent", { name: item.title ?? item.path.split("/").pop() ?? item.path }));
      return null;
    }
    return { kind: "dropStreams", streams: report.silentStreams };
  };

  const handleStart = () => {
    let added = 0;
    for (const item of items) {
      const mode = modeFor(item);
      if (!mode) continue;
      const ok = enqueueTranscode(
        {
          id: item.id,
          path: item.path,
          title: item.title,
          duration: item.duration,
        },
        mode,
        { trashOriginal, prepare: kind === "dropSilent" && item.silentSampled ? confirmSilent(item) : undefined },
      );
      if (ok) added++;
    }
    if (added > 0) toast.success(t("storage.batchQueued", { count: added }));
    if (added < items.length) toast.info(t("storage.batchSkipped", { count: items.length - added }));
    onOpenChange(false);
    onQueued();
  };

  const canStart =
    items.length > 0 &&
    (kind !== "hevc" || hevcAvailable === true) &&
    (kind !== "av1" || av1Encoder !== null) &&
    (kind !== "dropSilent" || dropTargets.length > 0);

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      size="md"
      title={t("storage.batchTitle", { count: items.length })}
      closeLabel={t("confirm.close")}
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t("storage.cancel")}
          </Button>
          <Button variant="primary" disabled={!canStart} onClick={handleStart}>
            {t("storage.batchStart")}
          </Button>
        </>
      }
    >
      <div className={modal.stack}>
        <p className={modal.note}>{t("storage.batchDesc", { size: formatFileSize(totalBytes) })}</p>

        {kinds.length > 1 && (
          <SegmentedControl
            aria-label={t("transcode.modeLabel")}
            value={kind}
            onValueChange={setKind}
            options={kinds.map((k) => ({ value: k, label: t(`transcode.mode_${k}`) }))}
          />
        )}

        {kind === "dropSilent" && (
          <div>
            <p className={modal.note}>{t("transcode.dropSilentDesc")}</p>
            {sampledCount > 0 && <p className={modal.note}>{t("transcode.dropSilentVerify", { count: sampledCount })}</p>}
            {silentBytes > 0 && (
              <p className={modal.hintAccent}>{t("transcode.audioSaving", { size: formatFileSize(silentBytes) })}</p>
            )}
          </div>
        )}

        {kind === "av1" && av1Encoder === null && (
          <p className={modal.callout} data-tone="warning">{t("transcode.av1Unavailable")}</p>
        )}
        {kind === "av1" && av1Encoder !== null && (
          <div>
            {av1Encoder === "aom" && <p className={modal.note}>{t("transcode.av1AomNote")}</p>}
            <p className={modal.label}>{t("transcode.presetLabel")}</p>
            <SegmentedControl
              aria-label={t("transcode.presetLabel")}
              value={preset}
              onValueChange={setPreset}
              options={PRESET_OPTIONS.map((o) => ({ value: String(o.value), label: t(o.labelKey) }))}
            />
            {presetDesc && <p className={modal.note}>{t(presetDesc)}</p>}
            <p className={modal.note}>{t("storage.batchCrfNote")}</p>
          </div>
        )}

        {kind === "hevc" &&
          (hevcAvailable === false ? (
            <p className={modal.callout} data-tone="warning">{t("transcode.hevcUnavailable")}</p>
          ) : (
            <div>
              <p className={modal.note}>{t("transcode.hevcDesc")}</p>
              <p className={modal.label}>
                {t("transcode.hevcBitrateLabel")}
                <span className={modal.labelHint}>{t("transcode.hevcBitrateHint")}</span>
              </p>
              <div className={modal.row}>
                <Slider
                  min={HEVC_PERCENT_RANGE.min}
                  max={HEVC_PERCENT_RANGE.max}
                  step={5}
                  value={[hevcPercent]}
                  onValueChange={([v]) => setHevcPercent(v)}
                  thumbLabel={t("transcode.hevcBitrateLabel")}
                  className={modal.grow}
                />
                <span className={modal.strong}>{hevcPercent}%</span>
              </div>
            </div>
          ))}

        {kind === "audio" && <p className={modal.note}>{t("transcode.audioDesc")}</p>}

        <div className={modal.stackTight}>
          <label className={modal.option}>
            <Checkbox checked={trashOriginal} onCheckedChange={(v) => setTrashOriginal(v === true)} />
            <span className={modal.strong}>{t("transcode.trashOriginal")}</span>
          </label>
          {trashOriginal && (
            <p className={modal.callout} data-tone="warning">{t("transcode.trashOriginalNote")}</p>
          )}
        </div>

        <p className={modal.note}>
          {kind === "audio" || kind === "dropSilent"
            ? t("transcode.discardNoteSmall")
            : t("transcode.discardNote", { percent: MIN_SAVING_PERCENT })}
        </p>
      </div>
    </Dialog>
  );
}
