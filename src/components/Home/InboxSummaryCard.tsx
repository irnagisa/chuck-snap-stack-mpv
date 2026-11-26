import { useInboxStore } from "../../store/useInboxStore";
import { Sparkles } from "lucide-react";
import { Button } from "../ui";
import homeStyles from "./Home.module.css";

interface Props {
  onOrganize: () => void;
}

export function InboxSummaryCard({ onOrganize }: Props) {
  const inboxCount = useInboxStore((s) => s.stats?.inboxCount ?? 0);

  return (
    <section className={homeStyles.section}>
      <h2 className={homeStyles.heading}>ライブラリ</h2>
      <div className={homeStyles.inboxRow}>
        <p className={homeStyles.inboxCount}>未整理ファイル {inboxCount}件</p>
        <Button variant="primary" size="md" disabled={inboxCount === 0} onClick={onOrganize}>
          <Sparkles aria-hidden />
          整理を開始
        </Button>
      </div>
    </section>
  );
}
