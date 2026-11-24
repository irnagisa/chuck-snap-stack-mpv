import type { ReactNode } from "react";
import { Select as RxSelect } from "radix-ui";
import { Check, ChevronDown, ChevronUp } from "lucide-react";
import { cx } from "./cx";
import menu from "./Menu.module.css";
import styles from "./Select.module.css";

export interface SelectOption<T extends string = string> {
  value: T;
  label: ReactNode;
  disabled?: boolean;
}

interface SelectProps<T extends string> {
  value: T | undefined;
  onValueChange: (value: T) => void;
  options: ReadonlyArray<SelectOption<T>>;
  placeholder?: ReactNode;
  disabled?: boolean;
  className?: string;
  "aria-label"?: string;
}

/**
 * Radix Select ベースのドロップダウン。
 * 既存の components/common/Select (ネイティブ <select>) は段階的にこちらへ置き換える。
 * ※ Radix Select は value="" を許容しないので「未選択」は undefined で表す。
 */
export function Select<T extends string>({
  value,
  onValueChange,
  options,
  placeholder,
  disabled,
  className,
  "aria-label": ariaLabel,
}: SelectProps<T>) {
  return (
    <RxSelect.Root value={value} onValueChange={(v) => onValueChange(v as T)} disabled={disabled}>
      <RxSelect.Trigger className={cx(styles.trigger, className)} aria-label={ariaLabel}>
        <RxSelect.Value placeholder={placeholder} />
        <RxSelect.Icon asChild>
          <ChevronDown className={styles.chevron} />
        </RxSelect.Icon>
      </RxSelect.Trigger>
      <RxSelect.Portal>
        <RxSelect.Content className={cx(menu.content, styles.content)} position="popper" sideOffset={4}>
          <RxSelect.ScrollUpButton className={styles.scrollButton}>
            <ChevronUp />
          </RxSelect.ScrollUpButton>
          <RxSelect.Viewport>
            {options.map((opt) => (
              <RxSelect.Item key={opt.value} value={opt.value} disabled={opt.disabled} className={menu.item}>
                <RxSelect.ItemIndicator className={menu.icon}>
                  <Check />
                </RxSelect.ItemIndicator>
                <RxSelect.ItemText>{opt.label}</RxSelect.ItemText>
              </RxSelect.Item>
            ))}
          </RxSelect.Viewport>
          <RxSelect.ScrollDownButton className={styles.scrollButton}>
            <ChevronDown />
          </RxSelect.ScrollDownButton>
        </RxSelect.Content>
      </RxSelect.Portal>
    </RxSelect.Root>
  );
}
