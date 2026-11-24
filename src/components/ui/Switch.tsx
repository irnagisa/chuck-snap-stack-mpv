import type { ComponentProps } from "react";
import { Switch as RxSwitch } from "radix-ui";
import { cx } from "./cx";
import styles from "./Form.module.css";

export function Switch({ className, ...props }: ComponentProps<typeof RxSwitch.Root>) {
  return (
    <RxSwitch.Root className={cx(styles.switch, className)} {...props}>
      <RxSwitch.Thumb className={styles.switchThumb} />
    </RxSwitch.Root>
  );
}
