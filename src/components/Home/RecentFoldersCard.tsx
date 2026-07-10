import { useHomeStore } from "../../store/useHomeStore";

interface Props {
  onSelect: (dir: string) => void;
}

function basename(path: string): string {
  return path.replace(/\\/g, "/").replace(/\/$/, "").split("/").pop() ?? path;
}

export function RecentFoldersCard({ onSelect }: Props) {
  const recentFolders = useHomeStore((s) => s.recentFolders);

  if (recentFolders.length === 0) return null;

  return (
    <section className="border border-gray-200 dark:border-gray-800 rounded-lg p-4">
      <h2 className="text-sm font-bold text-gray-500 dark:text-gray-400 mb-3">最近開いたフォルダ</h2>
      <div className="flex flex-col gap-0.5">
        {recentFolders.map((f) => (
          <button
            type="button"
            key={f.path}
            className="text-left px-2 py-1.5 rounded text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 truncate"
            title={f.path}
            onClick={() => onSelect(f.path)}
          >
            {basename(f.path)}
          </button>
        ))}
      </div>
    </section>
  );
}
