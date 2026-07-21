import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getVersion } from "@tauri-apps/api/app";
import { open } from "@tauri-apps/plugin-dialog";
import { useTranslation } from "react-i18next";
import {
  useSettingsStore, type AppSettings, type KeyAction, type Theme, type CategoryMode,
  type AiModelType, KEY_ACTION_KEYS, DEFAULT_KEYBINDINGS,
} from "../../store/useSettingsStore";
import { useLibraryStore } from "../../store/useLibraryStore";
import { LANGUAGE_LABELS, type Language } from "../../i18n";
import { CategoryMigrationModal } from "../Library/CategoryMigrationModal";

interface Props {
  onClose: () => void;
}

function formatKey(key: string): string {
  if (key === ' ') return 'Space';
  if (key === 'ArrowRight') return '→';
  if (key === 'ArrowLeft') return '←';
  if (key === 'ArrowUp') return '↑';
  if (key === 'ArrowDown') return '↓';
  if (key === 'Escape') return 'Esc';
  return key;
}

const KEY_ACTION_ORDER: KeyAction[] = [
  'pause', 'seekForward', 'seekBackward', 'volumeUp', 'volumeDown',
  'fullscreen', 'next', 'prev', 'escape',
];

export function SettingsPanel({ onClose }: Props) {
  const { t } = useTranslation();
  const { mpvPath, ffmpegPath, ffprobePath, ytdlpPath, downloadDir, screenshotDir, keybindings, theme, autoPlayNext, language, categoryMode, aiEnabled, aiModelType, saveSettings, saveKeybindings, setCategoryMode, setAiModelType } = useSettingsStore();
  const { watchDirs, scanAndImport, removeWatchDir, isScanning, isThumbnailGenerating } = useLibraryStore();

  const [local, setLocal] = useState<AppSettings>({ mpvPath, ffmpegPath, ffprobePath, ytdlpPath, downloadDir, screenshotDir, keybindings, theme, autoPlayNext, language, categoryMode, aiEnabled, aiModelType });
  const [isSaving, setIsSaving] = useState(false);
  const [removingPath, setRemovingPath] = useState<string | null>(null);
  const [capturingAction, setCapturingAction] = useState<KeyAction | null>(null);

  // カテゴリモード変更
  const [showMigrationModal, setShowMigrationModal] = useState(false);
  const [showVirtualConfirm, setShowVirtualConfirm] = useState(false);

  const handleCategoryModeSelect = (mode: CategoryMode) => {
    if (mode === categoryMode) return;
    if (mode === 'sync') {
      setShowMigrationModal(true);
    } else {
      setShowVirtualConfirm(true);
    }
  };

  const handleMigrationDone = async () => {
    await setCategoryMode('sync');
    setShowMigrationModal(false);
  };

  const handleVirtualConfirm = async () => {
    await setCategoryMode('virtual');
    setShowVirtualConfirm(false);
  };

  // アプリバージョン
  const [appVersion, setAppVersion] = useState<string>('');
  useEffect(() => {
    getVersion().then(setAppVersion);
  }, []);

  // ウェブサーバー
  const [wsPort, setWsPort] = useState(7777);
  const [wsRunning, setWsRunning] = useState(false);
  const [wsLoading, setWsLoading] = useState(false);
  const [localIp, setLocalIp] = useState<string | null>(null);

  // AIモデル状態
  const [aiModelDownloaded, setAiModelDownloaded] = useState(false);
  const [aiModelDownloading, setAiModelDownloading] = useState(false);
  const [aiModelProgress, setAiModelProgress] = useState(0);
  const [aiModelUninstalling, setAiModelUninstalling] = useState(false);
  const [confirmUninstall, setConfirmUninstall] = useState(false);

  useEffect(() => {
    invoke<number | null>('get_web_server_port').then((port) => {
      if (port != null) {
        setWsRunning(true);
        setWsPort(port);
      }
    });
    invoke<string | null>('get_local_ip').then(setLocalIp);
  }, []);

  // AIモデル状態を取得（選択中のモデルが変わるたびに再取得）
  useEffect(() => {
    invoke<{ downloaded: boolean; downloading: boolean; progress: number }>(
      'check_ai_model_status',
      { modelType: aiModelType }
    ).then((s) => {
      setAiModelDownloaded(s.downloaded);
      setAiModelDownloading(s.downloading);
      setAiModelProgress(s.progress);
    }).catch(console.error);
  }, [aiModelType]);

  // ダウンロード進捗イベントをリッスン
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    listen<number>('ai://download-progress', (e) => {
      setAiModelProgress(e.payload);
      if (e.payload >= 1.0) {
        setAiModelDownloading(false);
        setAiModelDownloaded(true);
      }
    }).then((fn) => { unlisten = fn; });
    return () => { unlisten?.(); };
  }, []);

  const handleInstallModel = async () => {
    try {
      setAiModelDownloading(true);
      setAiModelProgress(0);
      await invoke('download_ai_model', { modelType: aiModelType });
      setAiModelDownloaded(true);
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
      setAiModelDownloading(false);
    }
  };

  const handleUninstallModel = async () => {
    setConfirmUninstall(false);
    setAiModelUninstalling(true);
    try {
      await invoke('uninstall_ai_model', { modelType: aiModelType });
      setAiModelDownloaded(false);
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    } finally {
      setAiModelUninstalling(false);
    }
  };

  const handleStartWs = async () => {
    setWsLoading(true);
    try {
      const actualPort = await invoke<number>('start_web_server', { port: wsPort });
      setWsPort(actualPort);
      setWsRunning(true);
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    } finally {
      setWsLoading(false);
    }
  };

  const handleStopWs = async () => {
    setWsLoading(true);
    try {
      await invoke('stop_web_server');
      setWsRunning(false);
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    } finally {
      setWsLoading(false);
    }
  };

  useEffect(() => {
    if (!capturingAction) return;
    const handler = (e: KeyboardEvent) => {
      e.preventDefault();
      setLocal((prev) => ({
        ...prev,
        keybindings: { ...prev.keybindings, [capturingAction]: e.key },
      }));
      setCapturingAction(null);
    };
    window.addEventListener('keydown', handler, { once: true });
    return () => window.removeEventListener('keydown', handler);
  }, [capturingAction]);

  const handlePickYtdlp = async () => {
    const selected = await open({ multiple: false });
    if (typeof selected === "string") {
      setLocal((prev) => ({ ...prev, ytdlpPath: selected }));
    }
  };

  const handleDetectYtdlp = async () => {
    try {
      const detected = await invoke<string>("detect_ytdlp_path");
      setLocal((prev) => ({ ...prev, ytdlpPath: detected }));
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    }
  };

  const handlePickMpv = async () => {
    const selected = await open({ multiple: false });
    if (typeof selected === "string") {
      setLocal((prev) => ({ ...prev, mpvPath: selected }));
    }
  };

  const handlePickDownloadDir = async () => {
    const selected = await open({ directory: true, multiple: false });
    if (typeof selected === "string") {
      setLocal((prev) => ({ ...prev, downloadDir: selected }));
    }
  };

  const handlePickScreenshotDir = async () => {
    const selected = await open({ directory: true, multiple: false });
    if (typeof selected === "string") {
      setLocal((prev) => ({ ...prev, screenshotDir: selected }));
    }
  };

  const handleAddScanPath = async () => {
    const selected = await open({ directory: true, multiple: false });
    if (typeof selected === "string") {
      await scanAndImport(selected);
    }
  };

  const handleRemoveScanPath = async (path: string) => {
    setRemovingPath(path);
    try {
      await removeWatchDir(path);
    } finally {
      setRemovingPath(null);
    }
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await saveSettings(local);
      await saveKeybindings(local.keybindings);
      onClose();
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <>
    {showMigrationModal && (
      <CategoryMigrationModal
        onDone={handleMigrationDone}
        onCancel={() => setShowMigrationModal(false)}
      />
    )}

    {confirmUninstall && (
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-60" onClick={() => setConfirmUninstall(false)}>
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl p-5 w-80 max-w-[90vw]" onClick={(e) => e.stopPropagation()}>
          <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-2">
            {t('settings.aiModelUninstallConfirmTitle')}
          </h3>
          <p className="text-xs text-gray-600 dark:text-gray-400 mb-4">
            {t('settings.aiModelUninstallConfirmDesc')}
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              className="flex-1 px-3 py-2 text-sm bg-red-600 hover:bg-red-700 text-white rounded"
              onClick={handleUninstallModel}
            >
              {t('settings.aiModelUninstallConfirm')}
            </button>
            <button
              type="button"
              className="px-3 py-2 text-sm bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 rounded"
              onClick={() => setConfirmUninstall(false)}
            >
              {t('confirm.cancel')}
            </button>
          </div>
        </div>
      </div>
    )}

    {showVirtualConfirm && (
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-60" onClick={() => setShowVirtualConfirm(false)}>
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl p-5 w-80 max-w-[90vw]" onClick={(e) => e.stopPropagation()}>
          <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-2">
            {t('categoryModeChange.toVirtualTitle')}
          </h3>
          <p className="text-xs text-gray-600 dark:text-gray-400 mb-4">
            {t('categoryModeChange.toVirtualDesc')}
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              className="flex-1 px-3 py-2 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded"
              onClick={handleVirtualConfirm}
            >
              {t('categoryModeChange.toVirtualConfirm')}
            </button>
            <button
              type="button"
              className="px-3 py-2 text-sm bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 rounded"
              onClick={() => setShowVirtualConfirm(false)}
            >
              {t('categoryModeChange.cancel')}
            </button>
          </div>
        </div>
      </div>
    )}

    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="bg-white dark:bg-gray-900 rounded-lg shadow-xl w-full max-w-lg mx-4 flex flex-col max-h-[85vh]">
        {/* ヘッダー */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-700 shrink-0">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">{t('settings.title')}</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 text-xl leading-none"
          >
            ✕
          </button>
        </div>

        {/* 本体 - スクロール可能 */}
        <div className="px-6 py-5 space-y-4 overflow-y-auto flex-1">
          {/* 外観 */}
          <p className="text-xs font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">
            {t('settings.sectionAppearance')}
          </p>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              {t('settings.theme')}
            </label>
            <div className="flex gap-1 p-1 bg-gray-100 dark:bg-gray-800 rounded-lg w-fit">
              {([['light', t('settings.themeLight')], ['dark', t('settings.themeDark')], ['auto', t('settings.themeAuto')]] as [Theme, string][]).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  className={`px-4 py-1 rounded-md text-sm font-medium transition-all ${
                    local.theme === value
                      ? 'bg-white dark:bg-gray-600 text-gray-900 dark:text-gray-100 shadow-sm'
                      : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
                  }`}
                  onClick={() => setLocal((prev) => ({ ...prev, theme: value }))}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* 言語 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              {t('settings.language')}
            </label>
            <div className="flex gap-1 p-1 bg-gray-100 dark:bg-gray-800 rounded-lg w-fit">
              {(Object.entries(LANGUAGE_LABELS) as [Language, string][]).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  className={`px-4 py-1 rounded-md text-sm font-medium transition-all ${
                    local.language === value
                      ? 'bg-white dark:bg-gray-600 text-gray-900 dark:text-gray-100 shadow-sm'
                      : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
                  }`}
                  onClick={() => setLocal((prev) => ({ ...prev, language: value }))}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <hr className="border-gray-200 dark:border-gray-700" />

          {/* 再生 */}
          <p className="text-xs font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">
            {t('settings.sectionPlayback')}
          </p>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-700 dark:text-gray-300">{t('settings.autoPlayNext')}</p>
              <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
                {t('settings.autoPlayNextDesc')}
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={local.autoPlayNext}
              onClick={() => setLocal((prev) => ({ ...prev, autoPlayNext: !prev.autoPlayNext }))}
              className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none ${
                local.autoPlayNext ? 'bg-blue-600' : 'bg-gray-300 dark:bg-gray-600'
              }`}
            >
              <span
                className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow transform transition-transform duration-200 ${
                  local.autoPlayNext ? 'translate-x-5' : 'translate-x-0'
                }`}
              />
            </button>
          </div>

          <hr className="border-gray-200 dark:border-gray-700" />

          {/* カテゴリモード */}
          <p className="text-xs font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">
            {t('settings.sectionCategoryMode')}
          </p>

          <div className="space-y-2">
            {(['virtual', 'sync'] as CategoryMode[]).map((mode) => (
              <label
                key={mode}
                className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                  categoryMode === mode
                    ? 'border-blue-500 bg-blue-50 dark:bg-blue-950/30'
                    : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'
                }`}
              >
                <input
                  type="radio"
                  name="category-mode"
                  checked={categoryMode === mode}
                  onChange={() => handleCategoryModeSelect(mode)}
                  className="mt-0.5 accent-blue-600"
                />
                <div>
                  <p className="text-sm font-medium text-gray-800 dark:text-gray-200">
                    {t(`settings.categoryMode${mode.charAt(0).toUpperCase() + mode.slice(1)}`)}
                  </p>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                    {t(`settings.categoryMode${mode.charAt(0).toUpperCase() + mode.slice(1)}Desc`)}
                  </p>
                </div>
              </label>
            ))}
          </div>

          <hr className="border-gray-200 dark:border-gray-700" />

          {/* AI 機能 */}
          <p className="text-xs font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">
            {t('settings.sectionAi')}
          </p>

          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-700 dark:text-gray-300">{t('settings.aiEnabled')}</p>
              <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
                {t('settings.aiEnabledDesc')}
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={local.aiEnabled}
              onClick={() => setLocal((prev) => ({ ...prev, aiEnabled: !prev.aiEnabled }))}
              className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none ${
                local.aiEnabled ? 'bg-blue-600' : 'bg-gray-300 dark:bg-gray-600'
              }`}
            >
              <span
                className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow transform transition-transform duration-200 ${
                  local.aiEnabled ? 'translate-x-5' : 'translate-x-0'
                }`}
              />
            </button>
          </div>

          <p className="text-xs text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 rounded p-2">
            {t('settings.aiNsfwWarning')}
          </p>

          {/* AIモデル選択・インストール/アンインストール */}
          <div className="space-y-2">
            <p className="text-sm font-medium text-gray-700 dark:text-gray-300">{t('settings.aiModelType')}</p>
            {([
              ['wd-tagger', t('settings.aiModelWdTagger'), t('settings.aiModelWdTaggerDesc')],
              ['joytag',    t('settings.aiModelJoyTag'),   t('settings.aiModelJoyTagDesc')],
            ] as [AiModelType, string, string][]).map(([value, label, desc]) => (
              <label
                key={value}
                className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                  aiModelType === value
                    ? 'border-blue-500 bg-blue-50 dark:bg-blue-950/30'
                    : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'
                }`}
              >
                <input
                  type="radio"
                  name="ai-model-type"
                  checked={aiModelType === value}
                  onChange={() => setAiModelType(value)}
                  className="mt-0.5 accent-blue-600"
                />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-800 dark:text-gray-200">{label}</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{desc}</p>
                  {aiModelType === value && aiModelDownloading && (
                    <div className="mt-2">
                      <div className="h-1.5 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-blue-500 transition-all duration-300"
                          style={{ width: `${Math.round(aiModelProgress * 100)}%` }}
                        />
                      </div>
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                        {t('settings.aiModelDownloading')} {Math.round(aiModelProgress * 100)}%
                      </p>
                    </div>
                  )}
                </div>
                {aiModelType === value && (
                  <div className="shrink-0 flex flex-col items-end gap-1.5">
                    {aiModelDownloaded && !aiModelDownloading ? (
                      <>
                        <span className="text-xs text-green-600 dark:text-green-400 font-medium">
                          {t('settings.aiModelInstalled')}
                        </span>
                        <button
                          type="button"
                          disabled={aiModelUninstalling}
                          onClick={(e) => { e.preventDefault(); setConfirmUninstall(true); }}
                          className="text-xs px-2 py-0.5 text-red-500 hover:text-red-700 dark:hover:text-red-400 border border-red-300 dark:border-red-700 rounded hover:bg-red-50 dark:hover:bg-red-950/30 disabled:opacity-50 transition-colors"
                        >
                          {aiModelUninstalling ? t('settings.aiModelUninstalling') : t('settings.aiModelUninstall')}
                        </button>
                      </>
                    ) : !aiModelDownloading ? (
                      <button
                        type="button"
                        onClick={(e) => { e.preventDefault(); handleInstallModel(); }}
                        className="text-xs px-2 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded transition-colors"
                      >
                        {t('settings.aiModelInstall')}
                      </button>
                    ) : null}
                  </div>
                )}
              </label>
            ))}
          </div>

          <hr className="border-gray-200 dark:border-gray-700" />

          <p className="text-xs font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">
            {t('settings.sectionExecutable')}
          </p>

          {/* mpv パス */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              {t('settings.mpvPath')}
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={local.mpvPath}
                onChange={(e) => setLocal((prev) => ({ ...prev, mpvPath: e.target.value }))}
                className="flex-1 border border-gray-300 dark:border-gray-600 px-2 py-1.5 rounded text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 font-mono"
                placeholder={t('settings.mpvPathPlaceholder')}
              />
              <button
                type="button"
                onClick={handlePickMpv}
                className="px-3 py-1.5 bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 rounded text-sm border border-gray-300 dark:border-gray-600 whitespace-nowrap"
              >
                {t('settings.browse')}
              </button>
            </div>
          </div>

          {/* ffmpeg パス */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              {t('settings.ffmpegPath')}
            </label>
            <input
              type="text"
              value={local.ffmpegPath}
              onChange={(e) => setLocal((prev) => ({ ...prev, ffmpegPath: e.target.value }))}
              className="w-full border border-gray-300 dark:border-gray-600 px-2 py-1.5 rounded text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 font-mono"
              placeholder={t('settings.ffmpegPlaceholder')}
            />
            <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
              {t('settings.ffmpegHelp')}
            </p>
          </div>

          {/* ffprobe パス */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              {t('settings.ffprobePath')}
            </label>
            <input
              type="text"
              value={local.ffprobePath}
              onChange={(e) => setLocal((prev) => ({ ...prev, ffprobePath: e.target.value }))}
              className="w-full border border-gray-300 dark:border-gray-600 px-2 py-1.5 rounded text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 font-mono"
              placeholder={t('settings.ffprobePlaceholder')}
            />
          </div>

          {/* yt-dlp パス */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              {t('settings.ytdlpPath')}
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={local.ytdlpPath}
                onChange={(e) => setLocal((prev) => ({ ...prev, ytdlpPath: e.target.value }))}
                className="flex-1 border border-gray-300 dark:border-gray-600 px-2 py-1.5 rounded text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 font-mono"
                placeholder={t('settings.ytdlpPlaceholder')}
              />
              <button
                type="button"
                onClick={handlePickYtdlp}
                className="px-3 py-1.5 bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 rounded text-sm border border-gray-300 dark:border-gray-600 whitespace-nowrap"
              >
                {t('settings.browse')}
              </button>
              <button
                type="button"
                onClick={handleDetectYtdlp}
                className="px-3 py-1.5 bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 rounded text-sm border border-gray-300 dark:border-gray-600 whitespace-nowrap"
              >
                {t('settings.autoDetect')}
              </button>
            </div>
            <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
              {t('settings.ytdlpHelp')}
            </p>
          </div>

          <hr className="border-gray-200 dark:border-gray-700" />

          {/* ダウンロード / スクリーンショット */}
          <p className="text-xs font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">
            {t('settings.sectionDownload')}
          </p>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              {t('settings.downloadDir')}
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                readOnly
                value={local.downloadDir}
                placeholder={t('settings.downloadDirPlaceholder')}
                className="flex-1 border border-gray-300 dark:border-gray-600 px-2 py-1.5 rounded text-sm bg-gray-50 dark:bg-gray-800 text-gray-700 dark:text-gray-300 placeholder-gray-400 dark:placeholder-gray-500 font-mono cursor-default min-w-0"
              />
              <button
                type="button"
                onClick={handlePickDownloadDir}
                className="px-3 py-1.5 bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 rounded text-sm border border-gray-300 dark:border-gray-600 whitespace-nowrap shrink-0"
              >
                {t('settings.browse')}
              </button>
              {local.downloadDir && (
                <button
                  type="button"
                  onClick={() => setLocal((prev) => ({ ...prev, downloadDir: "" }))}
                  className="px-2 py-1.5 text-gray-400 hover:text-red-500 dark:hover:text-red-400 text-sm shrink-0"
                  title={t('settings.reset')}
                >
                  ✕
                </button>
              )}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              {t('settings.screenshotDir')}
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                readOnly
                value={local.screenshotDir}
                placeholder={t('settings.screenshotDirPlaceholder')}
                className="flex-1 border border-gray-300 dark:border-gray-600 px-2 py-1.5 rounded text-sm bg-gray-50 dark:bg-gray-800 text-gray-700 dark:text-gray-300 placeholder-gray-400 dark:placeholder-gray-500 font-mono cursor-default min-w-0"
              />
              <button
                type="button"
                onClick={handlePickScreenshotDir}
                className="px-3 py-1.5 bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 rounded text-sm border border-gray-300 dark:border-gray-600 whitespace-nowrap shrink-0"
              >
                {t('settings.browse')}
              </button>
              {local.screenshotDir && (
                <button
                  type="button"
                  onClick={() => setLocal((prev) => ({ ...prev, screenshotDir: "" }))}
                  className="px-2 py-1.5 text-gray-400 hover:text-red-500 dark:hover:text-red-400 text-sm shrink-0"
                  title={t('settings.reset')}
                >
                  ✕
                </button>
              )}
            </div>
          </div>

          <hr className="border-gray-200 dark:border-gray-700" />

          {/* スキャンパス */}
          <p className="text-xs font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">
            {t('settings.sectionScanPaths')}
          </p>

          <div className="space-y-1">
            {watchDirs.length === 0 ? (
              <p className="text-xs text-gray-400 dark:text-gray-500 py-1">
                {t('settings.noScanPaths')}
              </p>
            ) : (
              watchDirs.map((dir) => (
                <div
                  key={dir}
                  className="flex items-center gap-2 bg-gray-50 dark:bg-gray-800 rounded px-2 py-1.5"
                >
                  <span className="flex-1 text-xs font-mono text-gray-700 dark:text-gray-300 truncate" title={dir}>
                    {dir}
                  </span>
                  <button
                    type="button"
                    disabled={removingPath === dir}
                    onClick={() => handleRemoveScanPath(dir)}
                    className="shrink-0 text-gray-400 hover:text-red-500 dark:hover:text-red-400 text-xs px-1 disabled:opacity-40"
                    title={t('settings.removePath')}
                  >
                    {removingPath === dir ? "…" : "✕"}
                  </button>
                </div>
              ))
            )}
          </div>

          <button
            type="button"
            disabled={isScanning || isThumbnailGenerating}
            onClick={handleAddScanPath}
            className="w-full py-1.5 text-sm border border-dashed border-gray-300 dark:border-gray-600 rounded text-gray-500 dark:text-gray-400 hover:border-blue-400 hover:text-blue-500 dark:hover:border-blue-400 dark:hover:text-blue-400 disabled:opacity-40 transition-colors"
          >
            {isScanning || isThumbnailGenerating ? t('app.scanning') : t('settings.addFolder')}
          </button>

          <hr className="border-gray-200 dark:border-gray-700" />

          {/* ウェブサーバー */}
          <p className="text-xs font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">
            {t('settings.sectionWebServer')}
          </p>

          <div className="space-y-3">
            <p className="text-xs text-gray-500 dark:text-gray-400">
              {t('settings.webServerDesc')}
            </p>

            <div className="flex items-center gap-2">
              <label className="text-sm text-gray-700 dark:text-gray-300 shrink-0">{t('settings.port')}</label>
              <input
                type="number"
                min={1024}
                max={65535}
                value={wsPort}
                disabled={wsRunning}
                onChange={(e) => setWsPort(Number(e.target.value))}
                className="w-24 border border-gray-300 dark:border-gray-600 px-2 py-1 rounded text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 disabled:opacity-50"
              />
              {wsRunning ? (
                <button
                  type="button"
                  disabled={wsLoading}
                  onClick={handleStopWs}
                  className="px-3 py-1 text-sm bg-red-600 hover:bg-red-700 text-white rounded disabled:opacity-50"
                >
                  {wsLoading ? t('settings.serverStopping') : t('settings.serverStop')}
                </button>
              ) : (
                <button
                  type="button"
                  disabled={wsLoading}
                  onClick={handleStartWs}
                  className="px-3 py-1 text-sm bg-green-600 hover:bg-green-700 text-white rounded disabled:opacity-50"
                >
                  {wsLoading ? t('settings.serverStarting') : t('settings.serverStart')}
                </button>
              )}
            </div>

            {wsRunning && (
              <div className="rounded bg-green-50 dark:bg-green-950/40 border border-green-200 dark:border-green-800 px-3 py-2 text-xs space-y-1">
                <p className="font-medium text-green-700 dark:text-green-400">{t('settings.serverRunning')}</p>
                <p className="font-mono text-green-600 dark:text-green-500">
                  http://{localIp ?? '???'}:{wsPort}
                </p>
                <p className="text-green-600 dark:text-green-600">
                  /api/videos &nbsp;|&nbsp; /api/stream/:id &nbsp;|&nbsp; /api/thumbnails/:filename
                </p>
              </div>
            )}
          </div>

          <hr className="border-gray-200 dark:border-gray-700" />

          {/* キーボードショートカット */}
          <p className="text-xs font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">
            {t('settings.sectionKeybindings')}
          </p>

          {capturingAction && (
            <div className="px-3 py-2 bg-blue-50 dark:bg-blue-950/50 border border-blue-300 dark:border-blue-700 rounded text-xs text-blue-700 dark:text-blue-300 text-center">
              {t('settings.keybindingCapture', { action: t(KEY_ACTION_KEYS[capturingAction]) })}
              <button
                type="button"
                className="ml-2 text-blue-500 hover:text-blue-700 dark:hover:text-blue-200 underline"
                onClick={() => setCapturingAction(null)}
              >
                {t('settings.keybindingCancel')}
              </button>
            </div>
          )}

          <div className="space-y-1">
            {KEY_ACTION_ORDER.map((action) => (
              <div key={action} className="flex items-center gap-2 py-0.5">
                <span className="flex-1 text-sm text-gray-700 dark:text-gray-300">
                  {t(KEY_ACTION_KEYS[action])}
                </span>
                <kbd className="px-2 py-0.5 text-xs bg-gray-100 dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded font-mono text-gray-700 dark:text-gray-300 min-w-14 text-center">
                  {formatKey(local.keybindings[action])}
                </kbd>
                <button
                  type="button"
                  className={`text-xs px-2 py-0.5 rounded border transition-colors ${
                    capturingAction === action
                      ? 'bg-blue-600 border-blue-600 text-white'
                      : 'border-gray-300 dark:border-gray-600 text-gray-500 dark:text-gray-400 hover:border-blue-400 hover:text-blue-500 dark:hover:text-blue-400'
                  }`}
                  onClick={() => setCapturingAction(capturingAction === action ? null : action)}
                >
                  変更
                </button>
                {local.keybindings[action] !== DEFAULT_KEYBINDINGS[action] && (
                  <button
                    type="button"
                    className="text-xs text-gray-400 hover:text-orange-500 dark:hover:text-orange-400"
                    title="デフォルトに戻す"
                    onClick={() => setLocal((prev) => ({
                      ...prev,
                      keybindings: { ...prev.keybindings, [action]: DEFAULT_KEYBINDINGS[action] },
                    }))}
                  >
                    ↺
                  </button>
                )}
              </div>
            ))}
          </div>

          <button
            type="button"
            className="text-xs text-gray-400 dark:text-gray-500 hover:text-orange-500 dark:hover:text-orange-400"
            onClick={() => setLocal((prev) => ({ ...prev, keybindings: DEFAULT_KEYBINDINGS }))}
          >
            {t('settings.keybindingReset')}
          </button>

          <hr className="border-gray-200 dark:border-gray-700" />

          {/* このアプリについて */}
          <p className="text-xs font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">
            {t('about.sectionTitle')}
          </p>

          <div className="space-y-2">
            <div className="flex items-center gap-3">
              <div>
                <p className="text-sm font-semibold text-gray-800 dark:text-gray-200">Chuck Snap Stack</p>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  {t('about.version')} {appVersion}
                </p>
              </div>
            </div>
            <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed">
              {t('about.description')}
            </p>
            <p className="text-xs text-gray-400 dark:text-gray-500">
              {t('about.license')}
            </p>
          </div>
        </div>

        {/* フッター */}
        <div className="flex justify-end gap-2 px-6 py-4 border-t border-gray-200 dark:border-gray-700 shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 rounded"
          >
            {t('confirm.cancel')}
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={isSaving}
            className="px-4 py-1.5 text-sm bg-blue-600 hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-600 text-white rounded disabled:opacity-50"
          >
            {isSaving ? t('smartPlaylist.saving') : t('smartPlaylist.save')}
          </button>
        </div>
      </div>
    </div>
    </>
  );
}
