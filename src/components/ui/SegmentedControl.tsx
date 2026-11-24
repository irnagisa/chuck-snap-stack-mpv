import { useId, type ReactNode } from "react";
import { ToggleGroup } from "radix-ui";
import { motion } from "motion/react";
import { cx } from "./cx";
import { transitions } from "./motion";
import styles from "./SegmentedControl.module.css";

export interface SegmentedOption<T extends string = string> {
  value: T;
  /** 表示内容。アイコンだけにする場合は aria-label を必ず渡す */
  label: ReactNode;
  "aria-label"?: string;
  title?: string;
  disabled?: boolean;
  /** アイコンだけの項目 (正方形で表示)。aria-label を必ず付ける */
  iconOnly?: boolean;
}

interface SegmentedControlProps<T extends string> {
  value: T;
  onValueChange: (value: T) => void;
  options: ReadonlyArray<SegmentedOption<T>>;
  size?: "xs" | "sm" | "md";
  fullWidth?: boolean;
  className?: string;
  "aria-label"?: string;
}

/**
 * 択一の切替 (Radix ToggleGroup + Motion のスライドインジケーター)。
 * 選択中の項目をもう一度押しても未選択にはならない。
 */
export function SegmentedControl<T extends string>({
  value,
  onValueChange,
  options,
  size = "sm",
  fullWidth = false,
  className,
  "aria-label": ariaLabel,
}: SegmentedControlProps<T>) {
  const layoutId = useId();
  return (
    <ToggleGroup.Root
      type="single"
      value={value}
      onValueChange={(v) => {
        // Radix は選択中の項目を押すと "" を返すので無視する
        if (v) onValueChange(v as T);
      }}
      className={cx(styles.root, className)}
      data-size={size}
      data-full-width={fullWidth || undefined}
      aria-label={ariaLabel}
    >
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <ToggleGroup.Item
            key={opt.value}
            value={opt.value}
            disabled={opt.disabled}
            className={styles.item}
            aria-label={opt["aria-label"]}
            title={opt.title}
            data-icon-only={opt.iconOnly ? "" : undefined}
          >
            {active && (
              <motion.span layoutId={layoutId} className={styles.indicator} transition={transitions.spring} />
            )}
            <span className={styles.label}>{opt.label}</span>
          </ToggleGroup.Item>
        );
      })}
    </ToggleGroup.Root>
  );
}
