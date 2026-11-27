import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { AnimatePresence, motion } from "motion/react";
import { ListChecks } from "lucide-react";
import { useLibraryStore } from "../../store/useLibraryStore";
import { useTranscodeStore } from "../../store/useTranscodeStore";
import { useDownloadStore } from "../../store/useDownloadStore";
import { Button, Popover, Tooltip, motionPresets } from "../ui";
import { DownloadActivity, ThumbnailActivity, TranscodeActivity } from "./ActivityItems";
import { useActivitySummary } from "./useActivitySummary";
import styles from "./Activity.module.css";

const { popIn, presenceProps, transitions } = motionPresets;

/**
 * ヘッダーの作業アイコン (ブラウザのダウンロードボタンのようなもの)。
 * 作業があるあいだだけ出て、進み具合を輪と件数で見せる。押すと作業の一覧を開く
 */
export function ActivityButton() {
  const { t } = useTranslation();
  const summary = useActivitySummary();
  const [open, setOpen] = useState(false);
  const visible = summary.running > 0 || summary.finished > 0 || open;

  const status =
    summary.running > 0
      ? t("activity.running", { count: summary.running })
      : summary.failed
        ? t("activity.failed")
        : summary.finished > 0
          ? t("activity.finished")
          : "";
  const label = status ? `${t("activity.label")} (${status})` : t("activity.label");

  return (
    <AnimatePresence initial={false}>
      {visible && (
        <motion.div key="activity" variants={popIn} {...presenceProps}>
          <Popover.Root open={open} onOpenChange={setOpen}>
            <Tooltip content={label} side="bottom">
              <Popover.Trigger asChild>
                <Button variant="ghost" size="icon" className={styles.trigger} aria-label={label}>
                  <ListChecks aria-hidden />
                  {summary.running > 0 && <ProgressRing percent={summary.percent} />}
                  {summary.running > 0 ? (
                    <span className={styles.badge} aria-hidden>
                      {summary.running > 99 ? "99+" : summary.running}
                    </span>
                  ) : summary.finished > 0 ? (
                    <span className={styles.dot} data-tone={summary.failed ? "error" : undefined} aria-hidden />
                  ) : null}
                </Button>
              </Popover.Trigger>
            </Tooltip>
            <Popover.Content align="end" className={styles.panel}>
              <ActivityPanel />
            </Popover.Content>
          </Popover.Root>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/** アイコンの周りの輪。percent が null のあいだは短い弧を回す */
function ProgressRing({ percent }: { percent: number | null }) {
  return (
    <svg className={styles.ring} viewBox="0 0 36 36" data-indeterminate={percent == null || undefined} aria-hidden>
      <circle className={styles.ringTrack} cx="18" cy="18" r="16" pathLength={100} />
      <motion.circle
        className={styles.ringFill}
        cx="18"
        cy="18"
        r="16"
        pathLength={100}
        strokeDasharray="100 100"
        initial={false}
        animate={{ strokeDashoffset: 100 - (percent ?? 25) }}
        transition={transitions.normal}
      />
    </svg>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className={styles.section}>
      <h3 className={styles.sectionTitle}>{title}</h3>
      {children}
    </section>
  );
}

function ActivityPanel() {
  const { t } = useTranslation();
  const thumbnails = useLibraryStore((s) => s.isThumbnailGenerating);
  const transcode = useTranscodeStore((s) => s.current != null || s.isDone);
  const dismissTranscode = useTranscodeStore((s) => s.dismiss);
  const jobs = useDownloadStore((s) => s.jobs);
  const clearFinishedDownloads = useDownloadStore((s) => s.clearFinished);
  const { finished } = useActivitySummary();

  const isEmpty = !thumbnails && !transcode && jobs.length === 0;

  return (
    <>
      <div className={styles.panelHead}>
        <h2 className={styles.panelTitle}>{t("activity.title")}</h2>
        <Button
          size="xs"
          variant="ghost"
          disabled={finished === 0}
          onClick={() => {
            dismissTranscode();
            clearFinishedDownloads();
          }}
        >
          {t("activity.clearFinished")}
        </Button>
      </div>

      {isEmpty && <p className={styles.empty}>{t("activity.empty")}</p>}
      {thumbnails && (
        <Section title={t("activity.thumbnails")}>
          <ThumbnailActivity />
        </Section>
      )}
      {transcode && (
        <Section title={t("activity.transcode")}>
          <TranscodeActivity />
        </Section>
      )}
      {jobs.length > 0 && (
        <Section title={t("activity.downloads")}>
          <DownloadActivity jobs={jobs} />
        </Section>
      )}
    </>
  );
}
