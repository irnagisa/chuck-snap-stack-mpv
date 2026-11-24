import { useInboxStore } from "../../store/useInboxStore";
import { Sparkles } from "lucide-react";
import { Button } from "../ui";

interface Props {
  onOrganize: () => void;
}

export function InboxSummaryCard({ onOrganize }: Props) {
  const inboxCount = useInboxStore((s) => s.stats?.inboxCount ?? 0);

  return (
    <section className="border border-gray-200 dark:border-gray-800 rounded-lg p-4">
      <h2 className="text-sm font-bold text-gray-500 dark:text-gray-400 mb-3">ライブラリ</h2>
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-2xl font-bold tabular-nums">
            未整理ファイル {inboxCount}件
          </p>
        </div>
        <Button variant="primary" size="md" disabled={inboxCount === 0} onClick={onOrganize}>
          <Sparkles aria-hidden />
          整理を開始
        </Button>
      </div>
    </section>
  );
}
