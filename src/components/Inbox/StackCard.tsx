import { convertFileSrc } from '@tauri-apps/api/core';
import type { InboxStack } from '../../store/useInboxStore';
import type { Video } from '../../types';

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
    <div className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
      {/* Stack header */}
      <div className="flex items-center gap-2 px-3 py-2 bg-gray-50 dark:bg-gray-900">
        <span className="text-[10px] text-gray-400 dark:text-gray-500 uppercase tracking-wide">
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
        <span className="text-xs text-gray-500 dark:text-gray-400 ml-1">{stack.count} 件</span>
        <div className="ml-auto flex gap-1">
          <button
            type="button"
            className="text-xs px-2 py-1 rounded text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700"
            onClick={onGraduate}
            title="このスタックを全件整理完了にする"
          >
            全件完了
          </button>
          <button
            type="button"
            className="text-xs px-2.5 py-1 rounded bg-blue-600 hover:bg-blue-700 text-white"
            onClick={onOpen}
          >
            開く →
          </button>
        </div>
      </div>

      {/* Preview thumbnails */}
      <div className="flex gap-1.5 p-2 overflow-x-auto">
        {stack.videos.map((v) => {
          const isSelected = selectedIds.has(v.id);
          return (
            <div
              key={v.id}
              className={`relative shrink-0 w-32 h-20 rounded overflow-hidden bg-gray-100 dark:bg-gray-800 cursor-pointer group border-2 transition-all ${
                isSelected ? 'border-blue-400 dark:border-blue-500' : 'border-transparent hover:border-gray-300 dark:hover:border-gray-600'
              }`}
              onClick={() => onShowDetail(v)}
              onDoubleClick={(e) => { e.stopPropagation(); onPlay(v); }}
            >
              {v.thumbnail ? (
                <img
                  src={convertFileSrc(v.thumbnail)}
                  alt={v.title ?? ''}
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-gray-400 dark:text-gray-600 text-lg">
                  {v.media_type === 'image' ? '🖼' : v.media_type === 'audio' ? '♪' : '▶'}
                </div>
              )}
              {/* チェックボックス（ホバー時 or 選択時に表示） */}
              <div
                className={`absolute top-0.5 left-0.5 transition-opacity ${isSelected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}
                onClick={(e) => { e.stopPropagation(); toggleSelect(v.id); }}
              >
                <div className={`w-4 h-4 rounded border-2 flex items-center justify-center text-white text-[8px] font-bold transition-colors ${
                  isSelected ? 'bg-blue-500 border-blue-500' : 'bg-black/40 border-white/70 hover:bg-black/60'
                }`}>
                  {isSelected && '✓'}
                </div>
              </div>
              {/* hover ボタン（右下・ライブラリと統一） */}
              <div className="absolute bottom-1 right-1 opacity-0 group-hover:opacity-100 flex gap-1 transition-opacity">
                <button
                  type="button"
                  className="bg-blue-600/80 hover:bg-blue-600 text-white text-xs px-1.5 py-0.5 rounded"
                  onClick={(e) => { e.stopPropagation(); onPlay(v); }}
                  title="再生"
                >
                  ▶
                </button>
              </div>
            </div>
          );
        })}
        {stack.count > stack.videos.length && (
          <div
            className="shrink-0 w-32 h-20 rounded bg-gray-100 dark:bg-gray-800 flex items-center justify-center cursor-pointer hover:bg-gray-200 dark:hover:bg-gray-700"
            onClick={onOpen}
          >
            <span className="text-xs text-gray-500 dark:text-gray-400">+{stack.count - stack.videos.length}</span>
          </div>
        )}
      </div>
    </div>
  );
}
