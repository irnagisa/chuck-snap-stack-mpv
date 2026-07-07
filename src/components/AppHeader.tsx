import { useTranslation } from "react-i18next";
import { useModalStore } from "../store/useModalStore";
import { useLibraryStore } from "../store/useLibraryStore";
import { useShallow } from "zustand/shallow";

type MainView = "library" | "inbox";

interface Props {
  mainView: MainView;
  inboxCount: number;
  searchInput: string;
  useDirAsCategory: boolean;
  onMainViewChange: (view: MainView) => void;
  onSearchChange: (v: string) => void;
  onSearchClear: () => void;
  onPickDir: () => void;
  onUseDirAsCategoryChange: (v: boolean) => void;
}

export function AppHeader({
  mainView,
  inboxCount,
  searchInput,
  useDirAsCategory,
  onMainViewChange,
  onSearchChange,
  onSearchClear,
  onPickDir,
  onUseDirAsCategoryChange,
}: Props) {
  const { t } = useTranslation();
  const { isDbReady, isScanning, isThumbnailGenerating } = useLibraryStore(
    useShallow((s) => ({
      isDbReady: s.isDbReady,
      isScanning: s.isScanning,
      isThumbnailGenerating: s.isThumbnailGenerating,
    }))
  );
  const {
    openSettings,
    openDownload,
    openStats,
    openExport,
    openDuplicates,
    openMissingFiles,
  } = useModalStore();

  return (
    <div className="px-4 pt-4 pb-3 flex gap-2 items-center border-b border-gray-100 dark:border-gray-800">
      <h1 className="text-lg font-bold mr-2 shrink-0">Chuck Snap Stack</h1>

      {/* メインビュー切替 */}
      <div className="flex gap-0.5 text-xs shrink-0 mr-1">
        <button
          type="button"
          className={`px-2.5 py-1.5 rounded-l font-medium transition-colors ${
            mainView === "library"
              ? "bg-gray-200 dark:bg-gray-700 text-gray-900 dark:text-gray-100"
              : "text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800"
          }`}
          onClick={() => onMainViewChange("library")}
        >
          ライブラリ
        </button>
        <button
          type="button"
          className={`px-2.5 py-1.5 rounded-r font-medium transition-colors relative ${
            mainView === "inbox"
              ? "bg-gray-200 dark:bg-gray-700 text-gray-900 dark:text-gray-100"
              : "text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800"
          }`}
          onClick={() => onMainViewChange("inbox")}
        >
          Inbox
          {inboxCount > 0 && (
            <span className="ml-1 px-1.5 py-0 rounded-full bg-amber-500 text-white text-[10px] leading-4">
              {inboxCount > 999 ? "999+" : inboxCount}
            </span>
          )}
        </button>
      </div>

      <button
        type="button"
        className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded disabled:opacity-50 text-sm dark:bg-blue-500 dark:hover:bg-blue-600 shrink-0"
        disabled={!isDbReady || isScanning || isThumbnailGenerating}
        onClick={onPickDir}
      >
        {isScanning || isThumbnailGenerating
          ? t("app.scanning")
          : t("app.addFolder")}
      </button>

      <label className="flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400 shrink-0 cursor-pointer select-none">
        <input
          type="checkbox"
          checked={useDirAsCategory}
          onChange={(e) => onUseDirAsCategoryChange(e.target.checked)}
          className="accent-blue-600"
        />
        {t("app.useDirAsCategory")}
      </label>

      <button
        type="button"
        className="px-3 py-1.5 bg-green-600 hover:bg-green-700 text-white rounded disabled:opacity-50 text-sm dark:bg-green-500 dark:hover:bg-green-600 shrink-0"
        disabled={!isDbReady}
        onClick={openDownload}
      >
        {t("app.downloadUrl")}
      </button>

      <div className="relative flex-1 min-w-0">
        <input
          className="w-full border border-gray-300 px-2 py-1.5 rounded text-sm bg-white text-gray-900 placeholder-gray-400 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 dark:placeholder-gray-500 min-w-0 pr-7"
          value={searchInput}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder={t("app.searchPlaceholder")}
          disabled={!isDbReady}
        />
        {searchInput && (
          <button
            type="button"
            className="absolute right-1.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 leading-none"
            onClick={onSearchClear}
            tabIndex={-1}
            aria-label="クリア"
          >
            ✕
          </button>
        )}
      </div>

      <button
        type="button"
        title={t("app.statsTitle")}
        className="px-3 py-1.5 bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 rounded text-sm border border-gray-300 dark:border-gray-600 shrink-0"
        disabled={!isDbReady}
        onClick={openStats}
      >
        📊
      </button>
      <button
        type="button"
        title={t("app.exportTitle")}
        className="px-3 py-1.5 bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 rounded text-sm border border-gray-300 dark:border-gray-600 shrink-0"
        disabled={!isDbReady}
        onClick={openExport}
      >
        📤
      </button>
      <button
        type="button"
        title={t("app.duplicatesTitle")}
        className="px-3 py-1.5 bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 rounded text-sm border border-gray-300 dark:border-gray-600 shrink-0"
        disabled={!isDbReady}
        onClick={openDuplicates}
      >
        {t("app.duplicatesButton")}
      </button>
      <button
        type="button"
        title={t("app.missingTitle")}
        className="px-3 py-1.5 bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 rounded text-sm border border-gray-300 dark:border-gray-600 shrink-0"
        disabled={!isDbReady}
        onClick={openMissingFiles}
      >
        {t("app.missingButton")}
      </button>
      <button
        type="button"
        title={t("app.settingsTitle")}
        className="px-3 py-1.5 bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 rounded text-sm border border-gray-300 dark:border-gray-600 shrink-0"
        onClick={openSettings}
      >
        ⚙
      </button>
    </div>
  );
}
