import type { InboxStack } from '../../store/useInboxStore';
import type { Video } from '../../types';
import { ArrowRight, Check, Play } from "lucide-react";
import { Button } from "../ui";
import { MediaThumb } from "../Library/MediaThumb";
import cardStyles from "../Library/VideoCard.module.css";
import homeStyles from "../Home/Home.module.css";
import styles from "./Inbox.module.css";

interface Props {
  stack: InboxStack;
  onOpen: () => void;
  onGraduate: () => void;
  onPlay: (v: Video) => void;
  onShowDetail: (v: Video) => void;
  selectedIds: Set<number>;
  onSelectionChange: (ids: Set<number>) => void;
}

export default function StackCard({
  stack,
  onOpen,
  onGraduate,
  onPlay,
  onShowDetail,
  selectedIds,
  onSelectionChange,
}: Props) {
  const stackTypeLabel: Record<string, string> = {
    source: '入手元',
    date: '日付',
    missing_metadata: '未設定項目',
    almost_done: 'ほぼ完了',
    directory: 'フォルダ',
    category: 'カテゴリ',
    tag: 'タグ',
    batch: 'バッチ',
  };

  const toggleSelect = (id: number) => {
    const next = new Set(selectedIds);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    onSelectionChange(next);
  };

  return (
    <div className={homeStyles.section}>
      {/* Stack header */}
      <div className={styles.stackHead}>
        <span className={styles.pill}>
          {stackTypeLabel[stack.stackType]}
        </span>
        <span
          className={styles.stackLabel}
          title={stack.stackType === 'directory' ? stack.groupKey : undefined}
        >
          {stack.label}
        </span>
        {stack.stackType === 'directory' && (
          <span className={styles.stackKey} title={stack.groupKey}>
            {stack.groupKey}
          </span>
        )}
        <span className={`${styles.pill} ${styles.pillCount}`}>
          {stack.count} 件
        </span>
        <div className={styles.stackActions}>
          <Button
            variant="ghost"
            size="sm"
            onClick={onGraduate}
            title="このスタックを全件整理完了にする"
          >
            全件完了
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={onOpen}
          >
            開く<ArrowRight aria-hidden />
          </Button>
        </div>
      </div>

      {/* Preview thumbnails */}
      <div className={homeStyles.strip}>
        {stack.videos.map((v) => {
          const isSelected = selectedIds.has(v.id);
          return (
            <div
              key={v.id}
              className={cardStyles.tile}
              data-selected={isSelected || undefined}
              onClick={() => onShowDetail(v)}
              onDoubleClick={(e) => { e.stopPropagation(); onPlay(v); }}
            >
              <MediaThumb video={v} compact>
                <div className={cardStyles.topLeft}>
                  <button
                    type="button"
                    className={`${cardStyles.check} ${cardStyles.hoverOnly}`}
                    data-checked={isSelected || undefined}
                    aria-label="選択"
                    aria-pressed={isSelected}
                    onClick={(e) => { e.stopPropagation(); toggleSelect(v.id); }}
                    onDoubleClick={(e) => e.stopPropagation()}
                  >
                    {isSelected && <Check aria-hidden />}
                  </button>
                </div>
                <button
                  type="button"
                  className={`${cardStyles.playButton} ${cardStyles.hoverOnly}`}
                  data-size="sm"
                  onClick={(e) => { e.stopPropagation(); onPlay(v); }}
                  onDoubleClick={(e) => e.stopPropagation()}
                  title="再生"
                  aria-label="再生"
                >
                  <Play aria-hidden fill="currentColor" />
                </button>
              </MediaThumb>
              <p className={cardStyles.tileTitle} title={v.title ?? undefined}>
                {v.title ?? v.path.split('/').pop()}
              </p>
            </div>
          );
        })}
        {stack.count > stack.videos.length && (
          <button type="button" className={cardStyles.tile} onClick={onOpen}>
            <div className={`${cardStyles.thumb} ${styles.more}`} data-compact="">
              <span className={styles.moreCount}>
                +{stack.count - stack.videos.length}
              </span>
            </div>
          </button>
        )}
      </div>
    </div>
  );
}
