import { MousePointerClick } from "lucide-react";
import styles from "./Layout.module.css";

export function DetailPlaceholder() {
  return (
    <div className={styles.placeholder}>
      <span className={styles.placeholderIcon}>
        <MousePointerClick strokeWidth={1.75} aria-hidden />
      </span>
      <p>動画を選択してください</p>
      <p className={styles.placeholderHint}>クリックするとここに詳細が表示されます</p>
    </div>
  );
}
