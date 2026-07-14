import { useModalStore } from '../../store/useModalStore';
import { useLibraryStore } from '../../store/useLibraryStore';

function basename(path: string): string {
  return path.replace(/\\/g, '/').replace(/\/$/, '').split('/').pop() ?? path;
}

export function DndDestDirModal() {
  const { dndPendingFiles, dndOnSelect, closeDndDestDir } = useModalStore();
  const watchDirs = useLibraryStore((s) => s.watchDirs);

  if (!dndPendingFiles || !dndOnSelect) return null;

  const fileCount = dndPendingFiles.length;

  const handleSelect = (dir: string) => {
    dndOnSelect(dir);
    closeDndDestDir();
  };

  const handleCancel = () => {
    dndOnSelect(null);
    closeDndDestDir();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      role="dialog"
      aria-modal="true"
      onClick={handleCancel}
    >
      <div
        className="bg-white dark:bg-gray-900 rounded-xl shadow-xl px-6 py-5 w-full max-w-sm mx-4"
        onClick={(e) => e.stopPropagation()}
      >
        <p className="text-sm font-medium text-gray-800 dark:text-gray-100 mb-1">
          コピー先フォルダを選択
        </p>
        <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">
          {fileCount}件のファイルを選択したフォルダの <code className="font-mono">Unsorted</code> サブフォルダにコピーして登録します。
        </p>
        <div className="flex flex-col gap-1.5 mb-4">
          {watchDirs.map((dir) => (
            <button
              key={dir}
              type="button"
              className="w-full text-left px-3 py-2 rounded-lg text-sm border border-gray-200 dark:border-gray-700 hover:bg-blue-50 dark:hover:bg-blue-900/30 hover:border-blue-400 dark:hover:border-blue-500 transition-colors truncate"
              title={dir}
              onClick={() => handleSelect(dir)}
            >
              <span className="mr-2 text-gray-400">📁</span>
              <span className="text-gray-800 dark:text-gray-100">{basename(dir)}/Unsorted</span>
              <span className="ml-1.5 text-xs text-gray-400 dark:text-gray-500 truncate">{dir}/Unsorted</span>
            </button>
          ))}
        </div>
        <div className="flex justify-end">
          <button
            type="button"
            className="px-3 py-1.5 text-xs rounded border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800"
            onClick={handleCancel}
          >
            キャンセル
          </button>
        </div>
      </div>
    </div>
  );
}
