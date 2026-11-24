import { useCallback, type ReactNode } from "react";
import { Select as RxSelect } from "radix-ui";
import { animate, useReducedMotion } from "motion/react";
import { Check, ChevronDown, ChevronUp } from "lucide-react";
import { cx } from "./cx";
import { transitions } from "./motion";
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
  size?: "sm" | "md";
  /** 親の幅いっぱいに広げる */
  fullWidth?: boolean;
  disabled?: boolean;
  className?: string;
  title?: string;
  id?: string;
  "aria-label"?: string;
}

/**
 * Radix Select は value="" を受け付けないため、空文字は内部でこの値に置き換える。
 * 呼び出し側は「未設定 = ""」のような値をそのまま使える。
 */
const EMPTY = "__empty__";
const encode = (v: string) => (v === "" ? EMPTY : v);
const decode = (v: string) => (v === EMPTY ? "" : v);

/**
 * Radix Select ベースのドロップダウン。
 * ※ Radix Select は Content の forceMount に対応していないため、Motion は開くときのみ適用する。
 */
export function Select<T extends string>({
  value,
  onValueChange,
  options,
  placeholder,
  size = "sm",
  fullWidth = false,
  disabled,
  className,
  title,
  id,
  "aria-label": ariaLabel,
}: SelectProps<T>) {
  const reduceMotion = useReducedMotion();
  // Content がマウントされるたびに入場アニメーションを再生する
  const enterRef = useCallback(
    (el: HTMLDivElement | null) => {
      if (!el || reduceMotion) return;
      animate(el, { opacity: [0, 1], scale: [0.96, 1] }, transitions.fast);
    },
    [reduceMotion],
  );

  return (
    <RxSelect.Root
      value={value === undefined ? undefined : encode(value)}
      onValueChange={(v) => onValueChange(decode(v) as T)}
      disabled={disabled}
    >
      <RxSelect.Trigger
        id={id}
        className={cx(styles.trigger, className)}
        data-size={size}
        data-full-width={fullWidth || undefined}
        title={title}
        aria-label={ariaLabel ?? title}
      >
        <span className={styles.value}>
          <RxSelect.Value placeholder={placeholder} />
        </span>
        <RxSelect.Icon asChild>
          <ChevronDown className={styles.chevron} />
        </RxSelect.Icon>
      </RxSelect.Trigger>
      <RxSelect.Portal>
        <RxSelect.Content
          ref={enterRef}
          className={cx(menu.content, styles.content)}
          position="popper"
          sideOffset={4}
        >
          <RxSelect.ScrollUpButton className={styles.scrollButton}>
            <ChevronUp />
          </RxSelect.ScrollUpButton>
          <RxSelect.Viewport>
            {options.map((opt) => (
              <RxSelect.Item
                key={opt.value}
                value={encode(opt.value)}
                disabled={opt.disabled}
                className={menu.item}
              >
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
