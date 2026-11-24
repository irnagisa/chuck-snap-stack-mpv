import type { ComponentProps } from "react";
import { RadioGroup as RxRadioGroup } from "radix-ui";
import { motion } from "motion/react";
import { cx } from "./cx";
import { transitions } from "./motion";
import styles from "./RadioGroup.module.css";

/*
 * Radix RadioGroup。Root はレイアウトを持たないので、リストのコンテナとしてそのまま使う。
 * Item は Root の中ならどれだけ深くにあってもよい (ツリー表示など)。
 *
 * <RadioGroup value={v} onValueChange={setV} className="flex flex-col gap-1">
 *   <label className="flex items-center gap-2"><RadioGroupItem value="a" />A</label>
 * </RadioGroup>
 */
export function RadioGroup(props: ComponentProps<typeof RxRadioGroup.Root>) {
  return <RxRadioGroup.Root {...props} />;
}

export function RadioGroupItem({ className, ...props }: ComponentProps<typeof RxRadioGroup.Item>) {
  return (
    <RxRadioGroup.Item className={cx(styles.item, className)} {...props}>
      <RxRadioGroup.Indicator asChild>
        <motion.span
          className={styles.dot}
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={transitions.spring}
        />
      </RxRadioGroup.Indicator>
    </RxRadioGroup.Item>
  );
}
