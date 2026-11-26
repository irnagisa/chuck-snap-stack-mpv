import { useState, useEffect, useRef, useId, type ReactNode } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { appCacheDir, join } from '@tauri-apps/api/path';
import { openUrl, revealItemInDir } from '@tauri-apps/plugin-opener';
import { useTranslation } from 'react-i18next';
import { useLibraryStore } from '../../store/useLibraryStore';
import { toast } from '../../store/useToastStore';
import { Check, Folder } from 'lucide-react';
import { Select, Button, Input, Checkbox, cx } from '../ui';
import type { Video, SubtitleFile } from '../../types';
import { formatTime, formatFileSize } from '../../utils/time';
import styles from './VideoDetailsPanel.module.css';

interface Props {
  video: Video;
  onThumbnailChange?: () => void;
}

export function VideoDetailsPanel({ video, onThumbnailChange }: Props) {
  const { t } = useTranslation();
  const { updateVideo, rescanVideo } = useLibraryStore();

  const [localTitle, setLocalTitle] = useState(video.title ?? video.path.split('/').pop() ?? '');
  const [localSourceUrl, setLocalSourceUrl] = useState(video.source_url ?? '');
  const [localMediaType, setLocalMediaType] = useState<'video' | 'audio' | 'image'>(
    (video.media_type === 'link' ? 'video' : video.media_type) ?? 'video'
  );
  const [renameFile, setRenameFile] = useState(true);
  const [fileSizeBytes, setFileSizeBytes] = useState<number | null>(null);
  const [dimensions, setDimensions] = useState<{ width: number; height: number } | null>(null);
  const [isRescanning, setIsRescanning] = useState(false);
  const [thumbTimestamp, setThumbTimestamp] = useState('5');
  const [isCapturingThumb, setIsCapturingThumb] = useState(false);
  const [isGeneratingWaveform, setIsGeneratingWaveform] = useState(false);
  const [subtitles, setSubtitles] = useState<SubtitleFile[]>([]);
  const [isScanningSubs, setIsScanningSubs] = useState(false);
  const [loadedSubtitle, setLoadedSubtitle] = useState<string | null>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const titleId = useId();
  const urlId = useId();
  const thumbId = useId();

  useEffect(() => {
    setLocalTitle(video.title ?? video.path.split('/').pop() ?? '');
    setLocalSourceUrl(video.source_url ?? '');
    setLocalMediaType((video.media_type === 'link' ? 'video' : video.media_type) ?? 'video');
    setFileSizeBytes(null);
    setDimensions(null);
    setSubtitles([]);
    setLoadedSubtitle(null);
    invoke<number>('get_file_size', { path: video.path })
      .then(setFileSizeBytes)
      .catch(() => {});
    invoke<{ width: number; height: number }>('get_video_dimensions', { path: video.path })
      .then(setDimensions)
      .catch(() => {});
  }, [video.id, video.path]);

  const progressPercent =
    video.duration && video.duration > 0
      ? Math.min((video.progress / video.duration) * 100, 100)
      : null;

  const handleTitleSave = async () => {
    const trimmed = localTitle.trim();
    if (!trimmed || trimmed === (video.title ?? video.path.split('/').pop())) return;
    if (renameFile) {
      const filename = video.path.split('/').pop() ?? video.path;
      const dotIdx = filename.lastIndexOf('.');
      const ext = dotIdx > 0 ? filename.slice(dotIdx) : '';
      const newFilename = trimmed + ext;
      const oldPath = video.path;
      const newPath = oldPath.substring(0, oldPath.lastIndexOf('/') + 1) + newFilename;
      await updateVideo(video.id, { title: trimmed, path: newPath });
      try {
        await invoke<void>('rename_video_file', { oldPath, newName: newFilename });
      } catch (e) {
        await updateVideo(video.id, { title: video.title ?? '', path: oldPath });
        toast.error(`ファイルのリネームに失敗しました: ${e instanceof Error ? e.message : String(e)}`);
      }
    } else {
      await updateVideo(video.id, { title: trimmed });
    }
  };

  const handleSourceUrlSave = async () => {
    await updateVideo(video.id, { source_url: localSourceUrl.trim() || null });
  };

  const handleMediaTypeChange = async (value: string) => {
    const mt = value as 'video' | 'audio' | 'image';
    setLocalMediaType(mt);
    await updateVideo(video.id, { media_type: mt });
  };

  const handleRescan = async () => {
    setIsRescanning(true);
    try {
      await rescanVideo(video.id);
      const ext = video.path.split('.').pop()?.toLowerCase() ?? '';
      const audioExts = ['mp3', 'flac', 'aac', 'wav', 'ogg', 'opus', 'm4a', 'wma'];
      const imageExts = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'tiff', 'heic', 'avif'];
      const mt: 'video' | 'audio' | 'image' = imageExts.includes(ext)
        ? 'image'
        : audioExts.includes(ext)
          ? 'audio'
          : 'video';
      setLocalMediaType(mt);
    } finally {
      setIsRescanning(false);
    }
  };

  const handleCaptureThumb = async () => {
    const ts = parseFloat(thumbTimestamp);
    if (isNaN(ts) || ts < 0) return;
    setIsCapturingThumb(true);
    try {
      const cacheDir = await appCacheDir();
      const hashBuffer = await crypto.subtle.digest(
        'SHA-256',
        new TextEncoder().encode(video.path)
      );
      const hash = Array.from(new Uint8Array(hashBuffer))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
      const outputPath = video.thumbnail ?? (await join(cacheDir, 'thumbnails', hash.slice(0, 2), `${hash}.webp`));
      await invoke('capture_frame_at', { videoPath: video.path, timestamp: ts, outputPath });
      await invoke('db_update_video_thumbnail', { videoId: video.id, thumbnail: outputPath });
      onThumbnailChange?.();
    } catch (e) {
      toast.error(`サムネイルの取得に失敗しました: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setIsCapturingThumb(false);
    }
  };

  const handleGenerateWaveform = async () => {
    setIsGeneratingWaveform(true);
    try {
      const cacheDir = await appCacheDir();
      const hashBuffer = await crypto.subtle.digest(
        'SHA-256',
        new TextEncoder().encode(video.path)
      );
      const hash = Array.from(new Uint8Array(hashBuffer))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
      const outputPath = await join(cacheDir, 'thumbnails', hash.slice(0, 2), `${hash}.webp`);
      const result = await invoke<string>('generate_waveform', {
        audioPath: video.path,
        outputPath,
      });
      await invoke('db_update_video_thumbnail', { videoId: video.id, thumbnail: result });
      onThumbnailChange?.();
    } catch (e) {
      toast.error(`波形の生成に失敗しました: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setIsGeneratingWaveform(false);
    }
  };

  const handleScanSubtitles = async () => {
    setIsScanningSubs(true);
    try {
      const subs = await invoke<SubtitleFile[]>('scan_subtitle_files', { videoPath: video.path });
      setSubtitles(subs);
    } catch {
      setSubtitles([]);
    } finally {
      setIsScanningSubs(false);
    }
  };

  const handleLoadSubtitle = async (path: string) => {
    try {
      await invoke('load_subtitle', { path });
      setLoadedSubtitle(path);
    } catch (e) {
      toast.error(`字幕の読み込みに失敗しました: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  return (
    <div className={styles.root}>
      {/* タイトル */}
      <div>
        <label className={styles.label} htmlFor={titleId}>
          {t('detail.titleField')}
        </label>
        <Input
          id={titleId}
          size="md"
          variant="ghost"
          className={styles.fullWidth}
          ref={titleRef}
          value={localTitle}
          onChange={(e) => setLocalTitle(e.target.value)}
          onBlur={handleTitleSave}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur();
          }}
        />
        <label className={styles.renameToggle}>
          <Checkbox
            checked={renameFile}
            onCheckedChange={(v) => setRenameFile(v === true)}
          />
          {t('detail.renameFile')}
        </label>
      </div>

      {/* パス */}
      <div>
        <div className={styles.labelRow}>
          <span className={styles.label}>{t('detail.path')}</span>
          <Button
            variant="ghost"
            size="xs"
            onClick={() => revealItemInDir(video.path).catch((e: unknown) => toast.error(`Finder での表示に失敗しました: ${e instanceof Error ? e.message : String(e)}`))}
          >
            <Folder aria-hidden />
            {t('detail.openFinder')}
          </Button>
        </div>
        <p className={styles.path}>{video.path}</p>
      </div>

      {/* URL */}
      <div>
        <label className={styles.label} htmlFor={urlId}>
          {t('detail.url')}
        </label>
        <Input
          id={urlId}
          size="sm"
          variant="ghost"
          className={styles.fullWidth}
          placeholder={t('detail.urlPlaceholder')}
          value={localSourceUrl}
          onChange={(e) => setLocalSourceUrl(e.target.value)}
          onBlur={handleSourceUrlSave}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur();
          }}
        />
        {localSourceUrl && (
          <button
            type="button"
            className={styles.urlLink}
            onClick={() => openUrl(localSourceUrl).catch((e: unknown) => toast.error(`URL を開けませんでした: ${e instanceof Error ? e.message : String(e)}`))}
            title={localSourceUrl}
          >
            {localSourceUrl}
          </button>
        )}
      </div>

      {/* メタデータ */}
      <div className={styles.meta}>
        <div className={styles.labelRow}>
          <span className={styles.label}>{t('detail.mediaType')}</span>
          <Button
            variant="secondary"
            size="xs"
            onClick={handleRescan}
            disabled={isRescanning}
          >
            {isRescanning ? t('detail.rescanning') : t('detail.rescan')}
          </Button>
        </div>
        <Select
          fullWidth
          value={localMediaType}
          onValueChange={handleMediaTypeChange}
          aria-label={t('detail.mediaType')}
          options={[
            { value: 'video', label: t('detail.mediaVideo') },
            { value: 'audio', label: t('detail.mediaAudio') },
            { value: 'image', label: t('detail.mediaImage') },
          ]}
        />
        <dl className={styles.stats}>
          {video.duration != null && (
            <Stat label={t('detail.duration')}>{formatTime(video.duration)}</Stat>
          )}
          <Stat label={t('detail.fileSize')}>
            {fileSizeBytes != null ? formatFileSize(fileSizeBytes) : '—'}
          </Stat>
          {dimensions && (
            <Stat label={t('detail.resolution')}>
              {dimensions.width} × {dimensions.height}
            </Stat>
          )}
          {video.progress > 0 && (
            <Stat label={t('detail.watchProgress')}>{formatTime(video.progress)}</Stat>
          )}
          <Stat label={t('detail.createdAt')}>
            {new Date(video.created_at).toLocaleDateString()}
          </Stat>
          <Stat label={t('detail.playCount')}>
            {video.watch_count ?? 0}
            {t('detail.playCountUnit')}
          </Stat>
        </dl>
        {progressPercent !== null && progressPercent > 0 && (
          <div>
            <p className={cx(styles.statLabel, styles.progressLabel)}>{t('detail.watchProgress')}</p>
            <div
              className={styles.progressTrack}
              role="progressbar"
              aria-label={t('detail.watchProgress')}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(progressPercent)}
            >
              <div className={styles.progressBar} style={{ width: `${progressPercent}%` }} />
            </div>
          </div>
        )}
      </div>

      {/* サムネイル変更 */}
      <div>
        <label className={styles.label} htmlFor={thumbId}>
          {t('detail.thumbnail')}
        </label>
        <div className={styles.thumbRow}>
          <Input
            id={thumbId}
            size="sm"
            className={styles.timestampInput}
            type="number"
            min={0}
            step={1}
            value={thumbTimestamp}
            onChange={(e) => setThumbTimestamp(e.target.value)}
          />
          <span className={styles.thumbUnit}>{t('detail.captureAt')}</span>
          <Button
            variant="secondary"
            size="sm"
            onClick={handleCaptureThumb}
            disabled={isCapturingThumb}
          >
            {isCapturingThumb ? t('detail.capturing') : t('detail.capture')}
          </Button>
        </div>
        {localMediaType === 'audio' && (
          <div className={styles.waveform}>
            <Button
              variant="secondary"
              size="sm"
              onClick={handleGenerateWaveform}
              disabled={isGeneratingWaveform}
            >
              {isGeneratingWaveform ? t('detail.waveformGenerating') : t('detail.waveformGenerate')}
            </Button>
          </div>
        )}
      </div>

      {/* 字幕 */}
      <div>
        <div className={cx(styles.labelRow, styles.labelRowStart)}>
          <span className={styles.label}>{t('detail.subtitle')}</span>
          <Button
            variant="secondary"
            size="xs"
            onClick={handleScanSubtitles}
            disabled={isScanningSubs}
          >
            {isScanningSubs ? t('detail.searchingSubtitle') : t('detail.searchSubtitle')}
          </Button>
        </div>
        {subtitles.length === 0 && !isScanningSubs && (
          <p className={styles.help}>{t('detail.subtitleHelp')}</p>
        )}
        {subtitles.length > 0 && (
          <ul className={styles.subtitles}>
            {subtitles.map((sub) => (
              <li key={sub.path} className={styles.subtitle}>
                <span className={styles.subtitleName} title={sub.name}>{sub.name}</span>
                <span className={styles.subtitleExt}>{sub.ext}</span>
                <Button
                  variant={loadedSubtitle === sub.path ? 'soft' : 'primary'}
                  size="xs"
                  onClick={() => handleLoadSubtitle(sub.path)}
                >
                  {loadedSubtitle === sub.path && <Check aria-hidden />}
                  {loadedSubtitle === sub.path ? t('detail.subtitleLoaded') : t('detail.subtitleLoad')}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function Stat({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className={styles.statLabel}>{label}</dt>
      <dd className={styles.statValue}>{children}</dd>
    </div>
  );
}
