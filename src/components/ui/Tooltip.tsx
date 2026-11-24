import type { ReactNode } from "react";
import { Tooltip as RxTooltip } from "radix-ui";
import styles from "./Tooltip.module.css";

/** アプリ全体で 1 つだけ置く (main.tsx) */
export const TooltipProvider = RxTooltip.Provider;

interface TooltipProps {
  content: ReactNode;
  children: ReactNode;
  side?: "top" | "right" | "bottom" | "left";
  align?: "start" | "center" | "end";
  /** false の場合ツールチップを出さずに children だけを描画する */
  enabled?: boolean;
}

/**
 * children は ref を受け取れる単一要素 (button 等) にすること。
 * 短時間で出入りするので Motion ではなく CSS アニメーションで描画している。
 */
export function Tooltip({ content, children, side = "top", align = "center", enabled = true }: TooltipProps) {
  if (!enabled || content == null || content === "") return <>{children}</>;
  return (
    <RxTooltip.Root>
      <RxTooltip.Trigger asChild>{children}</RxTooltip.Trigger>
      <RxTooltip.Portal>
        <RxTooltip.Content className={styles.content} side={side} align={align} sideOffset={6}>
          {content}
          <RxTooltip.Arrow className={styles.arrow} width={8} height={4} />
        </RxTooltip.Content>
      </RxTooltip.Portal>
    </RxTooltip.Root>
  );
}
