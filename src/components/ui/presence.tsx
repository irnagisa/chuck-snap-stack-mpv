import { useRef, type ReactNode } from "react";
import { AnimatePresence, motion, useIsPresent } from "motion/react";
import { cx } from "./cx";
import { collapse, presenceProps } from "./motion";
import styles from "./presence.module.css";

/**
 * 退場アニメーション中は直前の値を返し続ける。
 *
 * ストアの状態が消えた瞬間に中身が空になると退場アニメーションが空振りするので、
 * AnimatePresence 配下のコンポーネントで「消える直前の見た目」を保持するのに使う。
 */
export function useFrozenWhileExiting<T>(value: T): T {
  const isPresent = useIsPresent();
  const frozen = useRef(value);
  // 描画中の ref 更新だが、表示中は常に最新値で上書きするだけなので冪等
  if (isPresent) frozen.current = value;
  return frozen.current;
}

interface CollapseProps<T> {
  show: boolean;
  /** 子に渡すデータ。退場中は show=true だった最後の値に固定される */
  data?: T;
  children: ReactNode | ((data: T) => ReactNode);
  className?: string;
}

/** 高さを 0 ⇔ auto でアニメーションさせて表示・非表示を切り替える */
export function Collapse<T>({ show, data, children, className }: CollapseProps<T>) {
  return (
    <AnimatePresence initial={false}>
      {show && (
        <motion.div key="collapse" className={cx(styles.collapse, className)} variants={collapse} {...presenceProps}>
          <Frozen data={data as T}>{children}</Frozen>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function Frozen<T>({ data, children }: { data: T; children: ReactNode | ((data: T) => ReactNode) }) {
  const frozen = useFrozenWhileExiting(data);
  return <>{typeof children === "function" ? children(frozen) : children}</>;
}
