import type { ReactNode } from "react";
import { motion } from "motion/react";
import { viewEnter } from "./motion";
import { cx } from "./cx";
import styles from "./EmptyState.module.css";

interface EmptyStateProps {
  /** lucide アイコン (例: `<FolderPlus />`) */
  icon?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  /** ボタンなどの操作 */
  action?: ReactNode;
  /** 小さい領域 (ホームのカード内など) 向けの詰めた表示 */
  compact?: boolean;
  className?: string;
}

/** 一覧が空のときの表示。アイコン・見出し・説明・操作を中央に並べる */
export function EmptyState({ icon, title, description, action, compact = false, className }: EmptyStateProps) {
  return (
    <motion.div className={cx(styles.root, className)} data-compact={compact || undefined} {...viewEnter}>
      {icon && (
        <div className={styles.icon} aria-hidden>
          {icon}
        </div>
      )}
      <p className={styles.title}>{title}</p>
      {description && <p className={styles.description}>{description}</p>}
      {action && <div className={styles.action}>{action}</div>}
    </motion.div>
  );
}
