import type { Transition, Variants } from "motion/react";

/**
 * Motion の共通プリセット。
 * アニメーションの長さ・カーブはここに集約し、コンポーネント側で直書きしない。
 * (prefers-reduced-motion は main.tsx の <MotionConfig reducedMotion="user"> で一括対応)
 *
 * 使い分け:
 *   - hover / focus の色変化            → CSS transition (Button.module.css 等)
 *   - 出現・消滅・移動・サイズ変化       → Motion (このファイルのプリセット)
 */
const easeOut = [0.16, 1, 0.3, 1] as const;
const easeIn = [0.4, 0, 1, 1] as const;

export const transitions = {
  /** ツールチップ・メニューなど小さなポップアップ */
  fast: { duration: 0.12, ease: easeOut },
  /** ダイアログ・パネルの出現 */
  normal: { duration: 0.18, ease: easeOut },
  /** 消えるときは出るときより短く */
  exit: { duration: 0.1, ease: easeIn },
  /** 位置の移動 (インジケーター・スイッチ・リスト並び替え) */
  spring: { type: "spring", stiffness: 520, damping: 38, mass: 0.7 },
  /** 少し弾むもの (トースト・ドロップオーバーレイ) */
  bouncy: { type: "spring", stiffness: 420, damping: 28, mass: 0.8 },
  /** 高さの開閉 */
  collapse: { duration: 0.2, ease: easeOut },
} satisfies Record<string, Transition>;

export const fade: Variants = {
  hidden: { opacity: 0, transition: transitions.exit },
  visible: { opacity: 1 },
};

/** ダイアログなど中央に出るもの */
export const popIn: Variants = {
  hidden: { opacity: 0, scale: 0.96, y: 6, transition: transitions.exit },
  visible: { opacity: 1, scale: 1, y: 0 },
};

/** トリガー起点に開くポップアップ (transform-origin は Radix の CSS 変数で指定) */
export const popover: Variants = {
  hidden: { opacity: 0, scale: 0.96, transition: transitions.exit },
  visible: { opacity: 1, scale: 1, transition: transitions.fast },
};

/** 画面・パネルの中身の切替 (入場のみ。旧ビューは即座に外す) */
export const viewEnter = {
  initial: { opacity: 0, y: 4 },
  animate: { opacity: 1, y: 0 },
  transition: transitions.normal,
} as const;

/** 右ペインの中身の切替 */
export const panelEnter = {
  initial: { opacity: 0, x: 8 },
  animate: { opacity: 1, x: 0 },
  transition: transitions.normal,
} as const;

/** 下から出るフローティング要素 (トースト・ステータスカード) */
export const floatUp: Variants = {
  hidden: { opacity: 0, y: 12, scale: 0.98, transition: transitions.exit },
  visible: { opacity: 1, y: 0, scale: 1, transition: transitions.bouncy },
};

/** 高さ 0 ⇔ auto の開閉 */
export const collapse: Variants = {
  hidden: { height: 0, opacity: 0, transition: { ...transitions.collapse, duration: 0.15 } },
  visible: { height: "auto", opacity: 1, transition: transitions.collapse },
};

/** AnimatePresence 配下で variants を使うときの共通 props */
export const presenceProps = {
  initial: "hidden",
  animate: "visible",
  exit: "hidden",
} as const;
