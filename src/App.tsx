import { useEffect, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { useLibraryStore } from "./store/useLibraryStore";
import { usePlayerStore } from "./store/usePlayerStore";
import { PlayerControls } from "./components/Player/PlayerControls";
import "./App.css";

function App() {
  const { videos, isScanning, isDbReady, dbError, initDb, scanAndImport } = useLibraryStore();
  const { play, currentVideo } = usePlayerStore();
  const [dirPath, setDirPath] = useState("");

  useEffect(() => {
    initDb();
  }, []);

  const handleScan = (e: React.FormEvent) => {
    e.preventDefault();
    if (dirPath.trim()) {
      scanAndImport(dirPath.trim());
    }
  };

  const handlePickDir = async () => {
    const selected = await open({ directory: true, multiple: false });
    if (typeof selected === "string") {
      setDirPath(selected);
      scanAndImport(selected);
    }
  };

  return (
    <main className="p-4 pb-24">
      <h1 className="text-2xl font-bold mb-4">Chuck Snap Stack</h1>

      <form className="flex gap-2 mb-4" onSubmit={handleScan}>
        <input
          className="flex-1 border px-2 py-1 rounded"
          value={dirPath}
          onChange={(e) => setDirPath(e.target.value)}
          placeholder="/path/to/videos"
          disabled={!isDbReady || isScanning}
        />
        <button
          type="button"
          className="px-4 py-1 bg-gray-200 rounded disabled:opacity-50"
          disabled={!isDbReady || isScanning}
          onClick={handlePickDir}
        >
          フォルダ選択
        </button>
        <button
          type="submit"
          className="px-4 py-1 bg-blue-600 text-white rounded disabled:opacity-50"
          disabled={!isDbReady || isScanning}
        >
          {isScanning ? "スキャン中..." : "スキャン"}
        </button>
      </form>

      {!isDbReady && !dbError && <p className="text-gray-500">DB 初期化中...</p>}
      {dbError && <p className="text-red-500">DB エラー: {dbError}</p>}

      <ul className="space-y-1">
        {videos.map((v) => (
          <li
            key={v.id}
            className={`text-sm truncate cursor-pointer px-2 py-1 rounded hover:bg-gray-100 ${
              currentVideo?.id === v.id ? "bg-blue-50 text-blue-700 font-medium" : ""
            }`}
            onClick={() => play(v)}
          >
            {v.title ?? v.path}
          </li>
        ))}
      </ul>

      {isDbReady && videos.length === 0 && !isScanning && (
        <p className="text-gray-400 mt-4">動画が見つかりません。ディレクトリをスキャンしてください。</p>
      )}

      <PlayerControls />
    </main>
  );
}

export default App;
