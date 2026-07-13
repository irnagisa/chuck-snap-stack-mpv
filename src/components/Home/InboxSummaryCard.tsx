import { useInboxStore } from "../../store/useInboxStore";

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
        <button
          type="button"
          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded text-sm shrink-0 disabled:opacity-50"
          disabled={inboxCount === 0}
          onClick={onOrganize}
        >
          整理を開始
        </button>
      </div>
    </section>
  );
}
