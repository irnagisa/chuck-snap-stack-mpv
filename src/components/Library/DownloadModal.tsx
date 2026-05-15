import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { join, downloadDir as systemDownloadDir } from "@tauri-apps/api/path";
import { useLibraryStore } from "../../store/useLibraryStore";
import { useSettingsStore } from "../../store/useSettingsStore";

interface DownloadProgress {
  downloaded: number;
  total: number;
  percent: number;
}

interface Props {
  onClose: () => void;
}

type Phase = "idle" | "downloading" | "done" | "error";

function fileNameFromUrl(url: string): string {
  try {
    const u = new URL(url);
    const segments = u.pathname.split("/").filter(Boolean);
    const last = segments[segments.length - 1] ?? "";
    const name = decodeURIComponent(last).replace(/[?#].*$/, "").trim();
    if (name) return name;
  } catch {
    // fall through
  }
  return "video.mp4";
}

export function DownloadModal({ onClose }: Props) {
  const { addVideoFromPath } = useLibraryStore();
  const { downloadDir: settingsDownloadDir } = useSettingsStore();

  const [url, setUrl] = useState("");
  const [saveDir, setSaveDir] = useState("");
  const [filename, setFilename] = useState("video.mp4");
  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState<DownloadProgress>({ downloaded: 0, total: 0, percent: 0 });
  const [errorMsg, setErrorMsg] = useState("");

  const unlistenRef = useRef<UnlistenFn | null>(null);

  useEffect(() => {
    const init = async () => {
      if (settingsDownloadDir) {
        setSaveDir(settingsDownloadDir);
      } else {
        try {
          setSaveDir(await systemDownloadDir());
        } catch {
          // ignore: user can pick manually
        }
      }
    };
    init();
    return () => {
      unlistenRef.current?.();
    };
  }, [settingsDownloadDir]);

  const handleUrlChange = (value: string) => {
    setUrl(value);
    setFilename(fileNameFromUrl(value));
  };

  const handlePickDir = async () => {
    const selected = await open({ directory: true, multiple: false });
    if (typeof selected === "string") {
      setSaveDir(selected);
    }
  };

  const handleDownload = async () => {
    if (!url.trim() || !saveDir) return;

    const savePath = await join(saveDir, filename);

    setPhase("downloading");
    setProgress({ downloaded: 0, total: 0, percent: 0 });
    setErrorMsg("");

    unlistenRef.current?.();
    unlistenRef.current = await listen<DownloadProgress>(
      "download://progress",
      (event) => setProgress(event.payload)
    );

    try {
      const resultPath = await invoke<string>("download_video", {
        url: url.trim(),
        savePath,
      });

      unlistenRef.current?.();
      unlistenRef.current = null;

      const title = filename.replace(/\.[^.]+$/, "");
      await addVideoFromPath(resultPath, title);

      setPhase("done");
    } catch (e) {
      unlistenRef.current?.();
      unlistenRef.current = null;
      const msg = e instanceof Error ? e.message : String(e);
      if (msg === "キャンセルされました") {
        setPhase("idle");
      } else {
        setErrorMsg(msg);
        setPhase("error");
      }
    }
  };

  const handleCancel = async () => {
    await invoke("cancel_download").catch(() => {});
  };

  const formatBytes = (n: number) => {
    if (n === 0) return "0 B";
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
    return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
  };

  const canStart = url.trim() !== "" && saveDir !== "" && filename.trim() !== "";

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
      onClick={(e) => e.target === e.currentTarget && phase !== "downloading" && onClose()}
    >
      <div className="bg-white dark:bg-gray-900 rounded-xl shadow-2xl w-full max-w-md mx-4 p-6 flex flex-col gap-4">
        <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">URL からダウンロード</h2>

        {/* URL */}
        <div className="flex flex-col gap-1">
          <label className="text-xs text-gray-500 dark:text-gray-400">URL</label>
          <input
            className="border border-gray-300 dark:border-gray-600 rounded px-2.5 py-1.5 text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 disabled:opacity-50"
            placeholder="https://example.com/video.mp4"
            value={url}
            onChange={(e) => handleUrlChange(e.target.value)}
            disabled={phase === "downloading"}
          />
        </div>

        {/* 保存先ディレクトリ */}
        <div className="flex flex-col gap-1">
          <label className="text-xs text-gray-500 dark:text-gray-400">保存先フォルダ</label>
          <div className="flex gap-2">
            <input
              readOnly
              className="flex-1 border border-gray-300 dark:border-gray-600 rounded px-2.5 py-1.5 text-sm bg-gray-50 dark:bg-gray-800 text-gray-700 dark:text-gray-300 placeholder-gray-400 dark:placeholder-gray-500 cursor-default min-w-0"
              placeholder="フォルダを選択..."
              value={saveDir}
            />
            <button
              type="button"
              onClick={handlePickDir}
              disabled={phase === "downloading"}
              className="px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 disabled:opacity-50 shrink-0"
            >
              選択
            </button>
          </div>
        </div>

        {/* ファイル名 */}
        <div className="flex flex-col gap-1">
          <label className="text-xs text-gray-500 dark:text-gray-400">ファイル名</label>
          <input
            className="border border-gray-300 dark:border-gray-600 rounded px-2.5 py-1.5 text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 disabled:opacity-50"
            value={filename}
            onChange={(e) => setFilename(e.target.value)}
            disabled={phase === "downloading"}
          />
        </div>

        {/* プログレス */}
        {phase === "downloading" && (
          <div className="flex flex-col gap-1.5">
            <div className="w-full h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
              <div
                className="h-full bg-blue-500 rounded-full transition-all duration-200"
                style={{ width: `${progress.percent}%` }}
              />
            </div>
            <div className="flex justify-between text-xs text-gray-500 dark:text-gray-400">
              <span>
                {progress.total > 0
                  ? `${formatBytes(progress.downloaded)} / ${formatBytes(progress.total)}`
                  : formatBytes(progress.downloaded)}
              </span>
              <span>{progress.percent}%</span>
            </div>
          </div>
        )}

        {phase === "done" && (
          <p className="text-sm text-green-600 dark:text-green-400">ダウンロード完了。ライブラリに追加しました。</p>
        )}

        {phase === "error" && (
          <p className="text-sm text-red-600 dark:text-red-400 break-all">エラー: {errorMsg}</p>
        )}

        {/* ボタン */}
        <div className="flex gap-2 justify-end pt-1">
          {phase === "downloading" ? (
            <button
              type="button"
              onClick={handleCancel}
              className="px-4 py-1.5 text-sm bg-red-600 hover:bg-red-700 text-white rounded"
            >
              キャンセル
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
              >
                閉じる
              </button>
              {phase !== "done" && (
                <button
                  type="button"
                  onClick={handleDownload}
                  disabled={!canStart}
                  className="px-4 py-1.5 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded disabled:opacity-50"
                >
                  ダウンロード
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
