import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import {
  useSettingsStore, type AppSettings, type KeyAction, type Theme,
  KEY_ACTION_LABELS, DEFAULT_KEYBINDINGS,
} from "../../store/useSettingsStore";
import { useLibraryStore } from "../../store/useLibraryStore";

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
  const { mpvPath, ffmpegPath, ffprobePath, ytdlpPath, downloadDir, screenshotDir, keybindings, theme, autoPlayNext, saveSettings, saveKeybindings } = useSettingsStore();
  const { watchDirs, scanAndImport, removeWatchDir, isScanning, isThumbnailGenerating } = useLibraryStore();

  const [local, setLocal] = useState<AppSettings>({ mpvPath, ffmpegPath, ffprobePath, ytdlpPath, downloadDir, screenshotDir, keybindings, theme, autoPlayNext });
  const [isSaving, setIsSaving] = useState(false);
  const [removingPath, setRemovingPath] = useState<string | null>(null);
  const [capturingAction, setCapturingAction] = useState<KeyAction | null>(null);

  // ウェブサーバー
  const [wsPort, setWsPort] = useState(7777);
  const [wsRunning, setWsRunning] = useState(false);
  const [wsLoading, setWsLoading] = useState(false);
  const [localIp, setLocalIp] = useState<string | null>(null);

  useEffect(() => {
    invoke<number | null>('get_web_server_port').then((port) => {
      if (port != null) {
        setWsRunning(true);
        setWsPort(port);
      }
    });
    invoke<string | null>('get_local_ip').then(setLocalIp);
  }, []);

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
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="bg-white dark:bg-gray-900 rounded-lg shadow-xl w-full max-w-lg mx-4 flex flex-col max-h-[85vh]">
        {/* ヘッダー */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-700 shrink-0">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">設定</h2>
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
            外観
          </p>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              テーマ
            </label>
            <div className="flex gap-1 p-1 bg-gray-100 dark:bg-gray-800 rounded-lg w-fit">
              {([['light', 'ライト'], ['dark', 'ダーク'], ['auto', '自動']] as [Theme, string][]).map(([value, label]) => (
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

          <hr className="border-gray-200 dark:border-gray-700" />

          {/* 再生 */}
          <p className="text-xs font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">
            再生
          </p>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-700 dark:text-gray-300">自動再生</p>
              <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
                キュー内の動画が終了したとき、次の動画を自動的に再生する
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

          <p className="text-xs font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">
            実行ファイル
          </p>

          {/* mpv パス */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              mpv パス
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={local.mpvPath}
                onChange={(e) => setLocal((prev) => ({ ...prev, mpvPath: e.target.value }))}
                className="flex-1 border border-gray-300 dark:border-gray-600 px-2 py-1.5 rounded text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 font-mono"
                placeholder="/opt/homebrew/bin/mpv"
              />
              <button
                type="button"
                onClick={handlePickMpv}
                className="px-3 py-1.5 bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 rounded text-sm border border-gray-300 dark:border-gray-600 whitespace-nowrap"
              >
                参照
              </button>
            </div>
          </div>

          {/* ffmpeg パス */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              ffmpeg パス
            </label>
            <input
              type="text"
              value={local.ffmpegPath}
              onChange={(e) => setLocal((prev) => ({ ...prev, ffmpegPath: e.target.value }))}
              className="w-full border border-gray-300 dark:border-gray-600 px-2 py-1.5 rounded text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 font-mono"
              placeholder="ffmpeg"
            />
            <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
              PATH が通っている場合はコマンド名のみでも可
            </p>
          </div>

          {/* ffprobe パス */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              ffprobe パス
            </label>
            <input
              type="text"
              value={local.ffprobePath}
              onChange={(e) => setLocal((prev) => ({ ...prev, ffprobePath: e.target.value }))}
              className="w-full border border-gray-300 dark:border-gray-600 px-2 py-1.5 rounded text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 font-mono"
              placeholder="ffprobe"
            />
          </div>

          {/* yt-dlp パス */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              yt-dlp パス
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={local.ytdlpPath}
                onChange={(e) => setLocal((prev) => ({ ...prev, ytdlpPath: e.target.value }))}
                className="flex-1 border border-gray-300 dark:border-gray-600 px-2 py-1.5 rounded text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 font-mono"
                placeholder="/opt/homebrew/bin/yt-dlp"
              />
              <button
                type="button"
                onClick={handlePickYtdlp}
                className="px-3 py-1.5 bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 rounded text-sm border border-gray-300 dark:border-gray-600 whitespace-nowrap"
              >
                参照
              </button>
              <button
                type="button"
                onClick={handleDetectYtdlp}
                className="px-3 py-1.5 bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 rounded text-sm border border-gray-300 dark:border-gray-600 whitespace-nowrap"
              >
                自動検出
              </button>
            </div>
            <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
              空の場合はバンドルバイナリまたは PATH 上の yt-dlp を使用
            </p>
          </div>

          <hr className="border-gray-200 dark:border-gray-700" />

          {/* ダウンロード / スクリーンショット */}
          <p className="text-xs font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">
            ダウンロード / スクリーンショット
          </p>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              ダウンロード先フォルダ
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                readOnly
                value={local.downloadDir}
                placeholder="未設定（システムの Downloads フォルダを使用）"
                className="flex-1 border border-gray-300 dark:border-gray-600 px-2 py-1.5 rounded text-sm bg-gray-50 dark:bg-gray-800 text-gray-700 dark:text-gray-300 placeholder-gray-400 dark:placeholder-gray-500 font-mono cursor-default min-w-0"
              />
              <button
                type="button"
                onClick={handlePickDownloadDir}
                className="px-3 py-1.5 bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 rounded text-sm border border-gray-300 dark:border-gray-600 whitespace-nowrap shrink-0"
              >
                参照
              </button>
              {local.downloadDir && (
                <button
                  type="button"
                  onClick={() => setLocal((prev) => ({ ...prev, downloadDir: "" }))}
                  className="px-2 py-1.5 text-gray-400 hover:text-red-500 dark:hover:text-red-400 text-sm shrink-0"
                  title="リセット"
                >
                  ✕
                </button>
              )}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              スクリーンショット保存先
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                readOnly
                value={local.screenshotDir}
                placeholder="未設定（ダウンロード先フォルダを使用）"
                className="flex-1 border border-gray-300 dark:border-gray-600 px-2 py-1.5 rounded text-sm bg-gray-50 dark:bg-gray-800 text-gray-700 dark:text-gray-300 placeholder-gray-400 dark:placeholder-gray-500 font-mono cursor-default min-w-0"
              />
              <button
                type="button"
                onClick={handlePickScreenshotDir}
                className="px-3 py-1.5 bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 rounded text-sm border border-gray-300 dark:border-gray-600 whitespace-nowrap shrink-0"
              >
                参照
              </button>
              {local.screenshotDir && (
                <button
                  type="button"
                  onClick={() => setLocal((prev) => ({ ...prev, screenshotDir: "" }))}
                  className="px-2 py-1.5 text-gray-400 hover:text-red-500 dark:hover:text-red-400 text-sm shrink-0"
                  title="リセット"
                >
                  ✕
                </button>
              )}
            </div>
          </div>

          <hr className="border-gray-200 dark:border-gray-700" />

          {/* スキャンパス */}
          <p className="text-xs font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">
            スキャンパス
          </p>

          <div className="space-y-1">
            {watchDirs.length === 0 ? (
              <p className="text-xs text-gray-400 dark:text-gray-500 py-1">
                スキャン対象フォルダがありません
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
                    title="このパスを削除"
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
            {isScanning || isThumbnailGenerating ? "スキャン中..." : "+ フォルダを追加"}
          </button>

          <hr className="border-gray-200 dark:border-gray-700" />

          {/* ウェブサーバー */}
          <p className="text-xs font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">
            ウェブサーバー
          </p>

          <div className="space-y-3">
            <p className="text-xs text-gray-500 dark:text-gray-400">
              LAN 内の他デバイス（スマホ・PC）からブラウザでライブラリを閲覧・再生できます。
            </p>

            <div className="flex items-center gap-2">
              <label className="text-sm text-gray-700 dark:text-gray-300 shrink-0">ポート</label>
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
                  {wsLoading ? '停止中...' : '停止'}
                </button>
              ) : (
                <button
                  type="button"
                  disabled={wsLoading}
                  onClick={handleStartWs}
                  className="px-3 py-1 text-sm bg-green-600 hover:bg-green-700 text-white rounded disabled:opacity-50"
                >
                  {wsLoading ? '起動中...' : '起動'}
                </button>
              )}
            </div>

            {wsRunning && (
              <div className="rounded bg-green-50 dark:bg-green-950/40 border border-green-200 dark:border-green-800 px-3 py-2 text-xs space-y-1">
                <p className="font-medium text-green-700 dark:text-green-400">サーバー稼働中</p>
                <p className="font-mono text-green-600 dark:text-green-500">
                  http://{localIp ?? '???'}:{wsPort}
                </p>
                <p className="text-green-600 dark:text-green-600">
                  エンドポイント: /api/videos &nbsp;|&nbsp; /api/stream/:id &nbsp;|&nbsp; /api/thumbnails/:filename
                </p>
              </div>
            )}
          </div>

          <hr className="border-gray-200 dark:border-gray-700" />

          {/* キーボードショートカット */}
          <p className="text-xs font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">
            キーボードショートカット
          </p>

          {capturingAction && (
            <div className="px-3 py-2 bg-blue-50 dark:bg-blue-950/50 border border-blue-300 dark:border-blue-700 rounded text-xs text-blue-700 dark:text-blue-300 text-center">
              「{KEY_ACTION_LABELS[capturingAction]}」に割り当てるキーを押してください...
              <button
                type="button"
                className="ml-2 text-blue-500 hover:text-blue-700 dark:hover:text-blue-200 underline"
                onClick={() => setCapturingAction(null)}
              >
                キャンセル
              </button>
            </div>
          )}

          <div className="space-y-1">
            {KEY_ACTION_ORDER.map((action) => (
              <div key={action} className="flex items-center gap-2 py-0.5">
                <span className="flex-1 text-sm text-gray-700 dark:text-gray-300">
                  {KEY_ACTION_LABELS[action]}
                </span>
                <kbd className="px-2 py-0.5 text-xs bg-gray-100 dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded font-mono text-gray-700 dark:text-gray-300 min-w-[3.5rem] text-center">
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
            すべてデフォルトに戻す
          </button>
        </div>

        {/* フッター */}
        <div className="flex justify-end gap-2 px-6 py-4 border-t border-gray-200 dark:border-gray-700 shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 rounded"
          >
            キャンセル
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={isSaving}
            className="px-4 py-1.5 text-sm bg-blue-600 hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-600 text-white rounded disabled:opacity-50"
          >
            {isSaving ? "保存中..." : "保存"}
          </button>
        </div>
      </div>
    </div>
  );
}
