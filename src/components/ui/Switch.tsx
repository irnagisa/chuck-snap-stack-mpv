import type { ComponentProps } from "react";
import { Switch as RxSwitch } from "radix-ui";
import { motion } from "motion/react";
import { cx } from "./cx";
import { transitions } from "./motion";
import styles from "./Form.module.css";

export function Switch({ className, ...props }: ComponentProps<typeof RxSwitch.Root>) {
  return (
    <RxSwitch.Root className={cx(styles.switch, className)} {...props}>
      <RxSwitch.Thumb asChild>
        <motion.span layout className={styles.switchThumb} transition={transitions.spring} />
      </RxSwitch.Thumb>
    </RxSwitch.Root>
  );
}
