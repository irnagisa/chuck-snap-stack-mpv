import type { InboxStack } from '../../store/useInboxStore';
import type { Video } from '../../types';
import { ArrowRight, Check, Play } from "lucide-react";
import { Button } from "../ui";
import { MediaThumb } from "../Library/MediaThumb";
import cardStyles from "../Library/VideoCard.module.css";
import homeStyles from "../Home/Home.module.css";

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
      <div className="flex items-center gap-2 mb-2">
        <span className="px-2 h-5 inline-flex items-center rounded-full bg-gray-100 dark:bg-gray-800 text-[10px] font-semibold text-gray-500 dark:text-gray-400">
          {stackTypeLabel[stack.stackType]}
        </span>
        <span
          className="font-semibold text-sm text-gray-800 dark:text-gray-200"
          title={stack.stackType === 'directory' ? stack.groupKey : undefined}
        >
          {stack.label}
        </span>
        {stack.stackType === 'directory' && (
          <span className="text-[10px] text-gray-400 dark:text-gray-500 truncate min-w-0 max-w-xs" title={stack.groupKey}>
            {stack.groupKey}
          </span>
        )}
        <span className="px-2 h-5 inline-flex items-center rounded-full bg-blue-50 dark:bg-blue-950/50 text-[11px] font-bold text-blue-700 dark:text-blue-300 tabular-nums">
          {stack.count} 件
        </span>
        <div className="ml-auto flex gap-1">
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
            <div className={`${cardStyles.thumb} grid place-items-center`} data-compact="">
              <span className="text-sm font-bold text-gray-500 dark:text-gray-400">
                +{stack.count - stack.videos.length}
              </span>
            </div>
          </button>
        )}
      </div>
    </div>
  );
}
