import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import type { Video } from '../../types';

interface Props {
  video: Video;
  x: number;
  y: number;
  onClose: () => void;
  onPlay: () => void;
  onShowDetail: () => void;
  onAddToPlaylist?: () => void;
  onSetTag?: () => void;
  onSetCategory?: () => void;
  onMoveDir?: () => void;
  onDelete: () => void;
}

export function VideoContextMenu({
  video,
  x,
  y,
  onClose,
  onPlay,
  onShowDetail,
  onAddToPlaylist,
  onSetTag,
  onSetCategory,
  onMoveDir,
  onDelete,
}: Props) {
  const menuRef = useRef<HTMLDivElement>(null);

  // クリックアウトサイド / Esc で閉じる
  useEffect(() => {
    const handleMouseDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', handleMouseDown, true);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleMouseDown, true);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose]);

  // ビューポート境界調整
  const adjustedX = Math.min(x, window.innerWidth - 200);
  const adjustedY = Math.min(y, window.innerHeight - 260);

  const isImage = video.media_type === 'image';

  const items: { label: string; icon: string; onClick: () => void; danger?: boolean }[] = [
    { label: isImage ? '画像を開く' : '再生', icon: isImage ? '🖼' : '▶', onClick: onPlay },
    { label: '詳細を表示', icon: 'ℹ', onClick: onShowDetail },
    ...(onAddToPlaylist ? [{ label: 'プレイリストに追加', icon: '+', onClick: onAddToPlaylist }] : []),
    ...(onSetTag ? [{ label: 'タグを設定', icon: '🏷', onClick: onSetTag }] : []),
    ...(onSetCategory ? [{ label: 'カテゴリを設定', icon: '📁', onClick: onSetCategory }] : []),
    ...(onMoveDir ? [{ label: '他のディレクトリへ移動', icon: '➡', onClick: onMoveDir }] : []),
    { label: '削除', icon: '🗑', onClick: onDelete, danger: true },
  ];

  return createPortal(
    <div
      ref={menuRef}
      className="fixed z-[1000] min-w-[180px] rounded-lg shadow-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 py-1 text-sm select-none"
      style={{ left: adjustedX, top: adjustedY }}
    >
      {/* タイトル */}
      <div className="px-3 py-1.5 border-b border-gray-100 dark:border-gray-700">
        <p className="text-xs font-medium text-gray-500 dark:text-gray-400 truncate max-w-[200px]">
          {video.title ?? video.path.split('/').pop()}
        </p>
      </div>

      {items.map((item, i) => (
        <button
          key={i}
          type="button"
          className={`w-full text-left px-3 py-2 flex items-center gap-2.5 transition-colors ${
            item.danger
              ? 'text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40'
              : 'text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700'
          }`}
          onClick={item.onClick}
        >
          <span className="w-4 text-center text-[13px]">{item.icon}</span>
          {item.label}
        </button>
      ))}
    </div>,
    document.body,
  );
}
