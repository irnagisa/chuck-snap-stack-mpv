import type { ComponentProps } from "react";
import { Slider as RxSlider } from "radix-ui";
import { cx } from "./cx";
import styles from "./Form.module.css";

interface SliderProps extends ComponentProps<typeof RxSlider.Root> {
  /** つまみの読み上げ名 */
  thumbLabel?: string;
}

/**
 * value の要素数ぶんつまみを描画する (範囲指定なら [min, max])。
 * ドラッグ中は onValueChange、離したときに onValueCommit が呼ばれる。
 */
export function Slider({ className, value, defaultValue, thumbLabel, ...props }: SliderProps) {
  const thumbs = (value ?? defaultValue ?? [0]).length;
  return (
    <RxSlider.Root className={cx(styles.slider, className)} value={value} defaultValue={defaultValue} {...props}>
      <RxSlider.Track className={styles.sliderTrack}>
        <RxSlider.Range className={styles.sliderRange} />
      </RxSlider.Track>
      {Array.from({ length: thumbs }, (_, i) => (
        <RxSlider.Thumb key={i} className={styles.sliderThumb} aria-label={thumbLabel} />
      ))}
    </RxSlider.Root>
  );
}
