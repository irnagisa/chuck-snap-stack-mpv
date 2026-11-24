import type { CSSProperties } from 'react';
import { Check } from 'lucide-react';
import styles from './ColorSwatches.module.css';

/** タグ・カテゴリに使える色 */
export const TAXONOMY_COLORS = [
  '#ef4444', '#f97316', '#eab308', '#22c55e',
  '#06b6d4', '#3b82f6', '#8b5cf6', '#ec4899', '#6b7280',
];

interface Props {
  value: string;
  onChange: (color: string) => void;
  colors?: string[];
  label?: string;
}

/** 色の選択 (丸い色見本を並べたラジオ) */
export function ColorSwatches({ value, onChange, colors = TAXONOMY_COLORS, label }: Props) {
  return (
    <div className={styles.swatches} role="radiogroup" aria-label={label}>
      {colors.map((c) => {
        const selected = value.toLowerCase() === c.toLowerCase();
        return (
          <button
            key={c}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={c}
            className={styles.swatch}
            data-selected={selected || undefined}
            style={{ '--swatch': c } as CSSProperties}
            onClick={() => onChange(c)}
          >
            {selected && <Check aria-hidden />}
          </button>
        );
      })}
    </div>
  );
}
