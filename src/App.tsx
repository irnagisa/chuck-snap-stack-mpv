import { useEffect, useState, useMemo, useCallback } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { useLibraryStore } from "./store/useLibraryStore";
import { usePlayerStore } from "./store/usePlayerStore";
import { useKeyboardShortcuts } from "./hooks/useKeyboardShortcuts";
import { useWatcher } from "./hooks/useWatcher";
import { useTagStore } from "./store/useTagStore";
import { useTranscodeStore } from "./store/useTranscodeStore";
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
import { DownloadModal } from "./components/Library/DownloadModal";
import type { Video, Playlist } from "./types";

type SidebarTab = 'category' | 'playlist';
type BulkModal = 'delete' | 'tag' | 'category' | null;

function App() {
  const {
    videos, totalCount, currentPage, pageSize,
    filterSearch, filterCategoryId, filterTagIds, filterSortBy, filterSortOrder,
    isScanning, isThumbnailGenerating, isThumbnailPaused, thumbnailProgress,
    isDbReady, dbError,
    initDb, fetchVideos, scanAndImport, assignCategoryFromPath,
    setSearch, setCategoryFilter, toggleTagFilter, clearTagFilters, setSort, setPage,
    pauseThumbnails, resumeThumbnails,
  } = useLibraryStore();
  const { play, currentVideo } = usePlayerStore();
  const { tags } = useTagStore();
  const { isRunning: isTranscoding, isDone: isTranscodeDone, error: transcodeError, progress: transcodeProgress, videoName: transcodeVideoName, inputSizeBytes: transcodeInputSize, outputSizeBytes: transcodeOutputSize, cancel: cancelTranscode, dismiss: dismissTranscode } = useTranscodeStore();

  // Local input state for search — debounced before hitting the store/DB
  const [searchInput, setSearchInput] = useState(filterSearch);
  const [showSettings, setShowSettings] = useState(false);
  const [detailVideo, setDetailVideo] = useState<Video | null>(null);
  const [sidebarTab, setSidebarTab] = useState<SidebarTab>('category');
  const [activePlaylist, setActivePlaylist] = useState<Playlist | null>(null);
  const [addToPlaylistVideo, setAddToPlaylistVideo] = useState<Video | null>(null);
  const [selectedVideoIds, setSelectedVideoIds] = useState<Set<number>>(new Set());
  const [bulkModal, setBulkModal] = useState<BulkModal>(null);
  const [showDownload, setShowDownload] = useState(false);
  const [useDirAsCategory, setUseDirAsCategory] = useState(false);

  // Debounce search input → store
  useEffect(() => {
    const timer = setTimeout(() => {
      setSearch(searchInput);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchInput]);

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
      scanAndImport(selected, useDirAsCategory);
    }
  };

  const handleSetPage = (page: number) => {
    setSelectedVideoIds(new Set());
    setPage(page);
  };

  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));

  const selectedVideos = useMemo(
    () => videos.filter((v) => selectedVideoIds.has(v.id)),
    [videos, selectedVideoIds]
  );

  return (
    <main className="flex flex-col h-screen overflow-hidden bg-white text-gray-900 dark:bg-gray-950 dark:text-gray-100">
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
        <label className="flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400 shrink-0 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={useDirAsCategory}
            onChange={(e) => setUseDirAsCategory(e.target.checked)}
            className="accent-blue-600"
          />
          フォルダ名をカテゴリに
        </label>
        <button
          type="button"
          className="px-3 py-1.5 bg-green-600 hover:bg-green-700 text-white rounded disabled:opacity-50 text-sm dark:bg-green-500 dark:hover:bg-green-600 shrink-0"
          disabled={!isDbReady}
          onClick={() => setShowDownload(true)}
        >
          ↓ URL
        </button>
        <input
          className="flex-1 border border-gray-300 px-2 py-1.5 rounded text-sm bg-white text-gray-900 placeholder-gray-400 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 dark:placeholder-gray-500 min-w-0"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
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

      {isThumbnailGenerating && thumbnailProgress && (
        <div className="px-4 py-1.5 flex items-center gap-3 bg-gray-50 dark:bg-gray-900 border-b border-gray-100 dark:border-gray-800">
          <span className="text-xs text-gray-500 dark:text-gray-400 shrink-0">
            {isThumbnailPaused ? '一時停止中' : 'サムネイル生成中'} {thumbnailProgress.done}/{thumbnailProgress.total}
          </span>
          <div className="flex-1 bg-gray-200 dark:bg-gray-700 rounded-full h-1">
            <div
              className={`h-1 rounded-full transition-all duration-300 ${isThumbnailPaused ? 'bg-gray-400 dark:bg-gray-500' : 'bg-blue-500'}`}
              style={{ width: `${(thumbnailProgress.done / thumbnailProgress.total) * 100}%` }}
            />
          </div>
          {isThumbnailPaused ? (
            <button
              type="button"
              onClick={resumeThumbnails}
              className="text-xs px-2 py-0.5 rounded bg-blue-500 hover:bg-blue-600 text-white shrink-0"
            >
              再開
            </button>
          ) : (
            <button
              type="button"
              onClick={pauseThumbnails}
              className="text-xs px-2 py-0.5 rounded bg-gray-300 hover:bg-gray-400 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 shrink-0"
            >
              一時停止
            </button>
          )}
        </div>
      )}

      {/* AV1 変換ステータスバー */}
      {(isTranscoding || isTranscodeDone || transcodeError) && (
        <div style={{ zIndex: 60 }} className={`fixed bottom-20 left-1/2 -translate-x-1/2 w-full max-w-xl mx-auto px-4 py-2 flex items-center gap-3 rounded-xl shadow-lg border ${
          transcodeError
            ? 'bg-red-50 dark:bg-red-950 border-red-300 dark:border-red-700'
            : isTranscodeDone
            ? 'bg-green-50 dark:bg-green-950 border-green-300 dark:border-green-700'
            : 'bg-white dark:bg-gray-900 border-blue-300 dark:border-blue-700'
        }`}>
          <span className={`text-xs shrink-0 ${
            transcodeError ? 'text-red-500' : isTranscodeDone ? 'text-green-600 dark:text-green-400' : 'text-blue-600 dark:text-blue-400'
          }`}>
            {transcodeError ? '✕' : isTranscodeDone ? '✓' : '⟳'}
          </span>

          <span className={`text-xs shrink-0 font-medium truncate max-w-48 ${
            transcodeError ? 'text-red-700 dark:text-red-300' : isTranscodeDone ? 'text-green-700 dark:text-green-300' : 'text-blue-700 dark:text-blue-300'
          }`}>
            {transcodeError
              ? `変換失敗: ${transcodeVideoName}`
              : isTranscodeDone
              ? `変換完了: ${transcodeVideoName}`
              : `AV1 変換中: ${transcodeVideoName}`}
          </span>

          {isTranscodeDone && transcodeInputSize != null && transcodeOutputSize != null && (() => {
            const fmt = (b: number) => b >= 1073741824
              ? `${(b / 1073741824).toFixed(2)} GB`
              : `${(b / 1048576).toFixed(1)} MB`;
            const saved = transcodeInputSize - transcodeOutputSize;
            const ratio = ((saved / transcodeInputSize) * 100).toFixed(1);
            return (
              <span className="text-xs text-green-600 dark:text-green-400 shrink-0">
                {fmt(transcodeInputSize)} → {fmt(transcodeOutputSize)}
                {saved > 0 && ` (−${ratio}%)`}
              </span>
            );
          })()}

          {isTranscoding && (
            <>
              <div className="flex-1 bg-blue-200 dark:bg-blue-900/50 rounded-full h-1.5 min-w-0">
                <div
                  className={`h-1.5 rounded-full transition-all duration-300 ${
                    transcodeProgress && transcodeProgress.percent > 0
                      ? 'bg-blue-500'
                      : 'bg-blue-400 animate-pulse w-full'
                  }`}
                  style={{
                    width: transcodeProgress && transcodeProgress.percent > 0
                      ? `${transcodeProgress.percent}%`
                      : undefined,
                  }}
                />
              </div>
              <span className="text-xs text-blue-600 dark:text-blue-400 shrink-0 tabular-nums">
                {transcodeProgress && transcodeProgress.percent > 0
                  ? `${transcodeProgress.percent.toFixed(1)}%`
                  : '開始中...'}
              </span>
              {transcodeProgress && transcodeProgress.speed && transcodeProgress.speed !== 'N/A' && (
                <span className="text-xs text-blue-500 dark:text-blue-500 shrink-0">
                  {transcodeProgress.speed}
                </span>
              )}
              <button
                type="button"
                className="text-xs text-red-500 hover:text-red-700 dark:hover:text-red-300 shrink-0 ml-auto"
                onClick={cancelTranscode}
              >
                キャンセル
              </button>
            </>
          )}

          {(isTranscodeDone || transcodeError) && (
            <button
              type="button"
              className="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 shrink-0 ml-auto"
              onClick={dismissTranscode}
            >
              ✕
            </button>
          )}
        </div>
      )}

      {showSettings && <SettingsPanel onClose={() => setShowSettings(false)} />}

      {showDownload && <DownloadModal onClose={() => setShowDownload(false)} />}

      {/* ボディ: サイドバー + メインコンテンツ */}
      <div className="flex flex-1 px-4 pt-4 pb-20 gap-4 min-h-0">
        {/* サイドバー */}
        {isDbReady && (
          <div className="w-44 shrink-0 flex flex-col gap-2 min-h-0">
            <div className="flex gap-1 text-xs shrink-0">
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

            <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden">
              {sidebarTab === 'category' ? (
                <CategorySidebar
                  selectedCategoryId={filterCategoryId}
                  onSelectCategory={setCategoryFilter}
                />
              ) : (
                <PlaylistSidebar onOpenPlaylist={setActivePlaylist} />
              )}
            </div>
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
                <div className="flex flex-wrap gap-1 flex-1 min-w-0">
                  {tags.length > 0 ? (
                    <>
                      {tags.map((tag) => (
                        <button
                          key={tag.id}
                          type="button"
                          className={`px-1.5 py-px rounded-full text-[10px] font-medium text-white transition-opacity ${
                            filterTagIds.includes(tag.id)
                              ? 'opacity-100 ring-2 ring-offset-1 ring-gray-400 dark:ring-offset-gray-950'
                              : 'opacity-40 hover:opacity-70'
                          }`}
                          style={{ backgroundColor: tag.color }}
                          onClick={() => toggleTagFilter(tag.id)}
                        >
                          {tag.name}
                        </button>
                      ))}
                      {filterTagIds.length > 0 && (
                        <button
                          type="button"
                          className="px-2 py-0.5 rounded-full text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 border border-gray-300 dark:border-gray-600"
                          onClick={() => clearTagFilters()}
                        >
                          クリア
                        </button>
                      )}
                    </>
                  ) : null}
                </div>

                <div className="flex items-center gap-1 shrink-0">
                  <select
                    className="px-2 py-1 text-xs border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300"
                    value={filterSortBy}
                    onChange={(e) => setSort(e.target.value as typeof filterSortBy, filterSortOrder)}
                  >
                    <option value="created_at">追加日</option>
                    <option value="duration">長さ</option>
                    <option value="rating">評価</option>
                  </select>
                  <button
                    type="button"
                    className="px-2 py-1 text-xs border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 font-mono"
                    title={filterSortOrder === 'desc' ? '降順 (クリックで昇順)' : '昇順 (クリックで降順)'}
                    onClick={() => setSort(filterSortBy, filterSortOrder === 'desc' ? 'asc' : 'desc')}
                  >
                    {filterSortOrder === 'desc' ? '↓' : '↑'}
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
                    className="px-2.5 py-1 text-xs bg-teal-600 hover:bg-teal-700 text-white rounded"
                    onClick={async () => {
                      await assignCategoryFromPath(Array.from(selectedVideoIds));
                      setSelectedVideoIds(new Set());
                    }}
                  >
                    フォルダ名をカテゴリに
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
                  videos={videos}
                  currentVideoId={currentVideo?.id ?? null}
                  onPlay={play}
                  onShowDetail={setDetailVideo}
                  onAddToPlaylist={setAddToPlaylistVideo}
                  selectedIds={selectedVideoIds}
                  onSelectionChange={setSelectedVideoIds}
                />
              </div>

              {/* ページネーション */}
              {totalPages > 1 && (
                <div className="flex items-center justify-center gap-3 py-2 shrink-0 border-t border-gray-100 dark:border-gray-800">
                  <button
                    type="button"
                    className="px-2.5 py-1 text-xs border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-40 disabled:cursor-not-allowed"
                    disabled={currentPage <= 1}
                    onClick={() => handleSetPage(currentPage - 1)}
                  >
                    ← 前
                  </button>
                  <span className="text-xs text-gray-500 dark:text-gray-400 tabular-nums">
                    {currentPage} / {totalPages}
                    <span className="ml-2 text-gray-400 dark:text-gray-500">({totalCount.toLocaleString()}件)</span>
                  </span>
                  <button
                    type="button"
                    className="px-2.5 py-1 text-xs border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-40 disabled:cursor-not-allowed"
                    disabled={currentPage >= totalPages}
                    onClick={() => handleSetPage(currentPage + 1)}
                  >
                    次 →
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <PlayerControls />

      {detailVideo && (
        <VideoDetailModal
          key={detailVideo.id}
          video={detailVideo}
          onClose={() => {
            setDetailVideo(null);
            fetchVideos();
          }}
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
          onDone={() => {
            setBulkModal(null);
            setSelectedVideoIds(new Set());
            fetchVideos();
          }}
        />
      )}

      {bulkModal === 'category' && (
        <BulkCategoryModal
          videoIds={Array.from(selectedVideoIds)}
          onClose={() => setBulkModal(null)}
          onDone={() => {
            setBulkModal(null);
            setSelectedVideoIds(new Set());
            fetchVideos();
          }}
        />
      )}
    </main>
  );
}

export default App;
