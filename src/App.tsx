import { useEffect, useState, useMemo, useCallback } from "react";
import type { Video } from "./types";
import { open } from "@tauri-apps/plugin-dialog";
import { useLibraryStore } from "./store/useLibraryStore";
import { useShallow } from "zustand/shallow";
import type { WatchedStatus } from "./store/useLibraryStore";
import { usePlayerStore } from "./store/usePlayerStore";
import { useKeyboardShortcuts } from "./hooks/useKeyboardShortcuts";
import { useWatcher } from "./hooks/useWatcher";
import { useDragDrop } from "./hooks/useDragDrop";
import { useTagStore } from "./store/useTagStore";
import { useTranscodeStore } from "./store/useTranscodeStore";
import { useModalStore } from "./store/useModalStore";
import { useSettingsStore } from "./store/useSettingsStore";
import { PlayerControls } from "./components/Player/PlayerControls";
import { LibraryGrid } from "./components/Library/LibraryGrid";
import { CategorySidebar } from "./components/Library/CategorySidebar";
import { PlaylistSidebar } from "./components/Library/PlaylistSidebar";
import { AppModals } from "./components/AppModals";
import { ToastContainer } from "./components/common/ToastContainer";
import { Select } from "./components/common/Select";

type SidebarTab = 'category' | 'playlist';

function App() {
  // useShallow で1サブスクリプションにまとめ、個別セレクタ35個分のオーバーヘッドを削減
  const {
    videos, totalCount, currentPage, pageSize,
    filterSearch, filterCategoryId, filterTagIds,
    filterMinRating, filterHasAudio, filterMinDuration,
    filterWatchedStatus, filterSortBy, filterSortOrder,
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
    filterMinRating: s.filterMinRating,
    filterHasAudio: s.filterHasAudio,
    filterMinDuration: s.filterMinDuration,
    filterWatchedStatus: s.filterWatchedStatus,
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
    setSearch, setCategoryFilter, toggleTagFilter, clearTagFilters,
    setMinRating, setHasAudio, setMinDuration,
    setWatchedStatus, setSort, setPage,
    pauseThumbnails, resumeThumbnails,
  } = useLibraryStore(useShallow((s) => ({
    initDb: s.initDb,
    scanAndImport: s.scanAndImport,
    assignCategoryFromPath: s.assignCategoryFromPath,
    setSearch: s.setSearch,
    setCategoryFilter: s.setCategoryFilter,
    toggleTagFilter: s.toggleTagFilter,
    clearTagFilters: s.clearTagFilters,
    setMinRating: s.setMinRating,
    setHasAudio: s.setHasAudio,
    setMinDuration: s.setMinDuration,
    setWatchedStatus: s.setWatchedStatus,
    setSort: s.setSort,
    setPage: s.setPage,
    pauseThumbnails: s.pauseThumbnails,
    resumeThumbnails: s.resumeThumbnails,
  })));
  // usePlayerStore: currentVideo のみ購読 (playbackTime の毎秒更新で App が再レンダリングされるのを防ぐ)
  const currentVideo = usePlayerStore((s) => s.currentVideo);
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
    openPlaylist, openBulkModal, openDuplicates, openStats, openExport, openSmartPlaylist, closeAll,
  } = useModalStore();

  const theme = useSettingsStore((s) => s.theme);
  const isSettingsLoaded = useSettingsStore((s) => s.isLoaded);

  const [searchInput, setSearchInput] = useState(filterSearch);
  const [durationInput, setDurationInput] = useState(filterMinDuration > 0 ? String(filterMinDuration) : '');
  const [sidebarTab, setSidebarTab] = useState<SidebarTab>('category');
  const [selectedVideoIds, setSelectedVideoIds] = useState<Set<number>>(new Set());
  const [useDirAsCategory, setUseDirAsCategory] = useState(false);

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

  useKeyboardShortcuts({ onEscape: closeAll });
  useWatcher();
  const { isDragging } = useDragDrop();

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

  const handlePlay = useCallback(
    (v: Video) => playWithQueue(videos, videos.findIndex((x) => x.id === v.id)),
    [videos, playWithQueue]
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
          onClick={openDownload}
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
          title="統計ダッシュボード"
          className="px-3 py-1.5 bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 rounded text-sm border border-gray-300 dark:border-gray-600 shrink-0"
          disabled={!isDbReady}
          onClick={openStats}
        >
          📊
        </button>
        <button
          type="button"
          title="エクスポート / インポート"
          className="px-3 py-1.5 bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 rounded text-sm border border-gray-300 dark:border-gray-600 shrink-0"
          disabled={!isDbReady}
          onClick={openExport}
        >
          📤
        </button>
        <button
          type="button"
          title="重複動画を検出"
          className="px-3 py-1.5 bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 rounded text-sm border border-gray-300 dark:border-gray-600 shrink-0"
          disabled={!isDbReady}
          onClick={openDuplicates}
        >
          重複
        </button>
        <button
          type="button"
          title="設定"
          className="px-3 py-1.5 bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 rounded text-sm border border-gray-300 dark:border-gray-600 shrink-0"
          onClick={openSettings}
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
                <PlaylistSidebar onOpenPlaylist={openPlaylist} />
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
                    <Select
                      variant="sm"
                      value={filterSortBy}
                      onChange={(e) => setSort(e.target.value as typeof filterSortBy, filterSortOrder)}
                    >
                      <option value="created_at">追加日</option>
                      <option value="duration">長さ</option>
                      <option value="rating">評価</option>
                    </Select>
                    <button
                      type="button"
                      className="px-2 py-1 text-xs border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 font-mono"
                      title={filterSortOrder === 'desc' ? '降順 (クリックで昇順)' : '昇順 (クリックで降順)'}
                      onClick={() => setSort(filterSortBy, filterSortOrder === 'desc' ? 'asc' : 'desc')}
                    >
                      {filterSortOrder === 'desc' ? '↓' : '↑'}
                    </button>
                    {totalCount > 0 && (
                      <button
                        type="button"
                        className="px-2 py-1 text-xs border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-purple-100 dark:hover:bg-purple-900/40 hover:text-purple-700 dark:hover:text-purple-300 hover:border-purple-400 dark:hover:border-purple-600 transition-colors"
                        title={`現在のフィルター全 ${totalCount.toLocaleString()} 件をシャッフル再生`}
                        onClick={playShuffleAll}
                      >
                        ⇄ 全件
                      </button>
                    )}
                    <button
                      type="button"
                      className="px-2 py-1 text-xs border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-amber-100 dark:hover:bg-amber-900/30 hover:text-amber-700 dark:hover:text-amber-300 hover:border-amber-400 dark:hover:border-amber-600 transition-colors"
                      title="現在のフィルター条件をスマートプレイリストとして保存"
                      onClick={openSmartPlaylist}
                    >
                      💾 保存
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
                    <option value={0}>評価: すべて</option>
                    <option value={1}>★1以上</option>
                    <option value={2}>★2以上</option>
                    <option value={3}>★3以上</option>
                    <option value={4}>★4以上</option>
                    <option value={5}>★5のみ</option>
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
                    <option value="">音声: すべて</option>
                    <option value="1">音声あり</option>
                    <option value="0">音声なし</option>
                  </Select>

                  <Select
                    variant="sm"
                    value={filterWatchedStatus}
                    onChange={(e) => setWatchedStatus(e.target.value as WatchedStatus)}
                    title="視聴状態フィルタ"
                  >
                    <option value="all">視聴: すべて</option>
                    <option value="unwatched">未視聴</option>
                    <option value="watched">視聴済み</option>
                  </Select>

                  <div className="flex items-center gap-1">
                    <input
                      type="number"
                      className="w-16 px-2 py-1 text-xs border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 placeholder-gray-400 dark:placeholder-gray-500"
                      value={durationInput}
                      onChange={(e) => setDurationInput(e.target.value)}
                      placeholder="秒数"
                      min={0}
                      title="最小長さ (秒)"
                    />
                    <span className="text-xs text-gray-500 dark:text-gray-400 shrink-0">秒以上</span>
                  </div>
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
                    onClick={() => openBulkModal('tag')}
                  >
                    タグ設定
                  </button>
                  <button
                    type="button"
                    className="px-2.5 py-1 text-xs bg-purple-600 hover:bg-purple-700 text-white rounded"
                    onClick={() => openBulkModal('category')}
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
                    className="px-2.5 py-1 text-xs bg-orange-600 hover:bg-orange-700 text-white rounded"
                    onClick={() => openBulkModal('rename')}
                  >
                    リネーム
                  </button>
                  <button
                    type="button"
                    className="px-2.5 py-1 text-xs bg-red-600 hover:bg-red-700 text-white rounded"
                    onClick={() => openBulkModal('delete')}
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
                  onPlay={handlePlay}
                  onShowDetail={openDetailVideo}
                  onAddToPlaylist={openAddToPlaylist}
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

      <AppModals
        selectedVideoIds={selectedVideoIds}
        selectedVideos={selectedVideos}
        onClearSelection={() => setSelectedVideoIds(new Set())}
      />

      <ToastContainer />

      {/* D&D インポートオーバーレイ */}
      {isDragging && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center pointer-events-none">
          <div className="absolute inset-0 bg-blue-500/20 dark:bg-blue-400/20 backdrop-blur-[2px]" />
          <div className="relative flex flex-col items-center gap-3 px-10 py-8 rounded-2xl border-2 border-dashed border-blue-500 dark:border-blue-400 bg-white/80 dark:bg-gray-900/80 shadow-2xl">
            <span className="text-4xl">🎬</span>
            <p className="text-lg font-semibold text-blue-700 dark:text-blue-300">
              動画をドロップしてインポート
            </p>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              mp4 / mkv / webm / avi / mov などに対応
            </p>
          </div>
        </div>
      )}
    </main>
  );
}

export default App;
