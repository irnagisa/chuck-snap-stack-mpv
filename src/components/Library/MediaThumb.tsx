import type { ReactNode } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { Film, Image as ImageIcon, Link2, Music } from "lucide-react";
import type { Video } from "../../types";
import { formatTime } from "../../utils/time";
import styles from "./VideoCard.module.css";

interface MediaThumbProps {
  video: Video;
  /** 小さい表示 (リスト行・横並びのプレビュー) */
  compact?: boolean;
  showDuration?: boolean;
  showProgress?: boolean;
  className?: string;
  /** サムネイル上に重ねる要素 (チェック・再生ボタンなど) */
  children?: ReactNode;
  "data-size"?: string;
}

/** 視聴進捗 (%)。表示不要なら 0 */
export function progressPercentOf(v: Video): number {
  if (v.duration && v.duration > 0) return Math.min((v.progress / v.duration) * 100, 100);
  return v.progress > 0 ? 100 : 0;
}

export function MediaTypeIcon({ type }: { type: Video["media_type"] }) {
  if (type === "link") return <Link2 aria-hidden />;
  if (type === "image") return <ImageIcon aria-hidden />;
  if (type === "audio") return <Music aria-hidden />;
  return <Film aria-hidden />;
}

/**
 * 角丸のサムネイル。グリッドカード以外 (リスト行・ホーム・Inbox) で共通に使う。
 * 再生時間のピルと視聴進捗バーを重ねて表示する。
 */
export function MediaThumb({
  video: v,
  compact = false,
  showDuration = true,
  showProgress = true,
  className,
  children,
  "data-size": dataSize,
}: MediaThumbProps) {
  const progress = showProgress ? progressPercentOf(v) : 0;
  const duration =
    showDuration && v.media_type !== "image" && v.media_type !== "link" && v.duration != null && v.duration > 0
      ? formatTime(v.duration)
      : null;

  return (
    <div
      className={className ? `${styles.thumb} ${className}` : styles.thumb}
      data-compact={compact || undefined}
      data-size={dataSize}
    >
      {v.thumbnail ? (
        <img src={convertFileSrc(v.thumbnail)} alt={v.title ?? ""} loading="lazy" />
      ) : (
        <div className={styles.placeholder}>
          <MediaTypeIcon type={v.media_type} />
        </div>
      )}
      {duration && (
        <div className={styles.bottomLeft}>
          <span className={styles.pill}>{duration}</span>
        </div>
      )}
      {progress > 0 && (
        <div className={styles.progress}>
          <div className={styles.progressBar} style={{ width: `${progress}%` }} />
        </div>
      )}
      {children}
    </div>
  );
}
