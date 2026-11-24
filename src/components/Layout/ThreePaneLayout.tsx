import type { CSSProperties, ReactNode } from "react";
import { PaneResizer, usePaneWidth } from "./PaneResizer";
import styles from "./Layout.module.css";

interface ThreePaneLayoutProps {
  /** 左ペイン。null の場合は左ペインとリサイズハンドルを描画しない */
  sidebar: ReactNode | null;
  /** 中央ペイン */
  children: ReactNode;
  /** 右ペイン (詳細パネル) */
  detail: ReactNode;
  sidebarLabel?: string;
}

const SIDEBAR = { storageKey: "librarySidebarWidth", defaultWidth: 176, min: 120, max: 400 } as const;

/** ライブラリ画面の 3 ペイン (サイドバー | 一覧 | 詳細) */
export function ThreePaneLayout({ sidebar, children, detail, sidebarLabel }: ThreePaneLayoutProps) {
  const pane = usePaneWidth(SIDEBAR);

  return (
    <div className={styles.threePane} style={{ "--sidebar-width": `${pane.width}px` } as CSSProperties}>
      {sidebar != null && (
        <>
          <div className={styles.sidebar}>{sidebar}</div>
          <PaneResizer
            width={pane.width}
            min={pane.min}
            max={pane.max}
            onResize={pane.setWidth}
            onCommit={pane.persist}
            aria-label={sidebarLabel}
          />
        </>
      )}
      <div className={styles.main}>{children}</div>
      <aside className={styles.detail}>{detail}</aside>
    </div>
  );
}
