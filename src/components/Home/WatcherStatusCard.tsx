import { useHomeStore } from "../../store/useHomeStore";

export function WatcherStatusCard() {
  const watchingPaths = useHomeStore((s) => s.watchingPaths);

  const isActive = watchingPaths.length > 0;

  return (
    <section className="border border-gray-200 dark:border-gray-800 rounded-lg p-4">
      <div className="flex items-center gap-2 mb-2">
        <span
          className={`w-2 h-2 rounded-full flex-shrink-0 ${
            isActive ? "bg-green-500" : "bg-gray-400 dark:bg-gray-600"
          }`}
        />
        <h2 className="text-sm font-bold text-gray-500 dark:text-gray-400">
          ファイルウォッチャー
        </h2>
        <span className="ml-auto text-xs text-gray-400 dark:text-gray-500">
          {isActive ? `${watchingPaths.length} フォルダ監視中` : "停止中"}
        </span>
      </div>
      {isActive && (
        <ul className="mt-2 space-y-1">
          {watchingPaths.map((p) => (
            <li
              key={p}
              className="text-xs text-gray-500 dark:text-gray-400 truncate pl-4 font-mono"
              title={p}
            >
              {p}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
