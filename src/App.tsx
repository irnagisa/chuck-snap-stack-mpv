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
import { useModalStore } from "./store/useModalStore";
import { useLibraryViewStore } from "./store/useLibraryViewStore";
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
import { WatchDirRemovedAlert } from "./components/WatchDirRemovedAlert";
import { LibrarySidebar } from "./components/Library/LibrarySidebar";
import { LibraryFilterBar } from "./components/Library/LibraryFilterBar";
import { BatchActionBar } from "./components/Library/BatchActionBar";
import InboxView from "./components/Inbox/InboxView";
import { HomeView } from "./components/Home/HomeView";
import {
  DetailPlaceholder,
  DropOverlay,
  Pagination,
  ThreePaneLayout,
  layoutStyles as styles,
} from "./components/Layout";
import { useInboxStore } from "./store/useInboxStore";
import { motion } from "motion/react";
import { Button, Collapse, EmptyState, motionPresets } from "./components/ui";
import { FolderPlus, SearchX } from "lucide-react";

type MainView = "home" | "library" | "inbox";

const { viewEnter } = motionPresets;

function App() {
  const { t } = useTranslation();

  const {
    videos, totalCount, currentPage, pageSize,
    filterSearch, filterCategoryId, filterTagIds, filterTagMode,
    filterMinRating, filterRatingMode, filterHasAudio, filterMinDuration, filterMaxDuration,
    filterWatchedStatus, filterWatchDir, filterMediaType, filterAv1, filterSortBy, filterSortOrder,
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
    filterRatingMode: s.filterRatingMode,
    filterHasAudio: s.filterHasAudio,
    filterMinDuration: s.filterMinDuration,
    filterMaxDuration: s.filterMaxDuration,
    filterWatchedStatus: s.filterWatchedStatus,
    filterWatchDir: s.filterWatchDir,
    filterMediaType: s.filterMediaType,
    filterAv1: s.filterAv1,
    filterSortBy: s.filterSortBy,
    filterSortOrder: s.filterSortOrder,
    isThumbnailGenerating: s.isThumbnailGenerating,
    isDbReady: s.isDbReady,
    dbError: s.dbError,
  })));

  const { initDb, scanAndImport, setSearch, setPage, fetchVideos } =
    useLibraryStore(useShallow((s) => ({
      initDb: s.initDb,
      scanAndImport: s.scanAndImport,
      setSearch: s.setSearch,
      setPage: s.setPage,
      fetchVideos: s.fetchVideos,
    })));

  const currentVideo = usePlayerStore((s) => s.currentVideo);
  const isMiniPlayer = usePlayerStore((s) => s.isMiniPlayer);
  const playWithQueue = usePlayerStore((s) => s.playWithQueue);

  const { openBulkModal, openAddToPlaylist, openDetailVideo, detailVideo, closeDetailVideo, closeAll } =
    useModalStore(useShallow((s) => ({
      openBulkModal: s.openBulkModal,
      openAddToPlaylist: s.openAddToPlaylist,
      openDetailVideo: s.openDetailVideo,
      detailVideo: s.detailVideo,
      closeDetailVideo: s.closeDetailVideo,
      closeAll: s.closeAll,
    })));

  const viewMode = useLibraryViewStore((s) => s.viewMode);
  const setSidebarTab = useLibraryViewStore((s) => s.setSidebarTab);

  const inboxCount = useInboxStore((s) => s.stats?.inboxCount ?? 0);

  useTheme();
  useKeyboardShortcuts({ onEscape: () => { setViewingImage(null); closeAll(); } });
  useWatcher();
  const { isDragging } = useDragDrop();

  const [mainView, setMainView] = useState<MainView>(() => {
    const hasLaunched = localStorage.getItem("hasLaunched");
    if (!hasLaunched) {
      localStorage.setItem("hasLaunched", "true");
      return "home";
    }
    return "library";
  });
  const [searchInput, setSearchInput] = useState(filterSearch);
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

  // Debounce search
  useEffect(() => {
    const timer = setTimeout(() => setSearch(searchInput), 500);
    return () => clearTimeout(timer);
  }, [searchInput]);

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
    const {
      filterSearch, filterCategoryId, filterTagIds, filterTagMode,
      filterMinRating, filterRatingMode, filterHasAudio, filterMinDuration, filterMaxDuration,
      filterWatchedStatus, filterWatchDir, filterMediaType, filterAv1, filterSortBy, filterSortOrder,
    } = useLibraryStore.getState();
    invoke<number | null>('db_find_video_page', {
      videoId: targetId,
      filter: {
        filterSearch, filterCategoryId, filterTagIds, filterTagMode,
        filterMinRating, filterRatingMode, filterHasAudio, filterMinDuration,
        filterMaxDuration: filterMaxDuration > 0 ? filterMaxDuration : null,
        filterWatchedStatus, filterWatchDir, filterMediaType, filterAv1,
        filterSortBy, filterSortOrder,
        currentPage: 1, pageSize,
      },
    }).then((page) => {
      if (page == null) return;
      pendingScrollIdRef.current = targetId;
      handleSetPage(page);
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

  // 検索・絞り込み・サイドバーの選択のどれかが効いているか (空のときの表示を出し分ける)
  const isFiltered =
    filterSearch !== "" ||
    filterCategoryId !== null ||
    filterTagIds.length > 0 ||
    filterMinRating !== 0 ||
    filterHasAudio !== null ||
    filterMinDuration > 0 ||
    filterMaxDuration > 0 ||
    filterWatchedStatus !== "all" ||
    filterWatchDir !== null ||
    filterMediaType !== "all" ||
    filterAv1 !== "all";

  const libraryEmptyState = isFiltered ? (
    <EmptyState
      icon={<SearchX />}
      title={t("library.noMatchTitle")}
      description={t("library.noMatchDescription")}
    />
  ) : (
    <EmptyState
      icon={<FolderPlus />}
      title={t("library.emptyTitle")}
      description={t("library.emptyDescription")}
      action={
        <Button variant="primary" onClick={handlePickDir}>
          <FolderPlus aria-hidden />
          {t("app.addFolder")}
        </Button>
      }
    />
  );

  const selectedVideos = useMemo(
    () => videos.filter((v) => selectedVideoIds.has(v.id)),
    [videos, selectedVideoIds]
  );

  const scrollResetKey = useMemo(
    () =>
      [
        filterSearch, filterCategoryId, filterTagIds.join(","), filterTagMode,
        filterMinRating, filterRatingMode, filterHasAudio, filterMinDuration, filterMaxDuration,
        filterWatchedStatus, filterWatchDir, filterMediaType, filterAv1,
        filterSortBy, filterSortOrder, currentPage,
      ].join("|"),
    [
      filterSearch, filterCategoryId, filterTagIds, filterTagMode,
      filterMinRating, filterRatingMode, filterHasAudio, filterMinDuration, filterMaxDuration,
      filterWatchedStatus, filterWatchDir, filterMediaType, filterAv1,
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

  const handleContextMoveDir = useCallback(
    (v: Video) => { setSelectedVideoIds(new Set([v.id])); openBulkModal("moveDir"); },
    [openBulkModal]
  );

  const imageList = useMemo(() => videos.filter((v) => v.media_type === "image"), [videos]);

  const handleHomeOpenVideo = useCallback(
    (v: Video) => {
      setMainView("library");
      openDetailVideo(v);
    },
    [openDetailVideo]
  );

  const handleHomeOpenFolder = useCallback(
    (dir: string) => {
      setMainView("library");
      setSidebarTab("folder");
      useLibraryStore.getState().setWatchDirFilter(dir);
    },
    [setSidebarTab]
  );

  return (
    <main className={styles.app}>
      {isMiniPlayer ? (
        <motion.div key="mini" className={styles.shell} {...viewEnter}>
          <MiniPlayer />
        </motion.div>
      ) : (
        <motion.div key="full" className={styles.shell} {...viewEnter}>
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
          <WatchDirRemovedAlert />

          {/* ボディ */}
          <div className={styles.body}>
            {/* ビュー切替: key が変わるたびに新しいビューをフェードインさせる */}
            <motion.div key={mainView} className={styles.fill} {...viewEnter}>
              {mainView === "home" ? (
                <ErrorBoundary>
                  <HomeView
                    onNavigate={setMainView}
                    onOpenVideo={handleHomeOpenVideo}
                    onOpenFolder={handleHomeOpenFolder}
                  />
                </ErrorBoundary>
              ) : mainView === "inbox" ? (
                <ErrorBoundary>
                  <InboxView />
                </ErrorBoundary>
              ) : (
                <ThreePaneLayout
                  sidebar={isDbReady ? <LibrarySidebar /> : null}
                  detailKey={detailVideo?.id ?? "empty"}
                  detail={
                    detailVideo ? (
                      <VideoDetailModal
                        key={detailVideo.id}
                        video={detailVideo}
                        onClose={() => { closeDetailVideo(); fetchVideos(); }}
                        onViewImage={setViewingImage}
                      />
                    ) : (
                      <DetailPlaceholder />
                    )
                  }
                >
                  {!isDbReady && !dbError && (
                    <p className={styles.status}>{t("app.dbInitializing")}</p>
                  )}
                  {dbError && (
                    <p className={styles.status} data-tone="error">
                      {t("app.dbError", { error: dbError })}
                    </p>
                  )}

                  {isDbReady && (
                    <ErrorBoundary>
                      <div className={styles.libraryColumn}>
                        <LibraryFilterBar />

                        <Collapse show={selectedVideoIds.size > 0} data={selectedVideoIds}>
                          {(ids) => (
                            <BatchActionBar
                              selectedVideoIds={ids}
                              isThumbnailGenerating={isThumbnailGenerating}
                              onClearSelection={() => setSelectedVideoIds(new Set())}
                            />
                          )}
                        </Collapse>

                        <div className={styles.libraryView}>
                          <motion.div key={viewMode} className={styles.viewSwap} {...viewEnter}>
                            {viewMode === "list" ? (
                              <LibraryList
                                ref={libraryRef}
                                videos={videos}
                                emptyState={libraryEmptyState}
                                currentVideoId={currentVideo?.id ?? null}
                                detailVideoId={detailVideo?.id ?? null}
                                scrollResetKey={scrollResetKey}
                                onPlay={handlePlay}
                                onShowDetail={openDetailVideo}
                                onAddToPlaylist={openAddToPlaylist}
                                onSetTag={handleContextSetTag}
                                onSetCategory={handleContextSetCategory}
                                onMoveDir={handleContextMoveDir}
                                selectedIds={selectedVideoIds}
                                onSelectionChange={setSelectedVideoIds}
                              />
                            ) : (
                              <LibraryGrid
                                ref={libraryRef}
                                videos={videos}
                                emptyState={libraryEmptyState}
                                currentVideoId={currentVideo?.id ?? null}
                                detailVideoId={detailVideo?.id ?? null}
                                scrollResetKey={scrollResetKey}
                                onPlay={handlePlay}
                                onShowDetail={openDetailVideo}
                                onAddToPlaylist={openAddToPlaylist}
                                onSetTag={handleContextSetTag}
                                onSetCategory={handleContextSetCategory}
                                onMoveDir={handleContextMoveDir}
                                selectedIds={selectedVideoIds}
                                onSelectionChange={setSelectedVideoIds}
                              />
                            )}
                          </motion.div>
                        </div>

                        <Pagination
                          currentPage={currentPage}
                          totalPages={totalPages}
                          totalCount={totalCount}
                          onPageChange={handleSetPage}
                        />
                      </div>
                    </ErrorBoundary>
                  )}
                </ThreePaneLayout>
              )}
            </motion.div>
          </div>

          {mainView !== "inbox" && <PlayerControls />}
        </motion.div>
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

      <DropOverlay visible={isDragging} />
    </main>
  );
}

export default App;
