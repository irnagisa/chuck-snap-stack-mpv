import { useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { useSettingsStore, type AppSettings } from "../../store/useSettingsStore";
import { useLibraryStore } from "../../store/useLibraryStore";

interface Props {
  onClose: () => void;
}

export function SettingsPanel({ onClose }: Props) {
  const { mpvPath, ffmpegPath, ffprobePath, downloadDir, saveSettings } = useSettingsStore();
  const { db, watchDirs, scanAndImport, removeWatchDir, isScanning } = useLibraryStore();

  const [local, setLocal] = useState<AppSettings>({ mpvPath, ffmpegPath, ffprobePath, downloadDir });
  const [isSaving, setIsSaving] = useState(false);
  const [removingPath, setRemovingPath] = useState<string | null>(null);

  const handlePickMpv = async () => {
    const selected = await open({ multiple: false });
    if (typeof selected === "string") {
      setLocal((prev) => ({ ...prev, mpvPath: selected }));
    }
  };

  const handlePickDownloadDir = async () => {
    const selected = await open({ directory: true, multiple: false });
    if (typeof selected === "string") {
      setLocal((prev) => ({ ...prev, downloadDir: selected }));
    }
  };

  const handleAddScanPath = async () => {
    const selected = await open({ directory: true, multiple: false });
    if (typeof selected === "string") {
      await scanAndImport(selected);
    }
  };

  const handleRemoveScanPath = async (path: string) => {
    setRemovingPath(path);
    try {
      await removeWatchDir(path);
    } finally {
      setRemovingPath(null);
    }
  };

  const handleSave = async () => {
    if (!db) return;
    setIsSaving(true);
    try {
      await saveSettings(db, local);
      onClose();
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="bg-white dark:bg-gray-900 rounded-lg shadow-xl w-full max-w-lg mx-4">
        {/* ヘッダー */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">設定</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 text-xl leading-none"
          >
            ✕
          </button>
        </div>

        {/* 本体 */}
        <div className="px-6 py-5 space-y-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">
            実行ファイル
          </p>

          {/* mpv パス */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              mpv パス
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={local.mpvPath}
                onChange={(e) => setLocal((prev) => ({ ...prev, mpvPath: e.target.value }))}
                className="flex-1 border border-gray-300 dark:border-gray-600 px-2 py-1.5 rounded text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 font-mono"
                placeholder="/opt/homebrew/bin/mpv"
              />
              <button
                type="button"
                onClick={handlePickMpv}
                className="px-3 py-1.5 bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 rounded text-sm border border-gray-300 dark:border-gray-600 whitespace-nowrap"
              >
                参照
              </button>
            </div>
          </div>

          {/* ffmpeg パス */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              ffmpeg パス
            </label>
            <input
              type="text"
              value={local.ffmpegPath}
              onChange={(e) => setLocal((prev) => ({ ...prev, ffmpegPath: e.target.value }))}
              className="w-full border border-gray-300 dark:border-gray-600 px-2 py-1.5 rounded text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 font-mono"
              placeholder="ffmpeg"
            />
            <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
              PATH が通っている場合はコマンド名のみでも可
            </p>
          </div>

          {/* ffprobe パス */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              ffprobe パス
            </label>
            <input
              type="text"
              value={local.ffprobePath}
              onChange={(e) => setLocal((prev) => ({ ...prev, ffprobePath: e.target.value }))}
              className="w-full border border-gray-300 dark:border-gray-600 px-2 py-1.5 rounded text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 font-mono"
              placeholder="ffprobe"
            />
          </div>

          {/* 区切り線 */}
          <hr className="border-gray-200 dark:border-gray-700" />

          {/* ダウンロード */}
          <p className="text-xs font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">
            ダウンロード
          </p>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              ダウンロード先フォルダ
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                readOnly
                value={local.downloadDir}
                placeholder="未設定（システムの Downloads フォルダを使用）"
                className="flex-1 border border-gray-300 dark:border-gray-600 px-2 py-1.5 rounded text-sm bg-gray-50 dark:bg-gray-800 text-gray-700 dark:text-gray-300 placeholder-gray-400 dark:placeholder-gray-500 font-mono cursor-default min-w-0"
              />
              <button
                type="button"
                onClick={handlePickDownloadDir}
                className="px-3 py-1.5 bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 rounded text-sm border border-gray-300 dark:border-gray-600 whitespace-nowrap shrink-0"
              >
                参照
              </button>
              {local.downloadDir && (
                <button
                  type="button"
                  onClick={() => setLocal((prev) => ({ ...prev, downloadDir: "" }))}
                  className="px-2 py-1.5 text-gray-400 hover:text-red-500 dark:hover:text-red-400 text-sm shrink-0"
                  title="リセット"
                >
                  ✕
                </button>
              )}
            </div>
            {!local.downloadDir && (
              <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                未設定の場合は OS の標準 Downloads フォルダが使われます
              </p>
            )}
          </div>

          {/* 区切り線 */}
          <hr className="border-gray-200 dark:border-gray-700" />

          {/* スキャンパス */}
          <p className="text-xs font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">
            スキャンパス
          </p>

          <div className="space-y-1">
            {watchDirs.length === 0 ? (
              <p className="text-xs text-gray-400 dark:text-gray-500 py-1">
                スキャン対象フォルダがありません
              </p>
            ) : (
              watchDirs.map((dir) => (
                <div
                  key={dir}
                  className="flex items-center gap-2 bg-gray-50 dark:bg-gray-800 rounded px-2 py-1.5"
                >
                  <span className="flex-1 text-xs font-mono text-gray-700 dark:text-gray-300 truncate" title={dir}>
                    {dir}
                  </span>
                  <button
                    type="button"
                    disabled={removingPath === dir}
                    onClick={() => handleRemoveScanPath(dir)}
                    className="shrink-0 text-gray-400 hover:text-red-500 dark:hover:text-red-400 text-xs px-1 disabled:opacity-40"
                    title="このパスを削除"
                  >
                    {removingPath === dir ? "…" : "✕"}
                  </button>
                </div>
              ))
            )}
          </div>

          <button
            type="button"
            disabled={isScanning}
            onClick={handleAddScanPath}
            className="w-full py-1.5 text-sm border border-dashed border-gray-300 dark:border-gray-600 rounded text-gray-500 dark:text-gray-400 hover:border-blue-400 hover:text-blue-500 dark:hover:border-blue-400 dark:hover:text-blue-400 disabled:opacity-40 transition-colors"
          >
            {isScanning ? "スキャン中..." : "+ フォルダを追加"}
          </button>
        </div>

        {/* フッター */}
        <div className="flex justify-end gap-2 px-6 py-4 border-t border-gray-200 dark:border-gray-700">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 rounded"
          >
            キャンセル
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={isSaving || !db}
            className="px-4 py-1.5 text-sm bg-blue-600 hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-600 text-white rounded disabled:opacity-50"
          >
            {isSaving ? "保存中..." : "保存"}
          </button>
        </div>
      </div>
    </div>
  );
}
