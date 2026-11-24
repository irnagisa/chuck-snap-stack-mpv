import { createContext, useContext, useState, type ComponentProps } from "react";
import { Popover as RxPopover } from "radix-ui";
import { AnimatePresence, motion } from "motion/react";
import { cx } from "./cx";
import { popover, presenceProps } from "./motion";
import styles from "./Popover.module.css";

/*
 * Radix Popover + Motion の開閉アニメーション。
 *
 * <Popover.Root>
 *   <Popover.Trigger asChild><Button>…</Button></Popover.Trigger>
 *   <Popover.Content align="start">…</Popover.Content>
 * </Popover.Root>
 */

const OpenContext = createContext(false);

function Root({ open, defaultOpen, onOpenChange, ...props }: ComponentProps<typeof RxPopover.Root>) {
  const [inner, setInner] = useState(defaultOpen ?? false);
  const isOpen = open ?? inner;
  return (
    <OpenContext.Provider value={isOpen}>
      <RxPopover.Root
        open={isOpen}
        onOpenChange={(o) => {
          setInner(o);
          onOpenChange?.(o);
        }}
        {...props}
      />
    </OpenContext.Provider>
  );
}

function Content({ className, sideOffset = 6, children, ...props }: ComponentProps<typeof RxPopover.Content>) {
  const open = useContext(OpenContext);
  return (
    <AnimatePresence>
      {open && (
        <RxPopover.Portal forceMount>
          <RxPopover.Content asChild forceMount sideOffset={sideOffset} {...props}>
            <motion.div className={cx(styles.content, className)} variants={popover} {...presenceProps}>
              {children}
            </motion.div>
          </RxPopover.Content>
        </RxPopover.Portal>
      )}
    </AnimatePresence>
  );
}

export const Popover = {
  Root,
  Trigger: RxPopover.Trigger,
  Anchor: RxPopover.Anchor,
  Close: RxPopover.Close,
  Content,
};
