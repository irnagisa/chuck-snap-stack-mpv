import type { CSSProperties, ReactNode } from 'react';
import { X } from 'lucide-react';
import type { Tag } from '../../types';
import { MediaIcon } from '../../lib/mediaIcons';
import styles from './TagBadge.module.css';

/** タグ・カテゴリの色を CSS 変数で渡す (チップや色付きアイコンが参照する) */
export function tagColorStyle(color: string): CSSProperties {
  return { '--tag-color': color } as CSSProperties;
}

interface Props {
  tag: Tag;
  /** 指定すると × ボタンを出す */
  onRemove?: () => void;
  removeLabel?: string;
  /** タグのアイコンを先頭に出す */
  showIcon?: boolean;
  size?: 'sm' | 'md';
  /** 末尾に添える要素 (件数など) */
  children?: ReactNode;
}

/**
 * タグのチップ。タグ色をうっすら敷いた背景 + 同系色の文字で表示する
 * (色ベタ塗り + 白文字だと色によって読みにくく、主張も強すぎるため)。
 */
export function TagBadge({ tag, onRemove, removeLabel, showIcon = false, size = 'md', children }: Props) {
  return (
    <span className={styles.chip} data-size={size} style={tagColorStyle(tag.color)}>
      {showIcon && <MediaIcon icon={tag.icon ?? 'tag'} className={styles.icon} />}
      <span className={styles.label}>{tag.name}</span>
      {children}
      {onRemove && (
        <button
          type="button"
          className={styles.remove}
          aria-label={removeLabel ?? `${tag.name} ×`}
          onClick={(e) => { e.stopPropagation(); onRemove(); }}
        >
          <X aria-hidden />
        </button>
      )}
    </span>
  );
}
