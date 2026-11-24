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
/*
 * イージング: cubic の ease-out / ease-in。
 * expo 系 (0.16, 1, 0.3, 1) は動きの大半が最初の 1/4 で終わり、短い時間だと
 * ほぼ一瞬に見えるため、最後まで動きが目で追える cubic にしている。
 * CSS 側の --ease-out / --ease-in (tokens.css) と同じ値。
 */
const easeOut = [0.33, 1, 0.68, 1] as const;
const easeIn = [0.32, 0, 0.67, 0] as const;

/*
 * 強さの目安: カジュアルテーマなので「動いているのが見える」程度に動かす。
 * 出現は 0.22〜0.34s + 8〜16px / 92〜95% から、消えるときは出るときの 6 割ほど。
 * spring は少しだけ行き過ぎて戻る (オーバーシュートがわずかに見える) 硬さにしている。
 */
export const transitions = {
  /** ツールチップ・メニューなど小さなポップアップ */
  fast: { duration: 0.22, ease: easeOut },
  /** パネル・画面の出現 */
  normal: { duration: 0.34, ease: easeOut },
  /** 消えるときは出るときより短く */
  exit: { duration: 0.18, ease: easeIn },
  /** ダイアログの出現 (少しだけ弾む) */
  pop: { type: "spring", stiffness: 280, damping: 24, mass: 0.9 },
  /** 位置の移動 (インジケーター・スイッチ・リスト並び替え) */
  spring: { type: "spring", stiffness: 380, damping: 32, mass: 0.8 },
  /** 少し弾むもの (トースト・ドロップオーバーレイ) */
  bouncy: { type: "spring", stiffness: 320, damping: 22, mass: 0.9 },
  /** 高さの開閉 */
  collapse: { duration: 0.3, ease: easeOut },
} satisfies Record<string, Transition>;

export const fade: Variants = {
  hidden: { opacity: 0, transition: transitions.exit },
  visible: { opacity: 1 },
};

/** ダイアログなど中央に出るもの */
export const popIn: Variants = {
  hidden: { opacity: 0, scale: 0.92, y: 16, transition: transitions.exit },
  visible: { opacity: 1, scale: 1, y: 0, transition: transitions.pop },
};

/** トリガー起点に開くポップアップ (transform-origin は Radix の CSS 変数で指定) */
export const popover: Variants = {
  hidden: { opacity: 0, scale: 0.94, transition: transitions.exit },
  visible: { opacity: 1, scale: 1, transition: transitions.fast },
};

/** 画面・パネルの中身の切替 (入場のみ。旧ビューは即座に外す) */
export const viewEnter = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
  transition: transitions.normal,
} as const;

/** 右ペインの中身の切替 */
export const panelEnter = {
  initial: { opacity: 0, x: 16 },
  animate: { opacity: 1, x: 0 },
  transition: transitions.normal,
} as const;

/** 下から出るフローティング要素 (トースト・ステータスカード) */
export const floatUp: Variants = {
  hidden: { opacity: 0, y: 16, scale: 0.96, transition: transitions.exit },
  visible: { opacity: 1, y: 0, scale: 1, transition: transitions.bouncy },
};

/** 高さ 0 ⇔ auto の開閉 */
export const collapse: Variants = {
  hidden: { height: 0, opacity: 0, transition: { duration: 0.22, ease: easeIn } },
  visible: { height: "auto", opacity: 1, transition: transitions.collapse },
};

/** AnimatePresence 配下で variants を使うときの共通 props */
export const presenceProps = {
  initial: "hidden",
  animate: "visible",
  exit: "hidden",
} as const;
