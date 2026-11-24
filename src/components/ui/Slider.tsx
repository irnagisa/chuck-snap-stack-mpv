import type { ComponentProps } from "react";
import { Slider as RxSlider } from "radix-ui";
import { cx } from "./cx";
import styles from "./Form.module.css";

/** value の要素数ぶんつまみを描画する (範囲指定なら [min, max]) */
export function Slider({ className, value, defaultValue, ...props }: ComponentProps<typeof RxSlider.Root>) {
  const thumbs = (value ?? defaultValue ?? [0]).length;
  return (
    <RxSlider.Root className={cx(styles.slider, className)} value={value} defaultValue={defaultValue} {...props}>
      <RxSlider.Track className={styles.sliderTrack}>
        <RxSlider.Range className={styles.sliderRange} />
      </RxSlider.Track>
      {Array.from({ length: thumbs }, (_, i) => (
        <RxSlider.Thumb key={i} className={styles.sliderThumb} />
      ))}
    </RxSlider.Root>
  );
}
