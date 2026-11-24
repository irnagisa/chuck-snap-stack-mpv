import type { Transition, Variants } from "motion/react";

/**
 * Motion の共通プリセット。
 * アニメーションの長さ・カーブはここに集約し、コンポーネント側で直書きしない。
 * (prefers-reduced-motion は main.tsx の <MotionConfig reducedMotion="user"> で一括対応)
 */
export const transitions = {
  fast: { duration: 0.12, ease: [0.16, 1, 0.3, 1] },
  normal: { duration: 0.18, ease: [0.16, 1, 0.3, 1] },
  spring: { type: "spring", stiffness: 420, damping: 34, mass: 0.8 },
} satisfies Record<string, Transition>;

export const fade: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1 },
};

export const popIn: Variants = {
  hidden: { opacity: 0, scale: 0.96, y: 6 },
  visible: { opacity: 1, scale: 1, y: 0 },
};

/** AnimatePresence 配下で variants を使うときの共通 props */
export const presenceProps = {
  initial: "hidden",
  animate: "visible",
  exit: "hidden",
} as const;
