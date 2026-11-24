import { createContext, useContext, useState, type ComponentProps, type ReactNode } from "react";
import { ContextMenu as RxContextMenu } from "radix-ui";
import { AnimatePresence, motion } from "motion/react";
import { Check, ChevronRight } from "lucide-react";
import { cx } from "./cx";
import { popover, presenceProps } from "./motion";
import styles from "./Menu.module.css";

/*
 * Radix ContextMenu + Motion の開閉アニメーション。
 *
 * <ContextMenu.Root>
 *   <ContextMenu.Trigger asChild><div>…右クリック対象…</div></ContextMenu.Trigger>
 *   <ContextMenu.Content>
 *     <ContextMenu.Item icon={<Play />}>再生</ContextMenu.Item>
 *   </ContextMenu.Content>
 * </ContextMenu.Root>
 *
 * 退場アニメーションのため開閉状態を onOpenChange で追跡し、Content を forceMount で描画する。
 * (ContextMenu.Root は open を制御できないので、Root は状態の追跡のみ行う)
 */

/** 最も近い Root / Sub の開閉状態 */
const OpenContext = createContext(false);

function useOpenState(open: boolean | undefined, defaultOpen: boolean | undefined, onOpenChange?: (o: boolean) => void) {
  const [inner, setInner] = useState(defaultOpen ?? false);
  const isOpen = open ?? inner;
  const setOpen = (o: boolean) => {
    setInner(o);
    onOpenChange?.(o);
  };
  return [isOpen, setOpen] as const;
}

function Root({ onOpenChange, ...props }: ComponentProps<typeof RxContextMenu.Root>) {
  const [isOpen, setOpen] = useOpenState(undefined, false, onOpenChange);
  return (
    <OpenContext.Provider value={isOpen}>
      <RxContextMenu.Root onOpenChange={setOpen} {...props} />
    </OpenContext.Provider>
  );
}

function Sub({ open, defaultOpen, onOpenChange, ...props }: ComponentProps<typeof RxContextMenu.Sub>) {
  const [isOpen, setOpen] = useOpenState(open, defaultOpen, onOpenChange);
  return (
    <OpenContext.Provider value={isOpen}>
      <RxContextMenu.Sub open={isOpen} onOpenChange={setOpen} {...props} />
    </OpenContext.Provider>
  );
}

function Content({ className, children, ...props }: ComponentProps<typeof RxContextMenu.Content>) {
  const open = useContext(OpenContext);
  return (
    <AnimatePresence>
      {open && (
        <RxContextMenu.Portal forceMount>
          <RxContextMenu.Content asChild forceMount {...props}>
            <motion.div className={cx(styles.content, className)} variants={popover} {...presenceProps}>
              {children}
            </motion.div>
          </RxContextMenu.Content>
        </RxContextMenu.Portal>
      )}
    </AnimatePresence>
  );
}

function SubContent({ className, children, ...props }: ComponentProps<typeof RxContextMenu.SubContent>) {
  const open = useContext(OpenContext);
  return (
    <AnimatePresence>
      {open && (
        <RxContextMenu.Portal forceMount>
          <RxContextMenu.SubContent asChild forceMount {...props}>
            <motion.div className={cx(styles.content, className)} variants={popover} {...presenceProps}>
              {children}
            </motion.div>
          </RxContextMenu.SubContent>
        </RxContextMenu.Portal>
      )}
    </AnimatePresence>
  );
}

interface ItemProps extends ComponentProps<typeof RxContextMenu.Item> {
  icon?: ReactNode;
  shortcut?: ReactNode;
  danger?: boolean;
}

function Item({ className, icon, shortcut, danger, children, ...props }: ItemProps) {
  return (
    <RxContextMenu.Item className={cx(styles.item, className)} data-danger={danger || undefined} {...props}>
      {icon && <span className={styles.icon}>{icon}</span>}
      {children}
      {shortcut && <span className={styles.shortcut}>{shortcut}</span>}
    </RxContextMenu.Item>
  );
}

function CheckboxItem({ className, children, ...props }: ComponentProps<typeof RxContextMenu.CheckboxItem>) {
  return (
    <RxContextMenu.CheckboxItem className={cx(styles.item, className)} {...props}>
      <RxContextMenu.ItemIndicator className={styles.icon}>
        <Check />
      </RxContextMenu.ItemIndicator>
      {children}
    </RxContextMenu.CheckboxItem>
  );
}

function RadioItem({ className, children, ...props }: ComponentProps<typeof RxContextMenu.RadioItem>) {
  return (
    <RxContextMenu.RadioItem className={cx(styles.item, className)} {...props}>
      <RxContextMenu.ItemIndicator className={styles.icon}>
        <Check />
      </RxContextMenu.ItemIndicator>
      {children}
    </RxContextMenu.RadioItem>
  );
}

function Label({ className, ...props }: ComponentProps<typeof RxContextMenu.Label>) {
  return <RxContextMenu.Label className={cx(styles.label, className)} {...props} />;
}

function Separator({ className, ...props }: ComponentProps<typeof RxContextMenu.Separator>) {
  return <RxContextMenu.Separator className={cx(styles.separator, className)} {...props} />;
}

function SubTrigger({ className, children, ...props }: ComponentProps<typeof RxContextMenu.SubTrigger>) {
  return (
    <RxContextMenu.SubTrigger className={cx(styles.item, className)} {...props}>
      {children}
      <ChevronRight className={styles.subTriggerChevron} />
    </RxContextMenu.SubTrigger>
  );
}

export const ContextMenu = {
  Root,
  Trigger: RxContextMenu.Trigger,
  Group: RxContextMenu.Group,
  RadioGroup: RxContextMenu.RadioGroup,
  Sub,
  Content,
  Item,
  CheckboxItem,
  RadioItem,
  Label,
  Separator,
  SubTrigger,
  SubContent,
};
