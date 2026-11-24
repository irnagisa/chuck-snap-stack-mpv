import type { InputHTMLAttributes, ReactNode, Ref } from "react";
import { X } from "lucide-react";
import { cx } from "./cx";
import styles from "./Input.module.css";

export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "size"> {
  size?: "xs" | "sm" | "md";
  /** ghost: 普段は枠を出さない (その場編集のタイトル欄など) */
  variant?: "default" | "ghost";
  /** 入力欄の左に出すアイコン (lucide-react など) */
  icon?: ReactNode;
  /** 渡すと、値があるときに右端へクリアボタンを出す */
  onClear?: () => void;
  clearLabel?: string;
  invalid?: boolean;
  /** 枠 (外側の要素) に付けるクラス。幅・余白などのレイアウト指定はこちら */
  className?: string;
  /** input 要素そのものに付けるクラス (text-center / font-mono など) */
  inputClassName?: string;
  ref?: Ref<HTMLInputElement>;
}

/**
 * テキスト / 数値 / 検索などの 1 行入力。
 * Radix に入力欄のプリミティブは無いため、ネイティブの <input> をトークンで装飾している。
 */
export function Input({
  size = "sm",
  variant = "default",
  icon,
  onClear,
  clearLabel = "クリア",
  invalid,
  className,
  inputClassName,
  disabled,
  readOnly,
  value,
  type = "text",
  ref,
  ...props
}: InputProps) {
  const hasValue = value != null && value !== "";
  return (
    <span
      className={cx(styles.field, className)}
      data-size={size}
      data-variant={variant}
      data-disabled={disabled || undefined}
      data-read-only={readOnly || undefined}
      data-invalid={invalid || undefined}
    >
      {icon && (
        <span className={styles.icon} aria-hidden>
          {icon}
        </span>
      )}
      <input
        ref={ref}
        type={type}
        className={cx(styles.input, inputClassName)}
        disabled={disabled}
        readOnly={readOnly}
        value={value}
        aria-invalid={invalid || undefined}
        {...props}
      />
      {onClear && hasValue && !disabled && (
        <button type="button" className={styles.clear} onClick={onClear} tabIndex={-1} aria-label={clearLabel}>
          <X strokeWidth={2.5} aria-hidden />
        </button>
      )}
    </span>
  );
}
