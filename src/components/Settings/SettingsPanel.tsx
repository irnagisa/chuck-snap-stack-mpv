import { useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { useSettingsStore, type AppSettings } from "../../store/useSettingsStore";
import { useLibraryStore } from "../../store/useLibraryStore";

interface Props {
  onClose: () => void;
}

export function SettingsPanel({ onClose }: Props) {
  const { mpvPath, ffmpegPath, ffprobePath, saveSettings } = useSettingsStore();
  const db = useLibraryStore((s) => s.db);

  const [local, setLocal] = useState<AppSettings>({ mpvPath, ffmpegPath, ffprobePath });
  const [isSaving, setIsSaving] = useState(false);

  const handlePickMpv = async () => {
    const selected = await open({ multiple: false });
    if (typeof selected === "string") {
      setLocal((prev) => ({ ...prev, mpvPath: selected }));
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
      <div className="bg-white dark:bg-gray-900 rounded-lg shadow-xl w-full max-w-md mx-4">
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
