import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { open } from "@tauri-apps/plugin-dialog";
import { downloadDir as systemDownloadDir, join } from "@tauri-apps/api/path";
import { invoke } from "@tauri-apps/api/core";
import { useSettingsStore } from "../../store/useSettingsStore";
import { useDownloadStore } from "../../store/useDownloadStore";
import { useLibraryStore } from "../../store/useLibraryStore";
import { notifyInboxChanged } from "../../store/useInboxStore";
import { Download, Link2 } from "lucide-react";
import { Button, Dialog, Input, SegmentedControl, Switch, useDialogClose } from "../ui";
import styles from "./LibraryModal.module.css";

interface Props {
  onClose: () => void;
}

interface UrlMetadata {
  title: string | null;
  thumbnailUrl: string | null;
  siteName: string | null;
  authorName: string | null;
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
  const fetchVideos = useLibraryStore((s) => s.fetchVideos);
  const watchDirs = useLibraryStore((s) => s.watchDirs);

  const [mode, setMode] = useState<"download" | "link">("download");

  // ── ダウンロードモード ──
  const [url, setUrl] = useState("");
  const [saveDir, setSaveDir] = useState("");
  const [filename, setFilename] = useState("video.mp4");
  const [useYtdlp, setUseYtdlp] = useState(false);

  // ── リンクモード ──
  const [linkUrl, setLinkUrl] = useState("");
  const [linkMeta, setLinkMeta] = useState<UrlMetadata | null>(null);
  const [linkTitle, setLinkTitle] = useState("");
  const [isFetching, setIsFetching] = useState(false);
  const [isAdding, setIsAdding] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const dialog = useDialogClose(onClose);

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
    dialog.close();
  };

  const canStart = url.trim() !== "" && saveDir !== "" && (useYtdlp || filename.trim() !== "");

  // ── リンクモード ──
  const handleFetchMeta = async () => {
    const trimmed = linkUrl.trim();
    if (!trimmed) return;
    setIsFetching(true);
    setFetchError(null);
    setLinkMeta(null);
    try {
      const meta = await invoke<UrlMetadata>('fetch_url_metadata', { url: trimmed });
      setLinkMeta(meta);
      setLinkTitle(meta.title ?? "");
    } catch (e) {
      setFetchError(String(e));
    } finally {
      setIsFetching(false);
    }
  };

  const handleAddLink = async () => {
    const trimmed = linkUrl.trim();
    if (!trimmed) return;
    setIsAdding(true);
    try {
      await invoke('db_add_link_asset', {
        url: trimmed,
        title: linkTitle || trimmed,
        thumbnailUrl: linkMeta?.thumbnailUrl ?? null,
      });
      notifyInboxChanged();
      await fetchVideos();
      dialog.close();
    } catch (e) {
      setFetchError(String(e));
    } finally {
      setIsAdding(false);
    }
  };

  return (
    <Dialog
      {...dialog.props}
      size="md"
      title={mode === "download" ? t('download.title') : t('download.linkTitle')}
      closeLabel={t('confirm.close')}
      footer={
        mode === "download" ? (
          <>
            <Button variant="secondary" onClick={() => dialog.close()}>
              {t('download.cancel')}
            </Button>
            <Button variant="primary" onClick={handleDownload} disabled={!canStart}>
              {t('download.start')}
            </Button>
          </>
        ) : (
          <>
            <Button variant="secondary" onClick={() => dialog.close()}>
              {t('download.cancel')}
            </Button>
            <Button variant="primary" onClick={handleAddLink} disabled={!linkUrl.trim() || isAdding}>
              {isAdding ? '…' : t('download.linkAdd')}
            </Button>
          </>
        )
      }
    >
      <div className={styles.stack}>
        {/* モード切り替え */}
        <SegmentedControl<"download" | "link">
          size="md"
          fullWidth
          aria-label={t('download.title')}
          value={mode}
          onValueChange={setMode}
          options={[
            { value: "download", label: <><Download aria-hidden />{t('download.title')}</> },
            { value: "link", label: <><Link2 aria-hidden />{t('download.linkTitle')}</> },
          ]}
        />

        {mode === "download" ? (
          <>
            <label className={styles.spaceBetween}>
              <span className={styles.muted}>yt-dlp</span>
              <Switch checked={useYtdlp} onCheckedChange={setUseYtdlp} aria-label="yt-dlp" />
            </label>

            {useYtdlp && ytdlpPath === "" && (
              <p className={styles.callout} data-tone="warning">{t('download.ytdlpWarning')}</p>
            )}

            <div>
              <label className={styles.label} htmlFor="download-url">URL</label>
              <Input
                id="download-url"
                size="md"
                className={styles.fullWidth}
                placeholder={useYtdlp ? t('download.urlPlaceholderYtdlp') : t('download.urlPlaceholderDirect')}
                value={url}
                onChange={(e) => handleUrlChange(e.target.value)}
                autoFocus
              />
            </div>

            <div>
              <p className={styles.label}>{t('download.saveDir')}</p>
              <div className={styles.row}>
                <Input
                  size="md"
                  className={styles.grow}
                  readOnly
                  placeholder={t('download.saveDirPlaceholder')}
                  value={saveDir}
                  aria-label={t('download.saveDir')}
                />
                <Button variant="secondary" size="md" onClick={handlePickDir}>
                  {t('download.selectDir')}
                </Button>
              </div>
            </div>

            {useYtdlp ? (
              <p className={styles.note}>{t('download.filenameAuto')}</p>
            ) : (
              <div>
                <label className={styles.label} htmlFor="download-filename">{t('download.filename')}</label>
                <Input
                  id="download-filename"
                  size="md"
                  className={styles.fullWidth}
                  value={filename}
                  onChange={(e) => setFilename(e.target.value)}
                />
              </div>
            )}
          </>
        ) : (
          <>
            <div>
              <label className={styles.label} htmlFor="link-url">URL</label>
              <div className={styles.row}>
                <Input
                  id="link-url"
                  size="md"
                  className={styles.grow}
                  placeholder="https://www.youtube.com/watch?v=..."
                  value={linkUrl}
                  onChange={(e) => { setLinkUrl(e.target.value); setLinkMeta(null); setFetchError(null); }}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleFetchMeta(); }}
                  autoFocus
                />
                <Button
                  variant="secondary"
                  size="md"
                  onClick={handleFetchMeta}
                  disabled={!linkUrl.trim() || isFetching}
                >
                  {isFetching ? '…' : t('download.linkFetch')}
                </Button>
              </div>
            </div>

            {fetchError && <p className={styles.callout} data-tone="danger">{fetchError}</p>}

            {linkMeta && (linkMeta.thumbnailUrl || linkMeta.siteName) && (
              <div className={styles.linkPreview}>
                {linkMeta.thumbnailUrl && <img src={linkMeta.thumbnailUrl} alt="" className={styles.linkThumb} />}
                {linkMeta.siteName && (
                  <p className={styles.note}>
                    {linkMeta.siteName}{linkMeta.authorName ? ` · ${linkMeta.authorName}` : ''}
                  </p>
                )}
              </div>
            )}

            {(linkMeta || linkUrl.trim()) && (
              <div>
                <label className={styles.label} htmlFor="link-title">{t('download.linkTitleLabel')}</label>
                <Input
                  id="link-title"
                  size="md"
                  className={styles.fullWidth}
                  placeholder={linkUrl}
                  value={linkTitle}
                  onChange={(e) => setLinkTitle(e.target.value)}
                />
              </div>
            )}
          </>
        )}
      </div>
    </Dialog>
  );
}
