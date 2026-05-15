import { useEffect, useState, useMemo, useCallback } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { useLibraryStore } from "./store/useLibraryStore";
import { usePlayerStore } from "./store/usePlayerStore";
import { useKeyboardShortcuts } from "./hooks/useKeyboardShortcuts";
import { useWatcher } from "./hooks/useWatcher";
import { useTagStore } from "./store/useTagStore";
import { PlayerControls } from "./components/Player/PlayerControls";
import { LibraryGrid } from "./components/Library/LibraryGrid";
import { CategorySidebar } from "./components/Library/CategorySidebar";
import { PlaylistSidebar } from "./components/Library/PlaylistSidebar";
import { PlaylistModal } from "./components/Library/PlaylistModal";
import { AddToPlaylistModal } from "./components/Library/AddToPlaylistModal";
import { VideoDetailModal } from "./components/Library/VideoDetailModal";
import { SettingsPanel } from "./components/Settings/SettingsPanel";
import { BulkDeleteModal } from "./components/Library/BulkDeleteModal";
import { BulkTagModal } from "./components/Library/BulkTagModal";
import { BulkCategoryModal } from "./components/Library/BulkCategoryModal";
import type { Video, Playlist } from "./types";

type SortBy = 'created_at' | 'duration' | 'rating';
type SortOrder = 'desc' | 'asc';
type SidebarTab = 'category' | 'playlist';
type BulkModal = 'delete' | 'tag' | 'category' | null;

function App() {
  const { videos, isScanning, isDbReady, dbError, initDb, scanAndImport } = useLibraryStore();
  const { play, currentVideo } = usePlayerStore();
  const { tags, videoTags } = useTagStore();

  const [searchQuery, setSearchQuery] = useState("");
  const [showSettings, setShowSettings] = useState(false);
  const [selectedCategoryId, setSelectedCategoryId] = useState<number | null>(null);
  const [selectedTagIds, setSelectedTagIds] = useState<number[]>([]);
  const [detailVideo, setDetailVideo] = useState<Video | null>(null);
  const [sortBy, setSortBy] = useState<SortBy>('created_at');
  const [sortOrder, setSortOrder] = useState<SortOrder>('desc');
  const [sidebarTab, setSidebarTab] = useState<SidebarTab>('category');
  const [activePlaylist, setActivePlaylist] = useState<Playlist | null>(null);
  const [addToPlaylistVideo, setAddToPlaylistVideo] = useState<Video | null>(null);
  const [selectedVideoIds, setSelectedVideoIds] = useState<Set<number>>(new Set());
  const [bulkModal, setBulkModal] = useState<BulkModal>(null);

  const closeAllModals = useCallback(() => {
    setShowSettings(false);
    setDetailVideo(null);
    setActivePlaylist(null);
    setAddToPlaylistVideo(null);
    setBulkModal(null);
  }, []);

  useKeyboardShortcuts({ onEscape: closeAllModals });
  useWatcher();

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

    return [...result].sort((a, b) => {
      let av: number;
      let bv: number;
      switch (sortBy) {
        case 'duration':
          av = a.duration ?? -1;
          bv = b.duration ?? -1;
          break;
        case 'rating':
          av = a.rating;
          bv = b.rating;
          break;
        default:
          av = new Date(a.created_at).getTime();
          bv = new Date(b.created_at).getTime();
      }
      return sortOrder === 'desc' ? bv - av : av - bv;
    });
  }, [videos, searchQuery, selectedCategoryId, selectedTagIds, videoTags, sortBy, sortOrder]);

  const selectedVideos = useMemo(
    () => videos.filter((v) => selectedVideoIds.has(v.id)),
    [videos, selectedVideoIds]
  );

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
        {/* サイドバー */}
        {isDbReady && (
          <div className="w-44 shrink-0 flex flex-col gap-2">
            {/* タブ */}
            <div className="flex gap-1 text-xs">
              <button
                type="button"
                className={`flex-1 py-1 rounded font-medium transition-colors ${
                  sidebarTab === 'category'
                    ? 'bg-gray-200 dark:bg-gray-700 text-gray-900 dark:text-gray-100'
                    : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
                }`}
                onClick={() => setSidebarTab('category')}
              >
                カテゴリ
              </button>
              <button
                type="button"
                className={`flex-1 py-1 rounded font-medium transition-colors ${
                  sidebarTab === 'playlist'
                    ? 'bg-gray-200 dark:bg-gray-700 text-gray-900 dark:text-gray-100'
                    : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
                }`}
                onClick={() => setSidebarTab('playlist')}
              >
                リスト
              </button>
            </div>

            {sidebarTab === 'category' ? (
              <CategorySidebar
                selectedCategoryId={selectedCategoryId}
                onSelectCategory={setSelectedCategoryId}
              />
            ) : (
              <PlaylistSidebar onOpenPlaylist={setActivePlaylist} />
            )}
          </div>
        )}

        {/* メインコンテンツ */}
        <div className="flex flex-col flex-1 min-w-0 min-h-0 overflow-hidden">
          {!isDbReady && !dbError && (
            <p className="text-gray-500 text-sm dark:text-gray-400">DB 初期化中...</p>
          )}
          {dbError && (
            <p className="text-red-500 text-sm dark:text-red-400">DB エラー: {dbError}</p>
          )}

          {isDbReady && (
            <div className="flex flex-col flex-1 min-h-0">
              {/* フィルタ・ソートバー */}
              <div className="flex items-start gap-2 mb-3 shrink-0">
                {/* タグフィルタ */}
                <div className="flex flex-wrap gap-1 flex-1 min-w-0">
                  {tags.length > 0 ? (
                    <>
                      {tags.map((tag) => (
                        <button
                          key={tag.id}
                          type="button"
                          className={`px-1.5 py-px rounded-full text-[10px] font-medium text-white transition-opacity ${
                            selectedTagIds.includes(tag.id)
                              ? 'opacity-100 ring-2 ring-offset-1 ring-gray-400 dark:ring-offset-gray-950'
                              : 'opacity-40 hover:opacity-70'
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
                    </>
                  ) : null}
                </div>

                {/* ソートコントロール */}
                <div className="flex items-center gap-1 shrink-0">
                  <select
                    className="px-2 py-1 text-xs border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300"
                    value={sortBy}
                    onChange={(e) => setSortBy(e.target.value as SortBy)}
                  >
                    <option value="created_at">追加日</option>
                    <option value="duration">長さ</option>
                    <option value="rating">評価</option>
                  </select>
                  <button
                    type="button"
                    className="px-2 py-1 text-xs border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 font-mono"
                    title={sortOrder === 'desc' ? '降順 (クリックで昇順)' : '昇順 (クリックで降順)'}
                    onClick={() => setSortOrder((o) => (o === 'desc' ? 'asc' : 'desc'))}
                  >
                    {sortOrder === 'desc' ? '↓' : '↑'}
                  </button>
                </div>
              </div>

              {/* バッチ操作バー */}
              {selectedVideoIds.size > 0 && (
                <div className="flex items-center gap-2 mb-3 px-3 py-2 bg-blue-50 dark:bg-blue-950/50 border border-blue-200 dark:border-blue-800 rounded-lg shrink-0">
                  <span className="text-xs font-medium text-blue-700 dark:text-blue-300 shrink-0">
                    {selectedVideoIds.size} 件選択中
                  </span>
                  <button
                    type="button"
                    className="px-2.5 py-1 text-xs bg-blue-600 hover:bg-blue-700 text-white rounded"
                    onClick={() => setBulkModal('tag')}
                  >
                    タグ設定
                  </button>
                  <button
                    type="button"
                    className="px-2.5 py-1 text-xs bg-purple-600 hover:bg-purple-700 text-white rounded"
                    onClick={() => setBulkModal('category')}
                  >
                    カテゴリ設定
                  </button>
                  <button
                    type="button"
                    className="px-2.5 py-1 text-xs bg-red-600 hover:bg-red-700 text-white rounded"
                    onClick={() => setBulkModal('delete')}
                  >
                    削除
                  </button>
                  <button
                    type="button"
                    className="ml-auto text-xs text-blue-500 dark:text-blue-400 hover:underline"
                    onClick={() => setSelectedVideoIds(new Set())}
                  >
                    選択解除
                  </button>
                </div>
              )}

              <div className="flex-1 min-h-0">
                <LibraryGrid
                  videos={filteredVideos}
                  currentVideoId={currentVideo?.id ?? null}
                  onPlay={play}
                  onShowDetail={setDetailVideo}
                  onAddToPlaylist={setAddToPlaylistVideo}
                  selectedIds={selectedVideoIds}
                  onSelectionChange={setSelectedVideoIds}
                />
              </div>
            </div>
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

      {activePlaylist && (
        <PlaylistModal
          playlist={activePlaylist}
          onClose={() => setActivePlaylist(null)}
        />
      )}

      {addToPlaylistVideo && (
        <AddToPlaylistModal
          video={addToPlaylistVideo}
          onClose={() => setAddToPlaylistVideo(null)}
        />
      )}

      {bulkModal === 'delete' && selectedVideos.length > 0 && (
        <BulkDeleteModal
          videos={selectedVideos}
          onClose={() => setBulkModal(null)}
          onDone={() => {
            setBulkModal(null);
            setSelectedVideoIds(new Set());
          }}
        />
      )}

      {bulkModal === 'tag' && (
        <BulkTagModal
          videoIds={Array.from(selectedVideoIds)}
          onClose={() => setBulkModal(null)}
          onDone={() => setBulkModal(null)}
        />
      )}

      {bulkModal === 'category' && (
        <BulkCategoryModal
          videoIds={Array.from(selectedVideoIds)}
          onClose={() => setBulkModal(null)}
          onDone={() => setBulkModal(null)}
        />
      )}
    </main>
  );
}

export default App;
