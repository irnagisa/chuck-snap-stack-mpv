import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { join, downloadDir as systemDownloadDir, basename } from "@tauri-apps/api/path";
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
  const { downloadDir: settingsDownloadDir, ytdlpPath } = useSettingsStore();

  const [url, setUrl] = useState("");
  const [saveDir, setSaveDir] = useState("");
  const [filename, setFilename] = useState("video.mp4");
  const [useYtdlp, setUseYtdlp] = useState(() => ytdlpPath !== "");
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
    if (!useYtdlp) {
      setFilename(fileNameFromUrl(value));
    }
  };

  const handlePickDir = async () => {
    const selected = await open({ directory: true, multiple: false });
    if (typeof selected === "string") {
      setSaveDir(selected);
    }
  };

  const handleDownload = async () => {
    if (!url.trim() || !saveDir) return;

    setPhase("downloading");
    setProgress({ downloaded: 0, total: 0, percent: 0 });
    setErrorMsg("");

    unlistenRef.current?.();
    unlistenRef.current = await listen<DownloadProgress>(
      "download://progress",
      (event) => setProgress(event.payload)
    );

    try {
      let resultPath: string;

      if (useYtdlp) {
        resultPath = await invoke<string>("download_with_ytdlp", {
          url: url.trim(),
          saveDir,
        });
      } else {
        const savePath = await join(saveDir, filename);
        resultPath = await invoke<string>("download_video", {
          url: url.trim(),
          savePath,
        });
      }

      unlistenRef.current?.();
      unlistenRef.current = null;

      // ファイル名からタイトルを生成
      let title: string;
      try {
        const base = await basename(resultPath);
        title = base.replace(/\.[^.]+$/, "");
      } catch {
        title = useYtdlp ? "" : filename.replace(/\.[^.]+$/, "");
      }

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
    if (useYtdlp) {
      await invoke("cancel_ytdlp_download").catch(() => {});
    } else {
      await invoke("cancel_download").catch(() => {});
    }
  };

  const formatBytes = (n: number) => {
    if (n === 0) return "0 B";
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
    return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
  };

  const canStart = url.trim() !== "" && saveDir !== "" && (useYtdlp || filename.trim() !== "");

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
      onClick={(e) => e.target === e.currentTarget && phase !== "downloading" && onClose()}
    >
      <div className="bg-white dark:bg-gray-900 rounded-xl shadow-2xl w-full max-w-md mx-4 p-6 flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">URL からダウンロード</h2>
          {/* yt-dlp トグル */}
          <label className="flex items-center gap-1.5 cursor-pointer select-none">
            <span className="text-xs text-gray-500 dark:text-gray-400">yt-dlp</span>
            <div
              className={`relative w-9 h-5 rounded-full transition-colors ${
                useYtdlp ? "bg-blue-500" : "bg-gray-300 dark:bg-gray-600"
              } ${phase === "downloading" ? "opacity-50 pointer-events-none" : ""}`}
              onClick={() => phase !== "downloading" && setUseYtdlp((v) => !v)}
            >
              <div className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${useYtdlp ? "translate-x-4" : ""}`} />
            </div>
          </label>
        </div>

        {useYtdlp && ytdlpPath === "" && (
          <p className="text-xs text-amber-600 dark:text-amber-400 -mt-2">
            yt-dlp のパスが未設定です。PATH 上にある場合はそのまま使用されます。設定で明示的にパスを指定することもできます。
          </p>
        )}

        {/* URL */}
        <div className="flex flex-col gap-1">
          <label className="text-xs text-gray-500 dark:text-gray-400">URL</label>
          <input
            className="border border-gray-300 dark:border-gray-600 rounded px-2.5 py-1.5 text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 disabled:opacity-50"
            placeholder={useYtdlp ? "https://www.youtube.com/watch?v=..." : "https://example.com/video.mp4"}
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

        {/* ファイル名 (HTTP モードのみ) */}
        {!useYtdlp && (
          <div className="flex flex-col gap-1">
            <label className="text-xs text-gray-500 dark:text-gray-400">ファイル名</label>
            <input
              className="border border-gray-300 dark:border-gray-600 rounded px-2.5 py-1.5 text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 disabled:opacity-50"
              value={filename}
              onChange={(e) => setFilename(e.target.value)}
              disabled={phase === "downloading"}
            />
          </div>
        )}

        {useYtdlp && (
          <p className="text-xs text-gray-400 dark:text-gray-500 -mt-2">
            ファイル名は動画タイトルから自動決定されます
          </p>
        )}

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
                {!useYtdlp && progress.total > 0
                  ? `${formatBytes(progress.downloaded)} / ${formatBytes(progress.total)}`
                  : useYtdlp ? "ダウンロード中..." : formatBytes(progress.downloaded)}
              </span>
              <span>{progress.percent.toFixed(1)}%</span>
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
