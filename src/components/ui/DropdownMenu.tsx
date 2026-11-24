import { createContext, useContext, useState, type ComponentProps, type ReactNode } from "react";
import { DropdownMenu as RxDropdownMenu } from "radix-ui";
import { AnimatePresence, motion } from "motion/react";
import { Check, ChevronRight } from "lucide-react";
import { cx } from "./cx";
import { popover, presenceProps } from "./motion";
import styles from "./Menu.module.css";

/*
 * Radix DropdownMenu + Motion の開閉アニメーション。
 *
 * <DropdownMenu.Root>
 *   <DropdownMenu.Trigger asChild><Button>…</Button></DropdownMenu.Trigger>
 *   <DropdownMenu.Content>
 *     <DropdownMenu.Item icon={<Pencil />} shortcut="⌘E">編集</DropdownMenu.Item>
 *     <DropdownMenu.Separator />
 *     <DropdownMenu.Item danger>削除</DropdownMenu.Item>
 *   </DropdownMenu.Content>
 * </DropdownMenu.Root>
 *
 * 退場アニメーションのため Root / Sub は開閉状態を内部で保持し、Content を forceMount で描画する。
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

function Root({ open, defaultOpen, onOpenChange, ...props }: ComponentProps<typeof RxDropdownMenu.Root>) {
  const [isOpen, setOpen] = useOpenState(open, defaultOpen, onOpenChange);
  return (
    <OpenContext.Provider value={isOpen}>
      <RxDropdownMenu.Root open={isOpen} onOpenChange={setOpen} {...props} />
    </OpenContext.Provider>
  );
}

function Sub({ open, defaultOpen, onOpenChange, ...props }: ComponentProps<typeof RxDropdownMenu.Sub>) {
  const [isOpen, setOpen] = useOpenState(open, defaultOpen, onOpenChange);
  return (
    <OpenContext.Provider value={isOpen}>
      <RxDropdownMenu.Sub open={isOpen} onOpenChange={setOpen} {...props} />
    </OpenContext.Provider>
  );
}

function Content({ className, sideOffset = 4, children, ...props }: ComponentProps<typeof RxDropdownMenu.Content>) {
  const open = useContext(OpenContext);
  return (
    <AnimatePresence>
      {open && (
        <RxDropdownMenu.Portal forceMount>
          <RxDropdownMenu.Content asChild forceMount sideOffset={sideOffset} {...props}>
            <motion.div className={cx(styles.content, className)} variants={popover} {...presenceProps}>
              {children}
            </motion.div>
          </RxDropdownMenu.Content>
        </RxDropdownMenu.Portal>
      )}
    </AnimatePresence>
  );
}

function SubContent({ className, children, ...props }: ComponentProps<typeof RxDropdownMenu.SubContent>) {
  const open = useContext(OpenContext);
  return (
    <AnimatePresence>
      {open && (
        <RxDropdownMenu.Portal forceMount>
          <RxDropdownMenu.SubContent asChild forceMount sideOffset={2} {...props}>
            <motion.div className={cx(styles.content, className)} variants={popover} {...presenceProps}>
              {children}
            </motion.div>
          </RxDropdownMenu.SubContent>
        </RxDropdownMenu.Portal>
      )}
    </AnimatePresence>
  );
}

interface ItemProps extends ComponentProps<typeof RxDropdownMenu.Item> {
  icon?: ReactNode;
  shortcut?: ReactNode;
  danger?: boolean;
}

function Item({ className, icon, shortcut, danger, children, ...props }: ItemProps) {
  return (
    <RxDropdownMenu.Item className={cx(styles.item, className)} data-danger={danger || undefined} {...props}>
      {icon && <span className={styles.icon}>{icon}</span>}
      {children}
      {shortcut && <span className={styles.shortcut}>{shortcut}</span>}
    </RxDropdownMenu.Item>
  );
}

function CheckboxItem({ className, children, ...props }: ComponentProps<typeof RxDropdownMenu.CheckboxItem>) {
  return (
    <RxDropdownMenu.CheckboxItem className={cx(styles.item, className)} {...props}>
      <RxDropdownMenu.ItemIndicator className={styles.icon}>
        <Check />
      </RxDropdownMenu.ItemIndicator>
      {children}
    </RxDropdownMenu.CheckboxItem>
  );
}

function RadioItem({ className, children, ...props }: ComponentProps<typeof RxDropdownMenu.RadioItem>) {
  return (
    <RxDropdownMenu.RadioItem className={cx(styles.item, className)} {...props}>
      <RxDropdownMenu.ItemIndicator className={styles.icon}>
        <Check />
      </RxDropdownMenu.ItemIndicator>
      {children}
    </RxDropdownMenu.RadioItem>
  );
}

function Label({ className, ...props }: ComponentProps<typeof RxDropdownMenu.Label>) {
  return <RxDropdownMenu.Label className={cx(styles.label, className)} {...props} />;
}

function Separator({ className, ...props }: ComponentProps<typeof RxDropdownMenu.Separator>) {
  return <RxDropdownMenu.Separator className={cx(styles.separator, className)} {...props} />;
}

function SubTrigger({ className, children, ...props }: ComponentProps<typeof RxDropdownMenu.SubTrigger>) {
  return (
    <RxDropdownMenu.SubTrigger className={cx(styles.item, className)} {...props}>
      {children}
      <ChevronRight className={styles.subTriggerChevron} />
    </RxDropdownMenu.SubTrigger>
  );
}

export const DropdownMenu = {
  Root,
  Trigger: RxDropdownMenu.Trigger,
  Group: RxDropdownMenu.Group,
  RadioGroup: RxDropdownMenu.RadioGroup,
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
