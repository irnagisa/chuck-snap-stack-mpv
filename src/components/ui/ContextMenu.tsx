import type { ComponentProps, ReactNode } from "react";
import { ContextMenu as RxContextMenu } from "radix-ui";
import { Check, ChevronRight } from "lucide-react";
import { cx } from "./cx";
import styles from "./Menu.module.css";

/*
 * Radix ContextMenu の薄いラッパー。構造はそのまま、見た目だけを与える。
 *
 * <ContextMenu.Root>
 *   <ContextMenu.Trigger asChild><div>…右クリック対象…</div></ContextMenu.Trigger>
 *   <ContextMenu.Content>
 *     <ContextMenu.Item icon={<Play />}>再生</ContextMenu.Item>
 *   </ContextMenu.Content>
 * </ContextMenu.Root>
 */

function Content({ className, ...props }: ComponentProps<typeof RxContextMenu.Content>) {
  return (
    <RxContextMenu.Portal>
      <RxContextMenu.Content className={cx(styles.content, className)} {...props} />
    </RxContextMenu.Portal>
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

function SubContent({ className, ...props }: ComponentProps<typeof RxContextMenu.SubContent>) {
  return (
    <RxContextMenu.Portal>
      <RxContextMenu.SubContent className={cx(styles.content, className)} {...props} />
    </RxContextMenu.Portal>
  );
}

export const ContextMenu = {
  Root: RxContextMenu.Root,
  Trigger: RxContextMenu.Trigger,
  Group: RxContextMenu.Group,
  RadioGroup: RxContextMenu.RadioGroup,
  Sub: RxContextMenu.Sub,
  Content,
  Item,
  CheckboxItem,
  RadioItem,
  Label,
  Separator,
  SubTrigger,
  SubContent,
};
