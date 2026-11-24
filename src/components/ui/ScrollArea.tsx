import type { ComponentProps, Ref } from "react";
import { ScrollArea as RxScrollArea } from "radix-ui";
import { cx } from "./cx";
import styles from "./ScrollArea.module.css";

interface ScrollAreaProps extends ComponentProps<typeof RxScrollArea.Root> {
  /** スクロール位置の操作・仮想スクロール用にビューポート要素への ref を渡せる */
  viewportRef?: Ref<HTMLDivElement>;
  orientation?: "vertical" | "horizontal" | "both";
}

/** OS 非依存のオーバーレイスクロールバー付きスクロール領域 */
export function ScrollArea({
  className,
  children,
  viewportRef,
  orientation = "vertical",
  type = "hover",
  ...props
}: ScrollAreaProps) {
  return (
    <RxScrollArea.Root className={cx(styles.root, className)} type={type} {...props}>
      <RxScrollArea.Viewport ref={viewportRef} className={styles.viewport}>
        {children}
      </RxScrollArea.Viewport>
      {orientation !== "horizontal" && (
        <RxScrollArea.Scrollbar orientation="vertical" className={styles.scrollbar}>
          <RxScrollArea.Thumb className={styles.thumb} />
        </RxScrollArea.Scrollbar>
      )}
      {orientation !== "vertical" && (
        <RxScrollArea.Scrollbar orientation="horizontal" className={styles.scrollbar}>
          <RxScrollArea.Thumb className={styles.thumb} />
        </RxScrollArea.Scrollbar>
      )}
      <RxScrollArea.Corner />
    </RxScrollArea.Root>
  );
}
