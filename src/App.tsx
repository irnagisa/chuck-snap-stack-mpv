import { useEffect, useState, useMemo } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { useLibraryStore } from "./store/useLibraryStore";
import { usePlayerStore } from "./store/usePlayerStore";
import { useTagStore } from "./store/useTagStore";
import { PlayerControls } from "./components/Player/PlayerControls";
import { LibraryGrid } from "./components/Library/LibraryGrid";
import { CategorySidebar } from "./components/Library/CategorySidebar";
import { VideoDetailModal } from "./components/Library/VideoDetailModal";
import { SettingsPanel } from "./components/Settings/SettingsPanel";
import type { Video } from "./types";
import "./App.css";

function App() {
  const { videos, isScanning, isDbReady, dbError, initDb, scanAndImport } = useLibraryStore();
  const { play, currentVideo } = usePlayerStore();
  const { tags, videoTags } = useTagStore();

  const [searchQuery, setSearchQuery] = useState("");
  const [showSettings, setShowSettings] = useState(false);
  const [selectedCategoryId, setSelectedCategoryId] = useState<number | null>(null);
  const [selectedTagIds, setSelectedTagIds] = useState<number[]>([]);
  const [detailVideo, setDetailVideo] = useState<Video | null>(null);

  useEffect(() => {
    initDb();
  }, []);

  const handlePickDir = async () => {
    const selected = await open({ directory: true, multiple: false });
    if (typeof selected === "string") {
      scanAndImport(selected);
    }
  };

  const toggleTag = (tagId: number) => {
    setSelectedTagIds((prev) =>
      prev.includes(tagId) ? prev.filter((id) => id !== tagId) : [...prev, tagId]
    );
  };

  const filteredVideos = useMemo(() => {
    let result = videos;
    if (searchQuery.trim()) {
      result = result.filter((v) =>
        (v.title ?? v.path).toLowerCase().includes(searchQuery.toLowerCase())
      );
    }
    if (selectedCategoryId !== null) {
      result = result.filter((v) => v.category_id === selectedCategoryId);
    }
    if (selectedTagIds.length > 0) {
      result = result.filter((v) =>
        (videoTags[v.id] ?? []).some((t) => selectedTagIds.includes(t.id))
      );
    }
    return result;
  }, [videos, searchQuery, selectedCategoryId, selectedTagIds, videoTags]);

  return (
    <main className="flex flex-col min-h-screen bg-white text-gray-900 dark:bg-gray-950 dark:text-gray-100">
      {/* ヘッダー / ツールバー */}
      <div className="px-4 pt-4 pb-3 flex gap-2 items-center border-b border-gray-100 dark:border-gray-800">
        <h1 className="text-lg font-bold mr-2 shrink-0">Chuck Snap Stack</h1>
        <button
          type="button"
          className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded disabled:opacity-50 text-sm dark:bg-blue-500 dark:hover:bg-blue-600 shrink-0"
          disabled={!isDbReady || isScanning}
          onClick={handlePickDir}
        >
          {isScanning ? "スキャン中..." : "+ フォルダ追加"}
        </button>
        <input
          className="flex-1 border border-gray-300 px-2 py-1.5 rounded text-sm bg-white text-gray-900 placeholder-gray-400 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 dark:placeholder-gray-500 min-w-0"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="動画を検索..."
          disabled={!isDbReady}
        />
        <button
          type="button"
          title="設定"
          className="px-3 py-1.5 bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 rounded text-sm border border-gray-300 dark:border-gray-600 shrink-0"
          onClick={() => setShowSettings(true)}
        >
          ⚙
        </button>
      </div>

      {showSettings && <SettingsPanel onClose={() => setShowSettings(false)} />}

      {/* ボディ: サイドバー + メインコンテンツ */}
      <div className="flex flex-1 px-4 pt-4 pb-28 gap-4 min-h-0">
        {/* カテゴリサイドバー */}
        {isDbReady && (
          <CategorySidebar
            selectedCategoryId={selectedCategoryId}
            onSelectCategory={setSelectedCategoryId}
          />
        )}

        {/* メインコンテンツ */}
        <div className="flex-1 min-w-0">
          {!isDbReady && !dbError && (
            <p className="text-gray-500 text-sm dark:text-gray-400">DB 初期化中...</p>
          )}
          {dbError && (
            <p className="text-red-500 text-sm dark:text-red-400">DB エラー: {dbError}</p>
          )}

          {isDbReady && (
            <>
              {/* タグフィルタバー */}
              {tags.length > 0 && (
                <div className="flex flex-wrap gap-1 mb-3">
                  {tags.map((tag) => (
                    <button
                      key={tag.id}
                      type="button"
                      className={`px-1.5 py-px rounded-full text-[10px] font-medium text-white transition-opacity ${
                        selectedTagIds.includes(tag.id) ? 'opacity-100 ring-2 ring-offset-1 ring-gray-400 dark:ring-offset-gray-950' : 'opacity-40 hover:opacity-70'
                      }`}
                      style={{ backgroundColor: tag.color }}
                      onClick={() => toggleTag(tag.id)}
                    >
                      {tag.name}
                    </button>
                  ))}
                  {selectedTagIds.length > 0 && (
                    <button
                      type="button"
                      className="px-2 py-0.5 rounded-full text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 border border-gray-300 dark:border-gray-600"
                      onClick={() => setSelectedTagIds([])}
                    >
                      クリア
                    </button>
                  )}
                </div>
              )}

              <LibraryGrid
                videos={filteredVideos}
                currentVideoId={currentVideo?.id ?? null}
                onPlay={play}
                onShowDetail={setDetailVideo}
              />
            </>
          )}
        </div>
      </div>

      <PlayerControls />

      {detailVideo && (
        <VideoDetailModal
          key={detailVideo.id}
          video={detailVideo}
          onClose={() => setDetailVideo(null)}
        />
      )}
    </main>
  );
}

export default App;
