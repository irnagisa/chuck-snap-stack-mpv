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
  type TranscodeEstimate,
  type TranscodeMode,
} from "./transcodeJob";
import { bitrateKbps, type CleanupItem } from "./storageTypes";
import modal from "./LibraryModal.module.css";

/** まとめて変換で選べる種類 (トラック整理は動画ごとに選ぶので対象外) */
type BatchKind = "av1" | "hevc" | "audio";
const BATCH_KINDS: BatchKind[] = ["av1", "hevc", "audio"];

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  items: CleanupItem[];
  /** キューに追加した後 */
  onQueued: () => void;
}

/** 選んだ動画をまとめて変換のキューに入れる。AV1 の CRF は動画ごとにビットレートから決める */
export function TranscodeBatchDialog({ open, onOpenChange, items, onQueued }: Props) {
  const { t } = useTranslation();
  const [kind, setKind] = useState<BatchKind>("av1");
  const [preset, setPreset] = useState<string>(String(DEFAULT_PRESET));
  const [hevcPercent, setHevcPercent] = useState<number>(HEVC_PERCENT_RANGE.default);
  const [trashOriginal, setTrashOriginal] = useState(false);
  /** HEVC (VideoToolbox) が使えるか (先頭の動画で調べる) */
  const [hevcAvailable, setHevcAvailable] = useState<boolean | null>(null);
  const totalBytes = items.reduce((s, i) => s + i.fileSize, 0);
  const presetDesc = PRESET_OPTIONS.find((o) => String(o.value) === preset)?.descKey;
  const firstPath = items[0]?.path;

  useEffect(() => {
    if (!open || !firstPath || hevcAvailable != null) return;
    invoke<TranscodeEstimate>("estimate_transcode", { inputPath: firstPath })
      .then((e) => setHevcAvailable(e.hevcAvailable))
      .catch(() => setHevcAvailable(false));
  }, [open, firstPath, hevcAvailable]);

  const modeFor = (item: CleanupItem): TranscodeMode => {
    switch (kind) {
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

  const handleStart = () => {
    let added = 0;
    for (const item of items) {
      const ok = enqueueTranscode(
        {
          id: item.id,
          path: item.path,
          title: item.title,
          duration: item.duration,
          categoryId: item.categoryId,
          rating: item.rating,
          createdAt: item.createdAt || null,
        },
        modeFor(item),
        { trashOriginal },
      );
      if (ok) added++;
    }
    if (added > 0) toast.success(t("storage.batchQueued", { count: added }));
    if (added < items.length) toast.info(t("storage.batchSkipped", { count: items.length - added }));
    onOpenChange(false);
    onQueued();
  };

  const canStart = items.length > 0 && (kind !== "hevc" || hevcAvailable === true);

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

        <SegmentedControl
          aria-label={t("transcode.modeLabel")}
          value={kind}
          onValueChange={setKind}
          options={BATCH_KINDS.map((k) => ({ value: k, label: t(`transcode.mode_${k}`) }))}
        />

        {kind === "av1" && (
          <div>
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
          {kind === "audio" ? t("transcode.discardNoteSmall") : t("transcode.discardNote", { percent: MIN_SAVING_PERCENT })}
        </p>
      </div>
    </Dialog>
  );
}
