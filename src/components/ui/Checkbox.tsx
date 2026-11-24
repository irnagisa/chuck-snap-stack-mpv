import type { ComponentProps } from "react";
import { Checkbox as RxCheckbox } from "radix-ui";
import { motion } from "motion/react";
import { Check, Minus } from "lucide-react";
import { cx } from "./cx";
import { transitions } from "./motion";
import styles from "./Form.module.css";

export function Checkbox({ className, checked, ...props }: ComponentProps<typeof RxCheckbox.Root>) {
  return (
    <RxCheckbox.Root className={cx(styles.checkbox, className)} checked={checked} {...props}>
      <RxCheckbox.Indicator asChild>
        <motion.span
          className={styles.checkboxIndicator}
          initial={{ scale: 0.4, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={transitions.spring}
        >
          {checked === "indeterminate" ? <Minus /> : <Check />}
        </motion.span>
      </RxCheckbox.Indicator>
    </RxCheckbox.Root>
  );
}
