import { useEffect, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { useLibraryStore } from "./store/useLibraryStore";
import { usePlayerStore } from "./store/usePlayerStore";
import { PlayerControls } from "./components/Player/PlayerControls";
import { LibraryGrid } from "./components/Library/LibraryGrid";
import { SettingsPanel } from "./components/Settings/SettingsPanel";
import "./App.css";

function App() {
  const { videos, isScanning, isDbReady, dbError, initDb, scanAndImport } = useLibraryStore();
  const { play, currentVideo } = usePlayerStore();
  const [searchQuery, setSearchQuery] = useState("");
  const [showSettings, setShowSettings] = useState(false);

  useEffect(() => {
    initDb();
  }, []);

  const handlePickDir = async () => {
    const selected = await open({ directory: true, multiple: false });
    if (typeof selected === "string") {
      scanAndImport(selected);
    }
  };

  const filteredVideos = searchQuery.trim()
    ? videos.filter((v) =>
        (v.title ?? v.path).toLowerCase().includes(searchQuery.toLowerCase())
      )
    : videos;

  return (
    <main className="min-h-screen p-4 pb-28 bg-white text-gray-900 dark:bg-gray-950 dark:text-gray-100">
      <h1 className="text-2xl font-bold mb-4">Chuck Snap Stack</h1>

      {/* ツールバー */}
      <div className="flex gap-2 mb-4">
        <button
          type="button"
          className="px-4 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded disabled:opacity-50 text-sm dark:bg-blue-500 dark:hover:bg-blue-600"
          disabled={!isDbReady || isScanning}
          onClick={handlePickDir}
        >
          {isScanning ? "スキャン中..." : "フォルダを追加"}
        </button>
        <input
          className="flex-1 border border-gray-300 px-2 py-1.5 rounded text-sm bg-white text-gray-900 placeholder-gray-400 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 dark:placeholder-gray-500"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="動画を検索..."
          disabled={!isDbReady}
        />
        <button
          type="button"
          title="設定"
          className="px-3 py-1.5 bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 rounded text-sm border border-gray-300 dark:border-gray-600"
          onClick={() => setShowSettings(true)}
        >
          ⚙
        </button>
      </div>

      {showSettings && <SettingsPanel onClose={() => setShowSettings(false)} />}

      {!isDbReady && !dbError && (
        <p className="text-gray-500 text-sm dark:text-gray-400">DB 初期化中...</p>
      )}
      {dbError && (
        <p className="text-red-500 text-sm dark:text-red-400">DB エラー: {dbError}</p>
      )}

      {isDbReady && (
        <LibraryGrid
          videos={filteredVideos}
          currentVideoId={currentVideo?.id ?? null}
          onPlay={play}
        />
      )}

      <PlayerControls />
    </main>
  );
}

export default App;
