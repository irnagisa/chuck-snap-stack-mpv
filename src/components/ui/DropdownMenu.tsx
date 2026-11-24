import type { ComponentProps, ReactNode } from "react";
import { DropdownMenu as RxDropdownMenu } from "radix-ui";
import { Check, ChevronRight } from "lucide-react";
import { cx } from "./cx";
import styles from "./Menu.module.css";

/*
 * Radix DropdownMenu の薄いラッパー。構造はそのまま、見た目だけを与える。
 *
 * <DropdownMenu.Root>
 *   <DropdownMenu.Trigger asChild><Button>…</Button></DropdownMenu.Trigger>
 *   <DropdownMenu.Content>
 *     <DropdownMenu.Item icon={<Pencil />} shortcut="⌘E">編集</DropdownMenu.Item>
 *     <DropdownMenu.Separator />
 *     <DropdownMenu.Item danger>削除</DropdownMenu.Item>
 *   </DropdownMenu.Content>
 * </DropdownMenu.Root>
 */

function Content({ className, sideOffset = 4, ...props }: ComponentProps<typeof RxDropdownMenu.Content>) {
  return (
    <RxDropdownMenu.Portal>
      <RxDropdownMenu.Content className={cx(styles.content, className)} sideOffset={sideOffset} {...props} />
    </RxDropdownMenu.Portal>
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

function SubContent({ className, ...props }: ComponentProps<typeof RxDropdownMenu.SubContent>) {
  return (
    <RxDropdownMenu.Portal>
      <RxDropdownMenu.SubContent className={cx(styles.content, className)} sideOffset={2} {...props} />
    </RxDropdownMenu.Portal>
  );
}

export const DropdownMenu = {
  Root: RxDropdownMenu.Root,
  Trigger: RxDropdownMenu.Trigger,
  Group: RxDropdownMenu.Group,
  RadioGroup: RxDropdownMenu.RadioGroup,
  Sub: RxDropdownMenu.Sub,
  Content,
  Item,
  CheckboxItem,
  RadioItem,
  Label,
  Separator,
  SubTrigger,
  SubContent,
};
