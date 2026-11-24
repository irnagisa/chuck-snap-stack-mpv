import { useState, type ReactNode } from "react";
import { Tooltip as RxTooltip } from "radix-ui";
import { AnimatePresence, motion } from "motion/react";
import { popover, presenceProps } from "./motion";
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

/** children は ref を受け取れる単一要素 (button 等) にすること */
export function Tooltip({ content, children, side = "top", align = "center", enabled = true }: TooltipProps) {
  const [open, setOpen] = useState(false);
  if (!enabled || content == null || content === "") return <>{children}</>;
  return (
    <RxTooltip.Root open={open} onOpenChange={setOpen}>
      <RxTooltip.Trigger asChild>{children}</RxTooltip.Trigger>
      <AnimatePresence>
        {open && (
          <RxTooltip.Portal forceMount>
            <RxTooltip.Content asChild forceMount side={side} align={align} sideOffset={6}>
              <motion.div className={styles.content} variants={popover} {...presenceProps}>
                {content}
                <RxTooltip.Arrow className={styles.arrow} width={8} height={4} />
              </motion.div>
            </RxTooltip.Content>
          </RxTooltip.Portal>
        )}
      </AnimatePresence>
    </RxTooltip.Root>
  );
}
