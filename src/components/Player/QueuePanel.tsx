import { useTranslation } from "react-i18next";
import { useShallow } from 'zustand/shallow';
import { convertFileSrc } from '@tauri-apps/api/core';
import { usePlayerStore } from '../../store/usePlayerStore';
import { useModalStore } from '../../store/useModalStore';
import { X } from "lucide-react";
import { Button } from "../ui";
import styles from "./QueuePanel.module.css";

function formatTime(sec: number | null): string {
  if (!sec) return '--:--';
  const s = Math.floor(sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
  return `${m}:${String(ss).padStart(2, '0')}`;
}

// playerControls の高さ分だけ bottom をずらす (約 80px)
const PLAYER_HEIGHT = 84;

export function QueuePanel() {
  const { t } = useTranslation();
  const { queue, queueIndex, jumpToQueue, removeFromQueue } = usePlayerStore(
    useShallow((s) => ({
      queue: s.queue,
      queueIndex: s.queueIndex,
      jumpToQueue: s.jumpToQueue,
      removeFromQueue: s.removeFromQueue,
    }))
  );
  const { showQueuePanel, closeQueuePanel } = useModalStore(
    useShallow((s) => ({
      showQueuePanel: s.showQueuePanel,
      closeQueuePanel: s.closeQueuePanel,
    }))
  );

  if (!showQueuePanel || queue.length === 0) return null;

  return (
    <div
      className={styles.panel}
      style={{ bottom: PLAYER_HEIGHT }}
    >
      <div className={styles.header}>
        <span className={styles.title}>{t('queue.title', { count: queue.length })}</span>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={t('queue.close')}
          onClick={closeQueuePanel}
          title={t('queue.close')}
        >
          <X aria-hidden />
        </Button>
      </div>

      <ul className={styles.list}>
        {queue.map((video, idx) => {
          const isCurrent = idx === queueIndex;
          return (
            <li
              key={`${video.id}-${idx}`}
              className={styles.item}
              data-current={isCurrent || undefined}
              aria-current={isCurrent || undefined}
              onClick={() => jumpToQueue(idx)}
            >
              {/* サムネイル */}
              <div className={styles.thumb}>
                {video.thumbnail ? (
                  <img src={convertFileSrc(video.thumbnail)} alt="" />
                ) : (
                  <span aria-hidden>▶</span>
                )}
              </div>

              {/* タイトル + 時間 */}
              <div className={styles.text}>
                <p className={styles.name}>
                  {video.title ?? video.path.split('/').pop()}
                </p>
                <p className={styles.duration}>
                  {formatTime(video.duration)}
                </p>
              </div>

              {/* 削除ボタン (非現在曲のみ) */}
              {!isCurrent && (
                <Button
                  variant="danger-soft"
                  size="icon-sm"
                  className={styles.remove}
                  aria-label={t('queue.remove')}
                  onClick={(e) => {
                    e.stopPropagation();
                    removeFromQueue(video.id);
                  }}
                  title={t('queue.remove')}
                >
                  <X aria-hidden />
                </Button>
              )}
              {isCurrent && (
                <span className={styles.playing} aria-hidden>▶</span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
