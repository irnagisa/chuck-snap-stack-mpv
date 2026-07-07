import { useEffect, useState, useMemo, useCallback, useRef } from "react";
import { useTranslation } from "react-i18next";
import type { Video, ScanResult } from "./types";
import { open } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import { useLibraryStore } from "./store/useLibraryStore";
import { useShallow } from "zustand/shallow";
import { usePlayerStore } from "./store/usePlayerStore";
import { useKeyboardShortcuts } from "./hooks/useKeyboardShortcuts";
import { useWatcher } from "./hooks/useWatcher";
import { useDragDrop } from "./hooks/useDragDrop";
import { useTheme } from "./hooks/useTheme";
import { useTagStore } from "./store/useTagStore";
import { useModalStore } from "./store/useModalStore";
import { PlayerControls } from "./components/Player/PlayerControls";
import { MiniPlayer } from "./components/Player/MiniPlayer";
import { LibraryGrid } from "./components/Library/LibraryGrid";
import type { LibraryViewHandle } from "./components/Library/LibraryGrid";
import { LibraryList } from "./components/Library/LibraryList";
import { AppModals } from "./components/AppModals";
import { VideoDetailModal } from "./components/Library/VideoDetailModal";
import { ToastContainer } from "./components/common/ToastContainer";
import { DownloadQueuePanel } from "./components/common/DownloadQueuePanel";
import { ImageViewerModal } from "./components/Library/ImageViewerModal";
import { ConfirmModal } from "./components/common/ConfirmModal";
import { ErrorBoundary } from "./components/common/ErrorBoundary";
import { AppHeader } from "./components/AppHeader";
import { ThumbnailProgressBar } from "./components/ThumbnailProgressBar";
import { TranscodeStatusBar } from "./components/TranscodeStatusBar";
import { LibrarySidebar } from "./components/Library/LibrarySidebar";
import { LibraryFilterBar } from "./components/Library/LibraryFilterBar";
import { BatchActionBar } from "./components/Library/BatchActionBar";
import InboxView from "./components/Inbox/InboxView";
import { useInboxStore } from "./store/useInboxStore";
import type { Playlist } from "./types";

type SidebarTab = "category" | "playlist" | "folder";
type MainView = "library" | "inbox";

function App() {
  const { t } = useTranslation();
  const {
    videos, totalCount, currentPage, pageSize,
    filterSearch, filterCategoryId, filterTagIds, filterTagMode,
    filterMinRating, filterHasAudio, filterMinDuration, filterMaxDuration,
    filterWatchedStatus, filterWatchDir, filterMediaType, filterSortBy, filterSortOrder,
    isThumbnailGenerating, isDbReady, dbError,
  } = useLibraryStore(useShallow((s) => ({
    videos: s.videos,
    totalCount: s.totalCount,
    currentPage: s.currentPage,
    pageSize: s.pageSize,
    filterSearch: s.filterSearch,
    filterCategoryId: s.filterCategoryId,
    filterTagIds: s.filterTagIds,
    filterTagMode: s.filterTagMode,
    filterMinRating: s.filterMinRating,
    filterHasAudio: s.filterHasAudio,
    filterMinDuration: s.filterMinDuration,
    filterMaxDuration: s.filterMaxDuration,
    filterWatchedStatus: s.filterWatchedStatus,
    filterWatchDir: s.filterWatchDir,
    filterMediaType: s.filterMediaType,
    filterSortBy: s.filterSortBy,
    filterSortOrder: s.filterSortOrder,
    isThumbnailGenerating: s.isThumbnailGenerating,
    isDbReady: s.isDbReady,
    dbError: s.dbError,
  })));
  const {
    initDb, scanAndImport,
    setSearch, setCategoryFilter, toggleTagFilter, clearTagFilters, setTagMode,
    setMinRating, setHasAudio, setMinDuration, setMaxDuration,
    setWatchedStatus, setWatchDirFilter, setMediaType, setSort, setPage,
    fetchVideos, fetchAllForShuffle,
  } = useLibraryStore(useShallow((s) => ({
    initDb: s.initDb,
    scanAndImport: s.scanAndImport,
    setSearch: s.setSearch,
    setCategoryFilter: s.setCategoryFilter,
    toggleTagFilter: s.toggleTagFilter,
    clearTagFilters: s.clearTagFilters,
    setTagMode: s.setTagMode,
    setMinRating: s.setMinRating,
    setHasAudio: s.setHasAudio,
    setMinDuration: s.setMinDuration,
    setMaxDuration: s.setMaxDuration,
    setWatchedStatus: s.setWatchedStatus,
    setWatchDirFilter: s.setWatchDirFilter,
    setMediaType: s.setMediaType,
    setSort: s.setSort,
    setPage: s.setPage,
    fetchVideos: s.fetchVideos,
    fetchAllForShuffle: s.fetchAllForShuffle,
  })));

  const currentVideo = usePlayerStore((s) => s.currentVideo);
  const isMiniPlayer = usePlayerStore((s) => s.isMiniPlayer);
  const playWithQueue = usePlayerStore((s) => s.playWithQueue);
  const playShuffleAll = usePlayerStore((s) => s.playShuffleAll);
  const tags = useTagStore((s) => s.tags);
  const { openBulkModal, openAddToPlaylist, openPlaylist, openDetailVideo, openSmartPlaylist, detailVideo, closeDetailVideo, closeAll } = useModalStore();
  const inboxCount = useInboxStore((s) => s.stats?.inboxCount ?? 0);

  useTheme();
  useKeyboardShortcuts({ onEscape: () => { setViewingImage(null); closeAll(); } });
  useWatcher();
  const { isDragging } = useDragDrop();

  const [mainView, setMainView] = useState<MainView>("library");
  const [searchInput, setSearchInput] = useState(filterSearch);
  const [gridItemMinWidth, setGridItemMinWidth] = useState<number>(() => {
    const presets = [120, 180, 240, 320];
    const saved = localStorage.getItem("gridItemMinWidth");
    if (!saved) return 180;
    const n = Number(saved);
    return presets.reduce((prev, cur) =>
      Math.abs(cur - n) < Math.abs(prev - n) ? cur : prev
    );
  });
  const [viewMode, setViewMode] = useState<"grid" | "list">(
    () => (localStorage.getItem("viewMode") as "grid" | "list") ?? "grid"
  );
  const [listItemSize, setListItemSize] = useState<"S" | "M" | "L" | "XL">(
    () => (localStorage.getItem("listItemSize") as "S" | "M" | "L" | "XL") ?? "M"
  );
  const [durationInput, setDurationInput] = useState(
    filterMinDuration > 0 ? String(filterMinDuration) : ""
  );
  const [maxDurationInput, setMaxDurationInput] = useState(
    filterMaxDuration > 0 ? String(filterMaxDuration) : ""
  );
  const [sidebarTab, setSidebarTab] = useState<SidebarTab>("category");
  const [selectedVideoIds, setSelectedVideoIds] = useState<Set<number>>(new Set());
  const [useDirAsCategory, setUseDirAsCategory] = useState(false);
  const [viewingImage, setViewingImage] = useState<Video | null>(null);
  const [pendingImport, setPendingImport] = useState<{
    path: string;
    fileCount: number;
    useDirAsCategory: boolean;
  } | null>(null);

  const libraryRef = useRef<LibraryViewHandle>(null);
  const pendingScrollIdRef = useRef<number | null>(null);

  useEffect(() => { localStorage.setItem("gridItemMinWidth", String(gridItemMinWidth)); }, [gridItemMinWidth]);
  useEffect(() => { localStorage.setItem("viewMode", viewMode); }, [viewMode]);
  useEffect(() => { localStorage.setItem("listItemSize", listItemSize); }, [listItemSize]);

  // Debounce search
  useEffect(() => {
    const timer = setTimeout(() => setSearch(searchInput), 500);
    return () => clearTimeout(timer);
  }, [searchInput]);

  // Debounce duration
  useEffect(() => {
    const timer = setTimeout(() => {
      const s = parseInt(durationInput, 10);
      setMinDuration(isNaN(s) || s <= 0 ? 0 : s);
    }, 500);
    return () => clearTimeout(timer);
  }, [durationInput]);

  useEffect(() => {
    const timer = setTimeout(() => {
      const s = parseInt(maxDurationInput, 10);
      setMaxDuration(isNaN(s) || s <= 0 ? 0 : s);
    }, 500);
    return () => clearTimeout(timer);
  }, [maxDurationInput]);

  useEffect(() => { initDb(); }, []);

  // 再生中の動画が変わったら詳細パネルも追従
  useEffect(() => {
    if (!currentVideo) return;
    if (useModalStore.getState().detailVideo) {
      openDetailVideo(currentVideo);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentVideo?.id]);

  // 詳細パネル対象が変わったらライブラリをスクロール
  useEffect(() => {
    const targetId = detailVideo?.id;
    if (!targetId) return;
    const inPage = videos.find((v) => v.id === targetId);
    if (inPage) { libraryRef.current?.scrollToId(targetId); return; }
    fetchAllForShuffle().then((all) => {
      const pos = all.findIndex((v) => v.id === targetId);
      if (pos < 0) return;
      pendingScrollIdRef.current = targetId;
      handleSetPage(Math.floor(pos / pageSize) + 1);
    }).catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detailVideo?.id]);

  // ページ移動後に pendingScroll を消化
  useEffect(() => {
    const pendingId = pendingScrollIdRef.current;
    if (!pendingId) return;
    if (videos.find((v) => v.id === pendingId)) {
      pendingScrollIdRef.current = null;
      setTimeout(() => libraryRef.current?.scrollToId(pendingId), 80);
    }
  }, [videos]);

  const IMPORT_CONFIRM_THRESHOLD = 300;

  const handlePickDir = async () => {
    const selected = await open({ directory: true, multiple: false });
    if (typeof selected !== "string") return;
    const previewResult = await invoke<ScanResult>("scan_directory", { path: selected }).catch(() => null);
    if (!previewResult || previewResult.files.length < IMPORT_CONFIRM_THRESHOLD) {
      scanAndImport(selected, useDirAsCategory);
      return;
    }
    setPendingImport({ path: selected, fileCount: previewResult.files.length, useDirAsCategory });
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

  const scrollResetKey = useMemo(
    () =>
      [
        filterSearch, filterCategoryId, filterTagIds.join(","), filterTagMode,
        filterMinRating, filterHasAudio, filterMinDuration, filterMaxDuration,
        filterWatchedStatus, filterWatchDir, filterMediaType,
        filterSortBy, filterSortOrder, currentPage,
      ].join("|"),
    [
      filterSearch, filterCategoryId, filterTagIds, filterTagMode,
      filterMinRating, filterHasAudio, filterMinDuration, filterMaxDuration,
      filterWatchedStatus, filterWatchDir, filterMediaType,
      filterSortBy, filterSortOrder, currentPage,
    ]
  );

  const handlePlay = useCallback(
    (v: Video) => {
      if (v.media_type === "image") { setViewingImage(v); return; }
      playWithQueue(videos, videos.findIndex((x) => x.id === v.id));
    },
    [videos, playWithQueue]
  );

  const handleContextSetTag = useCallback(
    (v: Video) => { setSelectedVideoIds(new Set([v.id])); openBulkModal("tag"); },
    [openBulkModal]
  );

  const handleContextSetCategory = useCallback(
    (v: Video) => { setSelectedVideoIds(new Set([v.id])); openBulkModal("category"); },
    [openBulkModal]
  );

  const imageList = useMemo(() => videos.filter((v) => v.media_type === "image"), [videos]);

  return (
    <main className="flex flex-col h-screen overflow-hidden bg-white text-gray-900 dark:bg-gray-950 dark:text-gray-100">
      {isMiniPlayer ? (
        <MiniPlayer />
      ) : (
        <>
          <AppHeader
            mainView={mainView}
            inboxCount={inboxCount}
            searchInput={searchInput}
            useDirAsCategory={useDirAsCategory}
            onMainViewChange={setMainView}
            onSearchChange={setSearchInput}
            onSearchClear={() => setSearchInput("")}
            onPickDir={handlePickDir}
            onUseDirAsCategoryChange={setUseDirAsCategory}
          />

          <ThumbnailProgressBar />

          <TranscodeStatusBar />

          {/* ボディ */}
          <div className="flex flex-1 min-h-0">
            {mainView === "inbox" ? (
              <div className="flex flex-1 min-h-0 min-w-0">
                <ErrorBoundary>
                  <InboxView />
                </ErrorBoundary>
              </div>
            ) : (
              <div className="flex flex-1 px-4 pt-4 pb-10 gap-4 min-h-0">
                {isDbReady && (
                  <LibrarySidebar
                    sidebarTab={sidebarTab}
                    onTabChange={setSidebarTab}
                    selectedCategoryId={filterCategoryId}
                    onSelectCategory={setCategoryFilter}
                    selectedDir={filterWatchDir}
                    onSelectDir={setWatchDirFilter}
                    onOpenPlaylist={(pl: Playlist) => openPlaylist(pl)}
                  />
                )}

                <div className="flex flex-col flex-1 min-w-0 min-h-0 overflow-hidden">
                  {!isDbReady && !dbError && (
                    <p className="text-gray-500 text-sm dark:text-gray-400">
                      {t("app.dbInitializing")}
                    </p>
                  )}
                  {dbError && (
                    <p className="text-red-500 text-sm dark:text-red-400">
                      {t("app.dbError", { error: dbError })}
                    </p>
                  )}

                  {isDbReady && (
                    <ErrorBoundary>
                      <div className="flex flex-col flex-1 min-h-0">
                        <LibraryFilterBar
                          tags={tags}
                          filterTagIds={filterTagIds}
                          filterTagMode={filterTagMode}
                          filterSortBy={filterSortBy}
                          filterSortOrder={filterSortOrder}
                          filterMinRating={filterMinRating}
                          filterHasAudio={filterHasAudio}
                          filterWatchedStatus={filterWatchedStatus}
                          filterMediaType={filterMediaType}
                          filterMinDuration={filterMinDuration}
                          filterMaxDuration={filterMaxDuration}
                          durationInput={durationInput}
                          maxDurationInput={maxDurationInput}
                          totalCount={totalCount}
                          viewMode={viewMode}
                          gridItemMinWidth={gridItemMinWidth}
                          listItemSize={listItemSize}
                          onToggleTag={toggleTagFilter}
                          onClearTags={clearTagFilters}
                          onSetTagMode={setTagMode}
                          onSetSort={setSort}
                          onSetMinRating={setMinRating}
                          onSetHasAudio={setHasAudio}
                          onSetWatchedStatus={setWatchedStatus}
                          onSetMediaType={setMediaType}
                          onDurationInputChange={setDurationInput}
                          onMaxDurationInputChange={setMaxDurationInput}
                          onShuffleAll={playShuffleAll}
                          onSaveSmartPlaylist={openSmartPlaylist}
                          onSetViewMode={setViewMode}
                          onSetGridItemMinWidth={setGridItemMinWidth}
                          onSetListItemSize={setListItemSize}
                        />

                        <BatchActionBar
                          selectedVideoIds={selectedVideoIds}
                          isThumbnailGenerating={isThumbnailGenerating}
                          onClearSelection={() => setSelectedVideoIds(new Set())}
                        />

                        <div className="flex-1 min-h-0">
                          {viewMode === "list" ? (
                            <LibraryList
                              ref={libraryRef}
                              videos={videos}
                              currentVideoId={currentVideo?.id ?? null}
                              detailVideoId={detailVideo?.id ?? null}
                              scrollResetKey={scrollResetKey}
                              listRowSize={listItemSize}
                              onPlay={handlePlay}
                              onShowDetail={openDetailVideo}
                              onAddToPlaylist={openAddToPlaylist}
                              onSetTag={handleContextSetTag}
                              onSetCategory={handleContextSetCategory}
                              selectedIds={selectedVideoIds}
                              onSelectionChange={setSelectedVideoIds}
                            />
                          ) : (
                            <LibraryGrid
                              ref={libraryRef}
                              videos={videos}
                              currentVideoId={currentVideo?.id ?? null}
                              detailVideoId={detailVideo?.id ?? null}
                              scrollResetKey={scrollResetKey}
                              itemMinWidth={gridItemMinWidth}
                              onPlay={handlePlay}
                              onShowDetail={openDetailVideo}
                              onAddToPlaylist={openAddToPlaylist}
                              onSetTag={handleContextSetTag}
                              onSetCategory={handleContextSetCategory}
                              selectedIds={selectedVideoIds}
                              onSelectionChange={setSelectedVideoIds}
                            />
                          )}
                        </div>

                        {totalPages > 1 && (
                          <div className="flex items-center justify-center gap-3 py-2 shrink-0 border-t border-gray-100 dark:border-gray-800">
                            <button
                              type="button"
                              className="px-2.5 py-1 text-xs border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-40 disabled:cursor-not-allowed"
                              disabled={currentPage <= 1}
                              onClick={() => handleSetPage(currentPage - 1)}
                            >
                              {t("pagination.prev")}
                            </button>
                            <span className="text-xs text-gray-500 dark:text-gray-400 tabular-nums">
                              {currentPage} / {totalPages}
                              <span className="ml-2 text-gray-400 dark:text-gray-500">
                                {t("pagination.count", { count: totalCount.toLocaleString() })}
                              </span>
                            </span>
                            <button
                              type="button"
                              className="px-2.5 py-1 text-xs border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-40 disabled:cursor-not-allowed"
                              disabled={currentPage >= totalPages}
                              onClick={() => handleSetPage(currentPage + 1)}
                            >
                              {t("pagination.next")}
                            </button>
                          </div>
                        )}
                      </div>
                    </ErrorBoundary>
                  )}
                </div>

                {/* 詳細パネル */}
                <div className="w-80 shrink-0 border-l border-gray-200 dark:border-gray-800 flex flex-col overflow-hidden">
                  {detailVideo ? (
                    <VideoDetailModal
                      key={detailVideo.id}
                      video={detailVideo}
                      onClose={() => { closeDetailVideo(); fetchVideos(); }}
                      onViewImage={setViewingImage}
                    />
                  ) : (
                    <div className="flex flex-col items-center justify-center h-full text-gray-400 dark:text-gray-600 select-none gap-2">
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        className="w-10 h-10 opacity-40"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        strokeWidth={1.2}
                      >
                        <rect x="3" y="5" width="18" height="14" rx="2" strokeLinecap="round" strokeLinejoin="round" />
                        <path d="M10 9l5 3-5 3V9z" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                      <p className="text-xs">動画を選択してください</p>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {mainView !== "inbox" && <PlayerControls />}
        </>
      )}

      {viewingImage && (
        <ImageViewerModal
          video={viewingImage}
          allImages={imageList}
          onClose={() => setViewingImage(null)}
          onNavigate={setViewingImage}
        />
      )}

      <AppModals
        selectedVideoIds={selectedVideoIds}
        selectedVideos={selectedVideos}
        onClearSelection={() => setSelectedVideoIds(new Set())}
      />

      <DownloadQueuePanel />
      <ToastContainer />

      {pendingImport && (
        <ConfirmModal
          message={t("app.confirmImport", { count: pendingImport.fileCount.toLocaleString() })}
          confirmLabel={t("app.confirmImportButton")}
          onConfirm={() => {
            const { path, useDirAsCategory: udc } = pendingImport;
            setPendingImport(null);
            scanAndImport(path, udc);
          }}
          onCancel={() => setPendingImport(null)}
        />
      )}

      {isDragging && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center pointer-events-none">
          <div className="absolute inset-0 bg-blue-500/20 dark:bg-blue-400/20 backdrop-blur-[2px]" />
          <div className="relative flex flex-col items-center gap-3 px-10 py-8 rounded-2xl border-2 border-dashed border-blue-500 dark:border-blue-400 bg-white/80 dark:bg-gray-900/80 shadow-2xl">
            <span className="text-4xl">🎬</span>
            <p className="text-lg font-semibold text-blue-700 dark:text-blue-300">
              {t("app.dropImport")}
            </p>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              {t("app.dropFormats")}
            </p>
          </div>
        </div>
      )}
    </main>
  );
}

export default App;
