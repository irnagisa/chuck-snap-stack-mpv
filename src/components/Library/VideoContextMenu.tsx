import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'motion/react';
import { FolderOutput, FolderTree, Image as ImageIcon, Info, ListPlus, Play, Tags, Trash2 } from 'lucide-react';
import type { Video } from '../../types';
import { cx, motionPresets } from '../ui';
import menuStyles from '../ui/Menu.module.css';
import styles from './VideoContextMenu.module.css';

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

interface MenuItem {
  label: string;
  icon: ReactNode;
  onClick: () => void;
  danger?: boolean;
}

/** 画面の端からこれだけ離して出す */
const EDGE = 8;

/**
 * 右クリックした位置に出すメニュー。
 * 見た目と操作 (↑↓ で移動・Enter で実行・Esc で閉じる) は ui の ContextMenu に合わせている。
 */
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
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const [position, setPosition] = useState({ left: x, top: y });
  const [highlighted, setHighlighted] = useState<number | null>(null);

  const isImage = video.media_type === 'image';
  const actions: MenuItem[] = [
    { label: isImage ? '画像を開く' : '再生', icon: isImage ? <ImageIcon /> : <Play />, onClick: onPlay },
    { label: '詳細を表示', icon: <Info />, onClick: onShowDetail },
    ...(onAddToPlaylist ? [{ label: 'プレイリストに追加', icon: <ListPlus />, onClick: onAddToPlaylist }] : []),
    ...(onSetTag ? [{ label: 'タグを設定', icon: <Tags />, onClick: onSetTag }] : []),
    ...(onSetCategory ? [{ label: 'カテゴリを設定', icon: <FolderTree />, onClick: onSetCategory }] : []),
    ...(onMoveDir ? [{ label: '他のディレクトリへ移動', icon: <FolderOutput />, onClick: onMoveDir }] : []),
  ];
  const deleteItem: MenuItem = { label: '削除', icon: <Trash2 />, onClick: onDelete, danger: true };
  const items = [...actions, deleteItem];

  // 実際の大きさを測って、画面からはみ出さない位置に寄せる
  useLayoutEffect(() => {
    const el = menuRef.current;
    if (!el) return;
    // 開くときの拡大アニメーションに影響されないよう、変形前の大きさで測る
    const width = el.offsetWidth;
    const height = el.offsetHeight;
    setPosition({
      left: Math.max(EDGE, Math.min(x, window.innerWidth - width - EDGE)),
      top: Math.max(EDGE, Math.min(y, window.innerHeight - height - EDGE)),
    });
  }, [x, y]);

  // 開いたらメニューにフォーカスを移す (↑↓ で選べるように)
  useEffect(() => {
    menuRef.current?.focus();
  }, []);

  // 外側をクリック / Esc / ウィンドウの大きさが変わったら閉じる
  useEffect(() => {
    const handleMouseDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleKeyDown = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', handleMouseDown, true);
    document.addEventListener('keydown', handleKeyDown);
    window.addEventListener('resize', onClose);
    return () => {
      document.removeEventListener('mousedown', handleMouseDown, true);
      document.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('resize', onClose);
    };
  }, [onClose]);

  const moveTo = (index: number) => {
    const next = (index + items.length) % items.length;
    setHighlighted(next);
    itemRefs.current[next]?.focus();
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const current = highlighted ?? -1;
    if (e.key === 'ArrowDown') moveTo(current + 1);
    else if (e.key === 'ArrowUp') moveTo(highlighted === null ? items.length - 1 : current - 1);
    else if (e.key === 'Home') moveTo(0);
    else if (e.key === 'End') moveTo(items.length - 1);
    else if (e.key === 'Tab') onClose();
    else return;
    e.preventDefault();
  };

  const title = video.title ?? video.path.split('/').pop();

  const renderItem = (item: MenuItem, index: number) => (
    <button
      key={item.label}
      ref={(el) => {
        itemRefs.current[index] = el;
      }}
      type="button"
      role="menuitem"
      tabIndex={-1}
      className={cx(menuStyles.item, styles.item)}
      data-danger={item.danger || undefined}
      data-highlighted={highlighted === index || undefined}
      onMouseEnter={() => setHighlighted(index)}
      onMouseLeave={() => setHighlighted(null)}
      onFocus={() => setHighlighted(index)}
      onClick={item.onClick}
    >
      <span className={menuStyles.icon} aria-hidden>
        {item.icon}
      </span>
      {item.label}
    </button>
  );

  return createPortal(
    <motion.div
      ref={menuRef}
      role="menu"
      aria-label={title}
      tabIndex={-1}
      className={cx(menuStyles.content, styles.menu)}
      style={position}
      variants={motionPresets.popover}
      initial="hidden"
      animate="visible"
      onKeyDown={handleKeyDown}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div className={cx(menuStyles.label, styles.title)} title={title}>
        {title}
      </div>
      <div className={menuStyles.separator} role="separator" />
      {actions.map(renderItem)}
      <div className={menuStyles.separator} role="separator" />
      {renderItem(deleteItem, items.length - 1)}
    </motion.div>,
    document.body,
  );
}
