import type { ComponentProps } from "react";
import { Checkbox as RxCheckbox } from "radix-ui";
import { Check, Minus } from "lucide-react";
import { cx } from "./cx";
import styles from "./Form.module.css";

export function Checkbox({ className, checked, ...props }: ComponentProps<typeof RxCheckbox.Root>) {
  return (
    <RxCheckbox.Root className={cx(styles.checkbox, className)} checked={checked} {...props}>
      <RxCheckbox.Indicator>{checked === "indeterminate" ? <Minus /> : <Check />}</RxCheckbox.Indicator>
    </RxCheckbox.Root>
  );
}
