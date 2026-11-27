import { useHomeStore } from "../../store/useHomeStore";
import { Sparkles } from "lucide-react";
import { Button } from "../ui";
import homeStyles from "./Home.module.css";

interface Props {
  onShow: () => void;
}

/** 新着 (取り込んでからまだ詳細を開いても再生してもいない) の件数と、ライブラリを新着で絞り込む入口 */
export function NewItemsCard({ onShow }: Props) {
  const newCount = useHomeStore((s) => s.newCount);

  return (
    <section className={homeStyles.section}>
      <h2 className={homeStyles.heading}>ライブラリ</h2>
      <div className={homeStyles.newRow}>
        <p className={homeStyles.newCount}>新着 {newCount.toLocaleString()}件</p>
        <Button variant="primary" size="md" disabled={newCount === 0} onClick={onShow}>
          <Sparkles aria-hidden />
          新着を見る
        </Button>
      </div>
    </section>
  );
}
