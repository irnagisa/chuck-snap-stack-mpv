import type { ButtonHTMLAttributes, Ref } from "react";
import { Slot } from "radix-ui";
import { cx } from "./cx";
import styles from "./Button.module.css";

export type ButtonVariant = "primary" | "soft" | "secondary" | "ghost" | "danger" | "danger-soft" | "inherit";
export type ButtonSize = "xs" | "sm" | "md" | "icon-sm" | "icon";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** true の場合、子要素 (a など) に Button のスタイルと props を移譲する */
  asChild?: boolean;
  /** 親の幅いっぱいに広げる */
  fullWidth?: boolean;
  ref?: Ref<HTMLButtonElement>;
}

export function Button({
  variant = "secondary",
  size = "sm",
  asChild = false,
  fullWidth = false,
  className,
  type,
  ...props
}: ButtonProps) {
  const Comp = asChild ? Slot.Root : "button";
  return (
    <Comp
      type={asChild ? undefined : (type ?? "button")}
      data-variant={variant}
      data-size={size}
      data-full-width={fullWidth || undefined}
      className={cx(styles.button, className)}
      {...props}
    />
  );
}
