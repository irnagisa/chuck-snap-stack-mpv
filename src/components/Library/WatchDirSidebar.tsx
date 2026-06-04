import { useLibraryStore } from '../../store/useLibraryStore';
import { useShallow } from 'zustand/shallow';

interface Props {
  selectedDir: string | null;
  onSelectDir: (dir: string | null) => void;
}

function basename(path: string): string {
  return path.replace(/\\/g, '/').replace(/\/$/, '').split('/').pop() ?? path;
}

export function WatchDirSidebar({ selectedDir, onSelectDir }: Props) {
  const { watchDirs, removeWatchDir } = useLibraryStore(
    useShallow((s) => ({ watchDirs: s.watchDirs, removeWatchDir: s.removeWatchDir }))
  );

  return (
    <aside className="flex flex-col gap-0.5 w-full min-w-0">
      <h2 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1 px-2">
        フォルダ
      </h2>

      <button
        type="button"
        className={`text-left px-2 py-1.5 rounded text-xs transition-colors ${
          selectedDir === null
            ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300 font-medium'
            : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800'
        }`}
        onClick={() => onSelectDir(null)}
      >
        すべて
      </button>

      {watchDirs.length === 0 && (
        <p className="px-2 py-1 text-xs text-gray-400 dark:text-gray-600">
          フォルダ未登録
        </p>
      )}

      {watchDirs.map((dir) => (
        <div key={dir} className="group flex items-center gap-0.5">
          <button
            type="button"
            title={dir}
            className={`flex-1 text-left px-2 py-1.5 rounded text-xs flex items-center gap-1.5 transition-colors truncate ${
              selectedDir === dir
                ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300 font-medium'
                : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800'
            }`}
            onClick={() => onSelectDir(dir)}
          >
            <span className="text-gray-400 dark:text-gray-500 shrink-0">📁</span>
            <span className="truncate">{basename(dir)}</span>
          </button>
          <button
            type="button"
            title="監視解除"
            className="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-red-500 text-xs px-0.5 shrink-0"
            onClick={() => removeWatchDir(dir)}
          >
            ×
          </button>
        </div>
      ))}
    </aside>
  );
}
