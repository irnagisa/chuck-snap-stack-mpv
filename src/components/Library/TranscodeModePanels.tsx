import { useTranslation } from "react-i18next";
import { formatFileSize } from "../../utils/time";
import { Checkbox, Input, Slider } from "../ui";
import { HEVC_PERCENT_RANGE, PRESET_OPTIONS, isEfficientCodec, type StreamSummary, type TranscodeEstimate } from "./transcodeJob";
import styles from "./LibraryModal.module.css";

/** 映像を再エンコードしても縮みにくいときの警告 */
function VideoWarning({ estimate, kind }: { estimate: TranscodeEstimate | null; kind: "av1" | "hevc" }) {
  const { t } = useTranslation();
  if (!estimate) return null;
  let text: string | null = null;
  if (kind === "av1" && estimate.verdict === "alreadyAv1") {
    text = t("transcode.estimateAlreadyAv1");
  } else if (kind === "hevc" && isEfficientCodec(estimate.videoCodec)) {
    text = t("transcode.estimateAlreadyEfficient", { codec: estimate.videoCodec?.toUpperCase() ?? "" });
  } else if (estimate.verdict === "lowBitrate") {
    text = t("transcode.estimateLowBitrate", {
      codec: estimate.videoCodec?.toUpperCase() ?? "",
      kbps: estimate.videoBitrateKbps?.toFixed(0) ?? "?",
      resolution: estimate.width && estimate.height ? `${estimate.width}×${estimate.height}` : "",
    });
  }
  return text ? <p className={styles.callout} data-tone="warning">{text}</p> : null;
}

// ── AV1 ─────────────────────────────────────────────────────────────────────

interface Av1Props {
  estimate: TranscodeEstimate | null;
  inputSizeBytes: number | null;
  crf: number;
  onCrfChange: (crf: number) => void;
  crfReasonKey: string;
  preset: number;
  onPresetChange: (preset: number) => void;
}

export function Av1Panel({ estimate, inputSizeBytes, crf, onCrfChange, crfReasonKey, preset, onPresetChange }: Av1Props) {
  const { t } = useTranslation();
  if (estimate && !estimate.av1Encoder) {
    return <p className={styles.callout} data-tone="warning">{t("transcode.av1Unavailable")}</p>;
  }
  return (
    <>
      <VideoWarning estimate={estimate} kind="av1" />
      {estimate?.av1Encoder === "aom" && <p className={styles.note}>{t("transcode.av1AomNote")}</p>}
      <div>
        <p className={styles.label}>
          {t("transcode.crfLabel")}
          <span className={styles.labelHint}>{t("transcode.crfHint")}</span>
        </p>
        <div className={styles.row}>
          <Slider
            min={0}
            max={63}
            value={[crf]}
            onValueChange={([v]) => onCrfChange(v)}
            thumbLabel={t("transcode.crfLabel")}
            className={styles.grow}
          />
          <Input
            size="sm"
            className={styles.numberInput}
            inputClassName={styles.center}
            type="number"
            min={0}
            max={63}
            value={crf}
            onChange={(e) => onCrfChange(Math.min(63, Math.max(0, Number(e.target.value))))}
            aria-label={t("transcode.crfLabel")}
          />
        </div>
        {crfReasonKey && (
          <p className={styles.hintAccent}>{t("transcode.crfSuggestion", { crf, reason: t(crfReasonKey) })}</p>
        )}
        {inputSizeBytes != null && (
          <p className={styles.note}>
            {t("transcode.crfEstimate", { min: formatFileSize(inputSizeBytes * 0.4), max: formatFileSize(inputSizeBytes * 0.6) })}
          </p>
        )}
      </div>

      <div>
        <p className={styles.label}>{t("transcode.presetLabel")}</p>
        <div className={styles.cardGrid} role="radiogroup" aria-label={t("transcode.presetLabel")}>
          {PRESET_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              role="radio"
              aria-checked={preset === opt.value}
              className={styles.optionCard}
              data-selected={preset === opt.value || undefined}
              onClick={() => onPresetChange(opt.value)}
            >
              <span className={styles.optionCardTitle}>{t(opt.labelKey)}</span>
              <span className={styles.optionCardDesc}>{t(opt.descKey)}</span>
            </button>
          ))}
        </div>
      </div>
    </>
  );
}

// ── HEVC ────────────────────────────────────────────────────────────────────

interface HevcProps {
  estimate: TranscodeEstimate | null;
  percent: number;
  onPercentChange: (percent: number) => void;
}

export function HevcPanel({ estimate, percent, onPercentChange }: HevcProps) {
  const { t } = useTranslation();
  if (estimate && !estimate.hevcAvailable) {
    return <p className={styles.callout} data-tone="warning">{t("transcode.hevcUnavailable")}</p>;
  }
  const sourceKbps = estimate?.videoBitrateKbps ?? null;
  return (
    <>
      <VideoWarning estimate={estimate} kind="hevc" />
      <p className={styles.note}>{t("transcode.hevcDesc")}</p>
      <div>
        <p className={styles.label}>
          {t("transcode.hevcBitrateLabel")}
          <span className={styles.labelHint}>{t("transcode.hevcBitrateHint")}</span>
        </p>
        <div className={styles.row}>
          <Slider
            min={HEVC_PERCENT_RANGE.min}
            max={HEVC_PERCENT_RANGE.max}
            step={5}
            value={[percent]}
            onValueChange={([v]) => onPercentChange(v)}
            thumbLabel={t("transcode.hevcBitrateLabel")}
            className={styles.grow}
          />
          <span className={styles.strong}>{percent}%</span>
        </div>
        {sourceKbps != null ? (
          <p className={styles.note}>
            {t("transcode.hevcTarget", {
              target: ((sourceKbps * percent) / 100 / 1000).toFixed(1),
              source: (sourceKbps / 1000).toFixed(1),
            })}
          </p>
        ) : (
          estimate && <p className={styles.callout} data-tone="warning">{t("transcode.hevcNoBitrate")}</p>
        )}
      </div>
    </>
  );
}

// ── 音声だけ ────────────────────────────────────────────────────────────────

function audioLabel(a: { codec: string; channels: number | null; bitRateKbps: number | null; language: string | null; title: string | null }) {
  return [
    a.codec.toUpperCase(),
    a.channels ? `${a.channels}ch` : null,
    a.bitRateKbps ? `${a.bitRateKbps.toFixed(0)} kbps` : null,
    a.language,
    a.title,
  ]
    .filter(Boolean)
    .join(" · ");
}

export function AudioPanel({ estimate }: { estimate: TranscodeEstimate | null }) {
  const { t } = useTranslation();
  if (!estimate) return null;
  if (estimate.audio.length === 0) {
    return <p className={styles.callout} data-tone="warning">{t("transcode.audioNone")}</p>;
  }
  const anyEncode = estimate.audio.some((a) => a.opusKbps != null);
  return (
    <>
      <p className={styles.note}>{t("transcode.audioDesc")}</p>
      <ul className={styles.infoBox}>
        {estimate.audio.map((a) => (
          <li key={a.index}>
            <b>#{a.index}</b> {audioLabel(a)} →{" "}
            {a.opusKbps != null ? t("transcode.audioToOpus", { kbps: a.opusKbps }) : t("transcode.audioKeep")}
          </li>
        ))}
      </ul>
      {anyEncode ? (
        estimate.audioSavingBytes > 0 && (
          <p className={styles.hintAccent}>{t("transcode.audioSaving", { size: formatFileSize(estimate.audioSavingBytes) })}</p>
        )
      ) : (
        <p className={styles.callout} data-tone="warning">{t("transcode.audioNothing")}</p>
      )}
    </>
  );
}

// ── トラック整理・切り詰め ──────────────────────────────────────────────────

function streamLabel(s: StreamSummary, t: (key: string) => string): string {
  const type = s.coverArt ? t("transcode.streamCover") : t(`transcode.stream_${s.codecType}`);
  return [
    type,
    s.codecName.toUpperCase(),
    s.width && s.height && !s.coverArt ? `${s.width}×${s.height}` : null,
    s.channels ? `${s.channels}ch` : null,
    s.bitRateKbps ? `${s.bitRateKbps.toFixed(0)} kbps` : null,
    s.language,
    s.title,
  ]
    .filter(Boolean)
    .join(" · ");
}

interface RemuxProps {
  estimate: TranscodeEstimate | null;
  kept: Set<number>;
  onToggle: (index: number, on: boolean) => void;
  startText: string;
  endText: string;
  onStartChange: (text: string) => void;
  onEndChange: (text: string) => void;
  /** 入力の誤り (なければ null) */
  error: string | null;
  durationLabel: string;
}

export function RemuxPanel({ estimate, kept, onToggle, startText, endText, onStartChange, onEndChange, error, durationLabel }: RemuxProps) {
  const { t } = useTranslation();
  if (!estimate) return null;
  const mainVideos = estimate.streams.filter((s) => s.codecType === "video" && !s.coverArt);
  const keptMainVideos = mainVideos.filter((s) => kept.has(s.index)).length;
  return (
    <>
      <p className={styles.note}>{t("transcode.remuxDesc")}</p>
      <div>
        <p className={styles.label}>{t("transcode.remuxTracks")}</p>
        <div className={styles.optionList}>
          {estimate.streams.map((s) => {
            const checked = s.remuxable && kept.has(s.index);
            // 最後の映像は外せない
            const locked = !s.remuxable || (checked && s.codecType === "video" && !s.coverArt && keptMainVideos <= 1);
            return (
              <label key={s.index} className={styles.option} data-disabled={!s.remuxable || undefined}>
                <Checkbox checked={checked} disabled={locked} onCheckedChange={(v) => onToggle(s.index, v === true)} />
                <span className={styles.optionLabel}>
                  #{s.index} {streamLabel(s, t)}
                  {!s.remuxable && <span className={styles.labelHint}>{t("transcode.streamDropped")}</span>}
                </span>
              </label>
            );
          })}
        </div>
      </div>
      <div>
        <p className={styles.label}>
          {t("transcode.trimLabel")}
          <span className={styles.labelHint}>{t("transcode.trimHint", { duration: durationLabel })}</span>
        </p>
        <div className={styles.row}>
          <Input
            size="sm"
            value={startText}
            onChange={(e) => onStartChange(e.target.value)}
            placeholder="0:00"
            aria-label={t("transcode.trimStart")}
          />
          <span>〜</span>
          <Input
            size="sm"
            value={endText}
            onChange={(e) => onEndChange(e.target.value)}
            placeholder={durationLabel}
            aria-label={t("transcode.trimEnd")}
          />
        </div>
        <p className={styles.note}>{t("transcode.trimNote")}</p>
      </div>
      {error && <p className={styles.callout} data-tone="warning">{error}</p>}
    </>
  );
}
