import { SquarePlay } from "lucide-react";
import styles from "./Layout.module.css";

export function DetailPlaceholder() {
  return (
    <div className={styles.placeholder}>
      <SquarePlay strokeWidth={1.2} aria-hidden />
      <p>動画を選択してください</p>
    </div>
  );
}
