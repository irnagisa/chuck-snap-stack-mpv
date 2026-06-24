import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { open } from "@tauri-apps/plugin-dialog";
import { downloadDir as systemDownloadDir, join } from "@tauri-apps/api/path";
import { useSettingsStore } from "../../store/useSettingsStore";
import { useDownloadStore } from "../../store/useDownloadStore";
import { useLibraryStore } from "../../store/useLibraryStore";

interface Props {
  onClose: () => void;
}

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
  const { t } = useTranslation();
  const { downloadDir: settingsDownloadDir, ytdlpPath } = useSettingsStore();
  const { addJob } = useDownloadStore();
  const watchDirs = useLibraryStore((s) => s.watchDirs);

  const [url, setUrl] = useState("");
  const [saveDir, setSaveDir] = useState("");
  const [filename, setFilename] = useState("video.mp4");
  const [useYtdlp, setUseYtdlp] = useState(false);

  useEffect(() => {
    const init = async () => {
      if (watchDirs.length > 0) {
        setSaveDir(await join(watchDirs[0], 'Unsorted'));
      } else if (settingsDownloadDir) {
        setSaveDir(settingsDownloadDir);
      } else {
        try {
          setSaveDir(await systemDownloadDir());
        } catch {
          // user can pick manually
        }
      }
    };
    init();
  }, [watchDirs, settingsDownloadDir]);

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

  const handleDownload = () => {
    if (!url.trim() || !saveDir) return;
    addJob({ url: url.trim(), saveDir, filename, useYtdlp });
    onClose();
  };

  const canStart = url.trim() !== "" && saveDir !== "" && (useYtdlp || filename.trim() !== "");

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="bg-white dark:bg-gray-900 rounded-xl shadow-2xl w-full max-w-md mx-4 p-6 flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">{t('download.title')}</h2>
          <label className="flex items-center gap-1.5 cursor-pointer select-none">
            <span className="text-xs text-gray-500 dark:text-gray-400">yt-dlp</span>
            <div
              className={`relative w-9 h-5 rounded-full transition-colors ${
                useYtdlp ? "bg-blue-500" : "bg-gray-300 dark:bg-gray-600"
              }`}
              onClick={() => setUseYtdlp((v) => !v)}
            >
              <div className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${useYtdlp ? "translate-x-4" : ""}`} />
            </div>
          </label>
        </div>

        {useYtdlp && ytdlpPath === "" && (
          <p className="text-xs text-amber-600 dark:text-amber-400 -mt-2">
            {t('download.ytdlpWarning')}
          </p>
        )}

        <div className="flex flex-col gap-1">
          <label className="text-xs text-gray-500 dark:text-gray-400">URL</label>
          <input
            className="border border-gray-300 dark:border-gray-600 rounded px-2.5 py-1.5 text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500"
            placeholder={useYtdlp ? t('download.urlPlaceholderYtdlp') : t('download.urlPlaceholderDirect')}
            value={url}
            onChange={(e) => handleUrlChange(e.target.value)}
            autoFocus
          />
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-xs text-gray-500 dark:text-gray-400">{t('download.saveDir')}</label>
          <div className="flex gap-2">
            <input
              readOnly
              className="flex-1 border border-gray-300 dark:border-gray-600 rounded px-2.5 py-1.5 text-sm bg-gray-50 dark:bg-gray-800 text-gray-700 dark:text-gray-300 placeholder-gray-400 dark:placeholder-gray-500 cursor-default min-w-0"
              placeholder={t('download.saveDirPlaceholder')}
              value={saveDir}
            />
            <button
              type="button"
              onClick={handlePickDir}
              className="px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 shrink-0"
            >
              {t('download.selectDir')}
            </button>
          </div>
        </div>

        {!useYtdlp && (
          <div className="flex flex-col gap-1">
            <label className="text-xs text-gray-500 dark:text-gray-400">{t('download.filename')}</label>
            <input
              className="border border-gray-300 dark:border-gray-600 rounded px-2.5 py-1.5 text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
              value={filename}
              onChange={(e) => setFilename(e.target.value)}
            />
          </div>
        )}

        {useYtdlp && (
          <p className="text-xs text-gray-400 dark:text-gray-500 -mt-2">
            {t('download.filenameAuto')}
          </p>
        )}

        <div className="flex gap-2 justify-end pt-1">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
          >
            {t('download.cancel')}
          </button>
          <button
            type="button"
            onClick={handleDownload}
            disabled={!canStart}
            className="px-4 py-1.5 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded disabled:opacity-50"
          >
            {t('download.start')}
          </button>
        </div>
      </div>
    </div>
  );
}
