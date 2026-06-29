import { useEffect, useState, useMemo, useCallback } from "react";
import { useTranslation } from "react-i18next";
import type { Video, ScanResult } from "./types";
import { open } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import { useLibraryStore } from "./store/useLibraryStore";
import { useShallow } from "zustand/shallow";
import type { WatchedStatus, MediaTypeFilter } from "./store/useLibraryStore";
import { usePlayerStore } from "./store/usePlayerStore";
import { useKeyboardShortcuts } from "./hooks/useKeyboardShortcuts";
import { useWatcher } from "./hooks/useWatcher";
import { useDragDrop } from "./hooks/useDragDrop";
import { useTagStore } from "./store/useTagStore";
import { useTranscodeStore } from "./store/useTranscodeStore";
import { useModalStore } from "./store/useModalStore";
import { useSettingsStore } from "./store/useSettingsStore";
import { PlayerControls } from "./components/Player/PlayerControls";
import { MiniPlayer } from "./components/Player/MiniPlayer";
import { LibraryGrid } from "./components/Library/LibraryGrid";
import { CategorySidebar } from "./components/Library/CategorySidebar";
import { PlaylistSidebar } from "./components/Library/PlaylistSidebar";
import { WatchDirSidebar } from "./components/Library/WatchDirSidebar";
import { AppModals } from "./components/AppModals";
import { VideoDetailModal } from "./components/Library/VideoDetailModal";
import { ToastContainer } from "./components/common/ToastContainer";
import { DownloadQueuePanel } from "./components/common/DownloadQueuePanel";
import { Select } from "./components/common/Select";
import { ImageViewerModal } from "./components/Library/ImageViewerModal";
import { ConfirmModal } from "./components/common/ConfirmModal";
import InboxView from "./components/Inbox/InboxView";
import { useInboxStore } from "./store/useInboxStore";

type SidebarTab = 'category' | 'playlist' | 'folder';
type MainView = 'library' | 'inbox';

function App() {
  const { t } = useTranslation();
  // useShallow で1サブスクリプションにまとめ、個別セレクタ35個分のオーバーヘッドを削減
  const {
    videos, totalCount, currentPage, pageSize,
    filterSearch, filterCategoryId, filterTagIds, filterTagMode,
    filterMinRating, filterHasAudio, filterMinDuration, filterMaxDuration,
    filterWatchedStatus, filterWatchDir, filterMediaType, filterSortBy, filterSortOrder,
    isScanning, isThumbnailGenerating, isThumbnailPaused,
    thumbnailProgress, isDbReady, dbError,
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
    isScanning: s.isScanning,
    isThumbnailGenerating: s.isThumbnailGenerating,
    isThumbnailPaused: s.isThumbnailPaused,
    thumbnailProgress: s.thumbnailProgress,
    isDbReady: s.isDbReady,
    dbError: s.dbError,
  })));
  const {
    initDb, scanAndImport, assignCategoryFromPath,
    setSearch, setCategoryFilter, toggleTagFilter, clearTagFilters, setTagMode,
    setMinRating, setHasAudio, setMinDuration, setMaxDuration,
    setWatchedStatus, setWatchDirFilter, setMediaType, setSort, setPage,
    pauseThumbnails, resumeThumbnails, fetchVideos, rescanMultiple,
  } = useLibraryStore(useShallow((s) => ({
    initDb: s.initDb,
    scanAndImport: s.scanAndImport,
    assignCategoryFromPath: s.assignCategoryFromPath,
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
    pauseThumbnails: s.pauseThumbnails,
    resumeThumbnails: s.resumeThumbnails,
    fetchVideos: s.fetchVideos,
    rescanMultiple: s.rescanMultiple,
  })));
  // usePlayerStore: currentVideo のみ購読 (playbackTime の毎秒更新で App が再レンダリングされるのを防ぐ)
  const currentVideo = usePlayerStore((s) => s.currentVideo);
  const isMiniPlayer = usePlayerStore((s) => s.isMiniPlayer);
  const playWithQueue = usePlayerStore((s) => s.playWithQueue);
  const playShuffleAll = usePlayerStore((s) => s.playShuffleAll);
  const tags = useTagStore((s) => s.tags);
  const {
    isRunning: isTranscoding, isDone: isTranscodeDone, error: transcodeError,
    progress: transcodeProgress, videoName: transcodeVideoName,
    inputSizeBytes: transcodeInputSize, outputSizeBytes: transcodeOutputSize,
    cancel: cancelTranscode, dismiss: dismissTranscode,
  } = useTranscodeStore();
  const {
    openSettings, openDownload, openDetailVideo, openAddToPlaylist,
    openPlaylist, openBulkModal, openDuplicates, openMissingFiles, openStats, openExport, openSmartPlaylist, closeAll,
    detailVideo, closeDetailVideo,
  } = useModalStore();
  const theme = useSettingsStore((s) => s.theme);
  const isSettingsLoaded = useSettingsStore((s) => s.isLoaded);

  const inboxCount = useInboxStore((s) => s.stats?.inboxCount ?? 0);

  const [mainView, setMainView] = useState<MainView>('library');
  const [searchInput, setSearchInput] = useState(filterSearch);
  const [gridItemMinWidth, setGridItemMinWidth] = useState<number>(() => {
    const presets = [120, 180, 240, 320];
    const saved = localStorage.getItem('gridItemMinWidth');
    if (!saved) return 180;
    const n = Number(saved);
    // プリセット以外の値（旧スライダー値）は最近傍に丸める
    return presets.reduce((prev, cur) => Math.abs(cur - n) < Math.abs(prev - n) ? cur : prev);
  });
  const [durationInput, setDurationInput] = useState(filterMinDuration > 0 ? String(filterMinDuration) : '');
  const [maxDurationInput, setMaxDurationInput] = useState(filterMaxDuration > 0 ? String(filterMaxDuration) : '');
  const [sidebarTab, setSidebarTab] = useState<SidebarTab>('category');
  const [selectedVideoIds, setSelectedVideoIds] = useState<Set<number>>(new Set());
  const [useDirAsCategory, setUseDirAsCategory] = useState(false);
  const [viewingImage, setViewingImage] = useState<Video | null>(null);
  const [pendingImport, setPendingImport] = useState<{ path: string; fileCount: number; useDirAsCategory: boolean } | null>(null);

  useEffect(() => {
    localStorage.setItem('gridItemMinWidth', String(gridItemMinWidth));
  }, [gridItemMinWidth]);

  // Debounce search input → store
  useEffect(() => {
    const timer = setTimeout(() => {
      setSearch(searchInput);
    }, 500);
    return () => clearTimeout(timer);
  }, [searchInput]);

  // Debounce duration input → store
  useEffect(() => {
    const timer = setTimeout(() => {
      const seconds = parseInt(durationInput, 10);
      setMinDuration(isNaN(seconds) || seconds <= 0 ? 0 : seconds);
    }, 500);
    return () => clearTimeout(timer);
  }, [durationInput]);

  useEffect(() => {
    const timer = setTimeout(() => {
      const seconds = parseInt(maxDurationInput, 10);
      setMaxDuration(isNaN(seconds) || seconds <= 0 ? 0 : seconds);
    }, 500);
    return () => clearTimeout(timer);
  }, [maxDurationInput]);

  // テーマ適用: <html> に dark クラスを付与/除去
  useEffect(() => {
    if (!isSettingsLoaded) return;
    const root = document.documentElement;
    if (theme === 'dark') {
      root.classList.add('dark');
      return;
    }
    if (theme === 'light') {
      root.classList.remove('dark');
      return;
    }
    // 'auto': OS 設定に追従
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = (e: MediaQueryList | MediaQueryListEvent) => {
      root.classList.toggle('dark', e.matches);
    };
    apply(mq);
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [theme, isSettingsLoaded]);

  useKeyboardShortcuts({ onEscape: () => { setViewingImage(null); closeAll(); } });
  useWatcher();
  const { isDragging } = useDragDrop();

  useEffect(() => {
    initDb();
  }, []);

  const IMPORT_CONFIRM_THRESHOLD = 300;

  const handlePickDir = async () => {
    const selected = await open({ directory: true, multiple: false });
    if (typeof selected !== "string") return;
    const previewResult = await invoke<ScanResult>('scan_directory', { path: selected }).catch(() => null);
    if (!previewResult) {
      scanAndImport(selected, useDirAsCategory);
      return;
    }
    if (previewResult.files.length >= IMPORT_CONFIRM_THRESHOLD) {
      setPendingImport({ path: selected, fileCount: previewResult.files.length, useDirAsCategory });
      return;
    }
    scanAndImport(selected, useDirAsCategory);
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
    () => [filterSearch, filterCategoryId, filterTagIds.join(','), filterTagMode,
           filterMinRating, filterHasAudio, filterMinDuration, filterMaxDuration,
           filterWatchedStatus, filterWatchDir, filterMediaType,
           filterSortBy, filterSortOrder, currentPage].join('|'),
    [filterSearch, filterCategoryId, filterTagIds, filterTagMode,
     filterMinRating, filterHasAudio, filterMinDuration, filterMaxDuration,
     filterWatchedStatus, filterWatchDir, filterMediaType,
     filterSortBy, filterSortOrder, currentPage],
  );

  const handlePlay = useCallback(
    (v: Video) => {
      if (v.media_type === 'image') { setViewingImage(v); return; }
      playWithQueue(videos, videos.findIndex((x) => x.id === v.id));
    },
    [videos, playWithQueue]
  );

  const handleContextSetTag = useCallback((v: Video) => {
    setSelectedVideoIds(new Set([v.id]));
    openBulkModal('tag');
  }, [openBulkModal]);

  const handleContextSetCategory = useCallback((v: Video) => {
    setSelectedVideoIds(new Set([v.id]));
    openBulkModal('category');
  }, [openBulkModal]);

  const imageList = useMemo(() => videos.filter((v) => v.media_type === 'image'), [videos]);

  return (
    <main className="flex flex-col h-screen overflow-hidden bg-white text-gray-900 dark:bg-gray-950 dark:text-gray-100">
      {isMiniPlayer ? (
        <MiniPlayer />
      ) : (
      <>
      {/* ヘッダー / ツールバー */}
      <div className="px-4 pt-4 pb-3 flex gap-2 items-center border-b border-gray-100 dark:border-gray-800">
        <h1 className="text-lg font-bold mr-2 shrink-0">Chuck Snap Stack</h1>
        {/* メインビュー切替 */}
        <div className="flex gap-0.5 text-xs shrink-0 mr-1">
          <button
            type="button"
            className={`px-2.5 py-1.5 rounded-l font-medium transition-colors ${
              mainView === 'library'
                ? 'bg-gray-200 dark:bg-gray-700 text-gray-900 dark:text-gray-100'
                : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800'
            }`}
            onClick={() => setMainView('library')}
          >
            ライブラリ
          </button>
          <button
            type="button"
            className={`px-2.5 py-1.5 rounded-r font-medium transition-colors relative ${
              mainView === 'inbox'
                ? 'bg-gray-200 dark:bg-gray-700 text-gray-900 dark:text-gray-100'
                : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800'
            }`}
            onClick={() => setMainView('inbox')}
          >
            Inbox
            {inboxCount > 0 && (
              <span className="ml-1 px-1.5 py-0 rounded-full bg-amber-500 text-white text-[10px] leading-4">
                {inboxCount > 999 ? '999+' : inboxCount}
              </span>
            )}
          </button>
        </div>
        <button
          type="button"
          className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded disabled:opacity-50 text-sm dark:bg-blue-500 dark:hover:bg-blue-600 shrink-0"
          disabled={!isDbReady || isScanning || isThumbnailGenerating}
          onClick={handlePickDir}
        >
          {isScanning || isThumbnailGenerating ? t('app.scanning') : t('app.addFolder')}
        </button>
        <label className="flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400 shrink-0 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={useDirAsCategory}
            onChange={(e) => setUseDirAsCategory(e.target.checked)}
            className="accent-blue-600"
          />
          {t('app.useDirAsCategory')}
        </label>
        <button
          type="button"
          className="px-3 py-1.5 bg-green-600 hover:bg-green-700 text-white rounded disabled:opacity-50 text-sm dark:bg-green-500 dark:hover:bg-green-600 shrink-0"
          disabled={!isDbReady}
          onClick={openDownload}
        >
          {t('app.downloadUrl')}
        </button>
        <div className="relative flex-1 min-w-0">
          <input
            className="w-full border border-gray-300 px-2 py-1.5 rounded text-sm bg-white text-gray-900 placeholder-gray-400 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 dark:placeholder-gray-500 min-w-0 pr-7"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder={t('app.searchPlaceholder')}
            disabled={!isDbReady}
          />
          {searchInput && (
            <button
              type="button"
              className="absolute right-1.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 leading-none"
              onClick={() => setSearchInput('')}
              tabIndex={-1}
              aria-label="クリア"
            >
              ✕
            </button>
          )}
        </div>
        <button
          type="button"
          title={t('app.statsTitle')}
          className="px-3 py-1.5 bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 rounded text-sm border border-gray-300 dark:border-gray-600 shrink-0"
          disabled={!isDbReady}
          onClick={openStats}
        >
          📊
        </button>
        <button
          type="button"
          title={t('app.exportTitle')}
          className="px-3 py-1.5 bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 rounded text-sm border border-gray-300 dark:border-gray-600 shrink-0"
          disabled={!isDbReady}
          onClick={openExport}
        >
          📤
        </button>
        <button
          type="button"
          title={t('app.duplicatesTitle')}
          className="px-3 py-1.5 bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 rounded text-sm border border-gray-300 dark:border-gray-600 shrink-0"
          disabled={!isDbReady}
          onClick={openDuplicates}
        >
          {t('app.duplicatesButton')}
        </button>
        <button
          type="button"
          title={t('app.missingTitle')}
          className="px-3 py-1.5 bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 rounded text-sm border border-gray-300 dark:border-gray-600 shrink-0"
          disabled={!isDbReady}
          onClick={openMissingFiles}
        >
          {t('app.missingButton')}
        </button>
        <button
          type="button"
          title={t('app.settingsTitle')}
          className="px-3 py-1.5 bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 rounded text-sm border border-gray-300 dark:border-gray-600 shrink-0"
          onClick={openSettings}
        >
          ⚙
        </button>
      </div>

      {isThumbnailGenerating && (
        <div className="px-4 py-1.5 flex items-center gap-3 bg-gray-50 dark:bg-gray-900 border-b border-gray-100 dark:border-gray-800">
          <span className="text-xs text-gray-500 dark:text-gray-400 shrink-0">
            {isThumbnailPaused ? t('app.thumbnailPaused') : t('app.thumbnailGenerating')}
            {thumbnailProgress && ` ${thumbnailProgress.done}/${thumbnailProgress.total}`}
          </span>
          <div className="flex-1 bg-gray-200 dark:bg-gray-700 rounded-full h-1">
            <div
              className={`h-1 rounded-full transition-all duration-300 ${isThumbnailPaused ? 'bg-gray-400 dark:bg-gray-500' : 'bg-blue-500'}`}
              style={{ width: thumbnailProgress ? `${(thumbnailProgress.done / thumbnailProgress.total) * 100}%` : '0%' }}
            />
          </div>
          {isThumbnailPaused ? (
            <button
              type="button"
              onClick={resumeThumbnails}
              className="text-xs px-2 py-0.5 rounded bg-blue-500 hover:bg-blue-600 text-white shrink-0"
            >
              {t('app.thumbnailResume')}
            </button>
          ) : (
            <button
              type="button"
              onClick={pauseThumbnails}
              className="text-xs px-2 py-0.5 rounded bg-gray-300 hover:bg-gray-400 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 shrink-0"
            >
              {t('app.thumbnailPause')}
            </button>
          )}
        </div>
      )}

      {/* AV1 変換ステータスバー */}
      {(isTranscoding || isTranscodeDone || transcodeError) && (
        <div style={{ zIndex: 60 }} className={`fixed bottom-20 left-1/2 -translate-x-1/2 w-full max-w-xl mx-auto px-4 py-2 flex items-start gap-3 rounded-xl shadow-lg border ${
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

          {transcodeError ? (
            <div className="flex flex-col min-w-0 flex-1">
              <span className="text-xs font-medium text-red-700 dark:text-red-300 truncate">
                {t('app.transcodeError', { name: transcodeVideoName })}
              </span>
              <span className="text-xs text-red-600 dark:text-red-400 line-clamp-2 break-all leading-tight mt-0.5">
                {transcodeError}
              </span>
            </div>
          ) : (
            <span className={`text-xs shrink-0 font-medium truncate max-w-48 ${
              isTranscodeDone ? 'text-green-700 dark:text-green-300' : 'text-blue-700 dark:text-blue-300'
            }`}>
              {isTranscodeDone
                ? t('app.transcodeSuccess', { name: transcodeVideoName })
                : t('app.transcodeInProgress', { name: transcodeVideoName })
              }
            </span>
          )}

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
                  : t('app.transcodeStarting')
                }
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
                {t('app.transcodeCancel')}
              </button>
            </>
          )}

          {(isTranscodeDone || transcodeError) && (
            <button
              type="button"
              className="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 shrink-0 ml-auto"
              onClick={dismissTranscode}
            >
              {t('app.transcodeDismiss')}
            </button>
          )}
        </div>
      )}

      {/* ボディ: サイドバー + メインコンテンツ + 詳細パネル */}
      <div className="flex flex-1 min-h-0">
      {mainView === 'inbox' ? (
        <div className="flex flex-1 min-h-0 min-w-0">
          <InboxView />
        </div>
      ) : (
      <div className="flex flex-1 px-4 pt-4 pb-10 gap-4 min-h-0">
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
                {t('sidebar.categoryTab')}
              </button>
              <button
                type="button"
                className={`flex-1 py-1 rounded font-medium transition-colors ${
                  sidebarTab === 'folder'
                    ? 'bg-gray-200 dark:bg-gray-700 text-gray-900 dark:text-gray-100'
                    : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
                }`}
                onClick={() => setSidebarTab('folder')}
              >
                {t('sidebar.folderTab')}
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
                {t('sidebar.playlistTab')}
              </button>
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden">
              {sidebarTab === 'category' ? (
                <CategorySidebar
                  selectedCategoryId={filterCategoryId}
                  onSelectCategory={setCategoryFilter}
                />
              ) : sidebarTab === 'folder' ? (
                <WatchDirSidebar
                  selectedDir={filterWatchDir}
                  onSelectDir={setWatchDirFilter}
                />
              ) : (
                <PlaylistSidebar onOpenPlaylist={openPlaylist} />
              )}
            </div>
          </div>
        )}

        {/* メインコンテンツ */}
        <div className="flex flex-col flex-1 min-w-0 min-h-0 overflow-hidden">
          {!isDbReady && !dbError && (
            <p className="text-gray-500 text-sm dark:text-gray-400">{t('app.dbInitializing')}</p>
          )}
          {dbError && (
            <p className="text-red-500 text-sm dark:text-red-400">{t('app.dbError', { error: dbError })}</p>
          )}

          {isDbReady && (
            <div className="flex flex-col flex-1 min-h-0">
              {/* フィルタ・ソートバー */}
              <div className="flex flex-col gap-1.5 mb-3 shrink-0">
                {/* Row 1: タグ + ソート */}
                <div className="flex items-start gap-2">
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
                        {filterTagIds.length >= 2 && (
                          <button
                            type="button"
                            className="px-2 py-0.5 rounded-full text-xs font-semibold border transition-colors border-gray-400 dark:border-gray-500 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800"
                            title={filterTagMode === 'and' ? t('filters.tagFilterAnd') : t('filters.tagFilterOr')}
                            onClick={() => setTagMode(filterTagMode === 'and' ? 'or' : 'and')}
                          >
                            {filterTagMode === 'and' ? 'AND' : 'OR'}
                          </button>
                        )}
                        {filterTagIds.length > 0 && (
                          <button
                            type="button"
                            className="px-2 py-0.5 rounded-full text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 border border-gray-300 dark:border-gray-600"
                            onClick={() => clearTagFilters()}
                          >
                            {t('filters.tagClear')}
                          </button>
                        )}
                      </>
                    ) : null}
                  </div>

                  <div className="flex items-center gap-1 shrink-0">
                    <Select
                      variant="sm"
                      value={filterSortBy}
                      onChange={(e) => setSort(e.target.value as typeof filterSortBy, filterSortOrder)}
                    >
                      <option value="created_at">{t('filters.sortByCreatedAt')}</option>
                      <option value="duration">{t('filters.sortByDuration')}</option>
                      <option value="rating">{t('filters.sortByRating')}</option>
                    </Select>
                    <button
                      type="button"
                      className="px-2 py-1 text-xs border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 font-mono"
                      title={filterSortOrder === 'desc' ? t('filters.sortDescTitle') : t('filters.sortAscTitle')}
                      onClick={() => setSort(filterSortBy, filterSortOrder === 'desc' ? 'asc' : 'desc')}
                    >
                      {filterSortOrder === 'desc' ? '↓' : '↑'}
                    </button>
                    {totalCount > 0 && (
                      <button
                        type="button"
                        className="px-2 py-1 text-xs border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-purple-100 dark:hover:bg-purple-900/40 hover:text-purple-700 dark:hover:text-purple-300 hover:border-purple-400 dark:hover:border-purple-600 transition-colors"
                        title={t('app.shuffleAllTitle', { count: totalCount.toLocaleString() })}
                        onClick={playShuffleAll}
                      >
                        {t('app.shuffleAll')}
                      </button>
                    )}
                    <button
                      type="button"
                      className="px-2 py-1 text-xs border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-amber-100 dark:hover:bg-amber-900/30 hover:text-amber-700 dark:hover:text-amber-300 hover:border-amber-400 dark:hover:border-amber-600 transition-colors"
                      title={t('app.saveSmartPlaylistTitle')}
                      onClick={openSmartPlaylist}
                    >
                      {t('app.saveSmartPlaylist')}
                    </button>
                  </div>
                </div>

                {/* Row 2: 追加フィルタ */}
                <div className="flex items-center gap-1.5 flex-wrap">
                  <Select
                    variant="sm"
                    value={filterMinRating}
                    onChange={(e) => setMinRating(Number(e.target.value))}
                    title="評価フィルタ"
                  >
                    <option value={0}>{t('filters.ratingAll')}</option>
                    <option value={-1}>{t('filters.ratingUnrated')}</option>
                    <option value={1}>{t('filters.ratingAbove1')}</option>
                    <option value={2}>{t('filters.ratingAbove2')}</option>
                    <option value={3}>{t('filters.ratingAbove3')}</option>
                    <option value={4}>{t('filters.ratingAbove4')}</option>
                    <option value={5}>{t('filters.ratingOnly5')}</option>
                  </Select>

                  <Select
                    variant="sm"
                    value={filterHasAudio === null ? '' : String(filterHasAudio)}
                    onChange={(e) => {
                      const v = e.target.value;
                      setHasAudio(v === '' ? null : Number(v));
                    }}
                    title="音声フィルタ"
                  >
                    <option value="">{t('filters.audioAll')}</option>
                    <option value="1">{t('filters.audioYes')}</option>
                    <option value="0">{t('filters.audioNo')}</option>
                  </Select>

                  <Select
                    variant="sm"
                    value={filterWatchedStatus}
                    onChange={(e) => setWatchedStatus(e.target.value as WatchedStatus)}
                    title="視聴状態フィルタ"
                  >
                    <option value="all">{t('filters.watchedAll')}</option>
                    <option value="unwatched">{t('filters.unwatched')}</option>
                    <option value="watched">{t('filters.watched')}</option>
                  </Select>

                  <Select
                    variant="sm"
                    value={filterMediaType}
                    onChange={(e) => setMediaType(e.target.value as MediaTypeFilter)}
                    title="メディアタイプフィルタ"
                  >
                    <option value="all">{t('filters.mediaAll')}</option>
                    <option value="video">{t('filters.mediaVideo')}</option>
                    <option value="audio">{t('filters.mediaAudio')}</option>
                    <option value="image">{t('filters.mediaImage')}</option>
                  </Select>

                  <div className="flex items-center gap-1">
                    <input
                      type="number"
                      className="w-16 px-2 py-1 text-xs border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 placeholder-gray-400 dark:placeholder-gray-500"
                      value={durationInput}
                      onChange={(e) => setDurationInput(e.target.value)}
                      placeholder={t('filters.minDurationPlaceholder')}
                      min={0}
                      title="最小長さ (秒)"
                    />
                    <span className="text-xs text-gray-500 dark:text-gray-400 shrink-0">〜</span>
                    <input
                      type="number"
                      className="w-16 px-2 py-1 text-xs border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 placeholder-gray-400 dark:placeholder-gray-500"
                      value={maxDurationInput}
                      onChange={(e) => setMaxDurationInput(e.target.value)}
                      placeholder={t('filters.maxDurationPlaceholder')}
                      min={0}
                      title="最大長さ (秒)"
                    />
                    <span className="text-xs text-gray-500 dark:text-gray-400 shrink-0">{t('filters.durationSuffix')}</span>
                  </div>

                  {/* グリッドサイズ */}
                  <div className="flex items-center gap-0.5 ml-auto shrink-0">
                    {/* サムネイルサイズアイコン */}
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="w-3.5 h-3.5 text-gray-400 dark:text-gray-500 mr-1 shrink-0">
                      <rect x="1" y="1" width="6" height="6" rx="0.8" />
                      <rect x="9" y="1" width="6" height="6" rx="0.8" />
                      <rect x="1" y="9" width="6" height="6" rx="0.8" />
                      <rect x="9" y="9" width="6" height="6" rx="0.8" />
                    </svg>
                    {([
                      { label: 'S', value: 120 },
                      { label: 'M', value: 180 },
                      { label: 'L', value: 240 },
                      { label: 'XL', value: 320 },
                    ] as const).map(({ label, value }) => (
                      <button
                        key={value}
                        type="button"
                        className={`px-2 py-1 text-xs rounded transition-colors ${
                          gridItemMinWidth === value
                            ? 'bg-blue-500 text-white'
                            : 'text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800'
                        }`}
                        onClick={() => setGridItemMinWidth(value)}
                        title={`カードサイズ: ${label}`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* バッチ操作バー */}
              {selectedVideoIds.size > 0 && (
                <div className="flex items-center gap-2 mb-3 px-3 py-2 bg-blue-50 dark:bg-blue-950/50 border border-blue-200 dark:border-blue-800 rounded-lg shrink-0">
                  <span className="text-xs font-medium text-blue-700 dark:text-blue-300 shrink-0">
                    {t('batch.selectedCount', { count: selectedVideoIds.size })}
                  </span>
                  <button
                    type="button"
                    className="px-2.5 py-1 text-xs bg-blue-600 hover:bg-blue-700 text-white rounded"
                    onClick={() => openBulkModal('tag')}
                  >
                    {t('batch.setTag')}
                  </button>
                  <button
                    type="button"
                    className="px-2.5 py-1 text-xs bg-purple-600 hover:bg-purple-700 text-white rounded"
                    onClick={() => openBulkModal('category')}
                  >
                    {t('batch.setCategory')}
                  </button>
                  <button
                    type="button"
                    className="px-2.5 py-1 text-xs bg-teal-600 hover:bg-teal-700 text-white rounded"
                    onClick={async () => {
                      await assignCategoryFromPath(Array.from(selectedVideoIds));
                      setSelectedVideoIds(new Set());
                    }}
                  >
                    {t('batch.assignDirCategory')}
                  </button>
                  <button
                    type="button"
                    className="px-2.5 py-1 text-xs bg-orange-600 hover:bg-orange-700 text-white rounded"
                    onClick={() => openBulkModal('rename')}
                  >
                    {t('batch.rename')}
                  </button>
                  <button
                    type="button"
                    className="px-2.5 py-1 text-xs bg-red-600 hover:bg-red-700 text-white rounded"
                    onClick={() => openBulkModal('delete')}
                  >
                    {t('batch.delete')}
                  </button>
                  <button
                    type="button"
                    className="px-2.5 py-1 text-xs bg-gray-600 hover:bg-gray-700 dark:bg-gray-500 dark:hover:bg-gray-400 text-white rounded disabled:opacity-50"
                    disabled={isThumbnailGenerating}
                    onClick={async () => {
                      await rescanMultiple(Array.from(selectedVideoIds));
                      setSelectedVideoIds(new Set());
                    }}
                  >
                    {t('batch.rescan')}
                  </button>
                  <button
                    type="button"
                    className="ml-auto text-xs text-blue-500 dark:text-blue-400 hover:underline"
                    onClick={() => setSelectedVideoIds(new Set())}
                  >
                    {t('batch.deselect')}
                  </button>
                </div>
              )}

              <div className="flex-1 min-h-0">
                <LibraryGrid
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
                    {t('pagination.prev')}
                  </button>
                  <span className="text-xs text-gray-500 dark:text-gray-400 tabular-nums">
                    {currentPage} / {totalPages}
                    <span className="ml-2 text-gray-400 dark:text-gray-500">{t('pagination.count', { count: totalCount.toLocaleString() })}</span>
                  </span>
                  <button
                    type="button"
                    className="px-2.5 py-1 text-xs border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-40 disabled:cursor-not-allowed"
                    disabled={currentPage >= totalPages}
                    onClick={() => handleSetPage(currentPage + 1)}
                  >
                    {t('pagination.next')}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

      </div>
      )}

      {/* 詳細パネル */}
      <div className="w-80 shrink-0 border-l border-gray-200 dark:border-gray-800 flex flex-col overflow-hidden">
        {detailVideo ? (
          <VideoDetailModal
            key={detailVideo.id}
            video={detailVideo}
            onClose={() => {
              closeDetailVideo();
              fetchVideos();
            }}
            onViewImage={setViewingImage}
          />
        ) : (
          <div className="flex flex-col items-center justify-center h-full text-gray-400 dark:text-gray-600 select-none gap-2">
            <svg xmlns="http://www.w3.org/2000/svg" className="w-10 h-10 opacity-40" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.2}>
              <rect x="3" y="5" width="18" height="14" rx="2" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M10 9l5 3-5 3V9z" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <p className="text-xs">動画を選択してください</p>
          </div>
        )}
      </div>
      </div>

      {mainView !== 'inbox' && <PlayerControls />}
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
          message={t('app.confirmImport', { count: pendingImport.fileCount.toLocaleString() })}
          confirmLabel={t('app.confirmImportButton')}
          onConfirm={() => {
            const { path, useDirAsCategory: udc } = pendingImport;
            setPendingImport(null);
            scanAndImport(path, udc);
          }}
          onCancel={() => setPendingImport(null)}
        />
      )}

      {/* D&D インポートオーバーレイ */}
      {isDragging && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center pointer-events-none">
          <div className="absolute inset-0 bg-blue-500/20 dark:bg-blue-400/20 backdrop-blur-[2px]" />
          <div className="relative flex flex-col items-center gap-3 px-10 py-8 rounded-2xl border-2 border-dashed border-blue-500 dark:border-blue-400 bg-white/80 dark:bg-gray-900/80 shadow-2xl">
            <span className="text-4xl">🎬</span>
            <p className="text-lg font-semibold text-blue-700 dark:text-blue-300">
              {t('app.dropImport')}
            </p>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              {t('app.dropFormats')}
            </p>
          </div>
        </div>
      )}
    </main>
  );
}

export default App;
