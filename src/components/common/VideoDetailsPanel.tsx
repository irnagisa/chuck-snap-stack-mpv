import { useState, useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { appCacheDir, join } from '@tauri-apps/api/path';
import { openUrl, revealItemInDir } from '@tauri-apps/plugin-opener';
import { useTranslation } from 'react-i18next';
import { useLibraryStore } from '../../store/useLibraryStore';
import { toast } from '../../store/useToastStore';
import { Select } from './Select';
import type { Video, SubtitleFile } from '../../types';
import { formatTime, formatFileSize } from '../../utils/time';

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
    <div className="flex flex-col gap-4">
      {/* タイトル */}
      <div>
        <label className="block text-xs font-medium text-gray-400 dark:text-gray-500 mb-1.5">
          {t('detail.titleField')}
        </label>
        <input
          ref={titleRef}
          className="w-full px-2.5 py-1.5 text-sm text-gray-900 dark:text-gray-100 bg-transparent border border-transparent hover:border-gray-300 dark:hover:border-gray-600 focus:border-blue-500 dark:focus:border-blue-400 rounded-lg outline-none transition-colors"
          value={localTitle}
          onChange={(e) => setLocalTitle(e.target.value)}
          onBlur={handleTitleSave}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur();
          }}
        />
        <label className="flex items-center gap-1.5 mt-1 cursor-pointer w-fit">
          <input
            type="checkbox"
            checked={renameFile}
            onChange={(e) => setRenameFile(e.target.checked)}
            className="w-3.5 h-3.5 accent-blue-500"
          />
          <span className="text-xs text-gray-400 dark:text-gray-500">{t('detail.renameFile')}</span>
        </label>
      </div>

      {/* パス */}
      <div>
        <div className="flex items-center justify-between mb-1">
          <label className="block text-xs font-medium text-gray-400 dark:text-gray-500">
            {t('detail.path')}
          </label>
          <button
            type="button"
            className="text-xs text-gray-400 dark:text-gray-500 hover:text-blue-500 dark:hover:text-blue-400 transition-colors flex items-center gap-1"
            onClick={() => revealItemInDir(video.path).catch((e: unknown) => toast.error(`Finder での表示に失敗しました: ${e instanceof Error ? e.message : String(e)}`))}
          >
            <svg
              className="w-3.5 h-3.5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"
              />
            </svg>
            {t('detail.openFinder')}
          </button>
        </div>
        <p className="text-xs text-gray-500 dark:text-gray-400 break-all leading-relaxed">
          {video.path}
        </p>
      </div>

      {/* URL */}
      <div>
        <label className="block text-xs font-medium text-gray-400 dark:text-gray-500 mb-1">
          {t('detail.url')}
        </label>
        <input
          className="w-full px-2.5 py-1.5 text-xs text-gray-900 dark:text-gray-100 bg-transparent border border-transparent hover:border-gray-300 dark:hover:border-gray-600 focus:border-blue-500 dark:focus:border-blue-400 rounded-lg outline-none transition-colors"
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
            className="text-xs text-blue-500 hover:underline mt-0.5 block truncate max-w-full text-left"
            onClick={() => openUrl(localSourceUrl).catch((e: unknown) => toast.error(`URL を開けませんでした: ${e instanceof Error ? e.message : String(e)}`))}
            title={localSourceUrl}
          >
            {localSourceUrl}
          </button>
        )}
      </div>

      {/* メタデータ */}
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <label className="text-xs font-medium text-gray-400 dark:text-gray-500">
            {t('detail.mediaType')}
          </label>
          <button
            type="button"
            className="text-xs px-2 py-0.5 bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-300 rounded disabled:opacity-50"
            onClick={handleRescan}
            disabled={isRescanning}
          >
            {isRescanning ? t('detail.rescanning') : t('detail.rescan')}
          </button>
        </div>
        <Select value={localMediaType} onChange={(e) => handleMediaTypeChange(e.target.value)}>
          <option value="video">{t('detail.mediaVideo')}</option>
          <option value="audio">{t('detail.mediaAudio')}</option>
          <option value="image">{t('detail.mediaImage')}</option>
        </Select>
        <div className="grid grid-cols-2 gap-x-4 gap-y-2.5">
          {video.duration != null && (
            <div>
              <p className="text-[10px] text-gray-400 dark:text-gray-500 mb-0.5">
                {t('detail.duration')}
              </p>
              <p className="text-xs text-gray-800 dark:text-gray-200">
                {formatTime(video.duration)}
              </p>
            </div>
          )}
          <div>
            <p className="text-[10px] text-gray-400 dark:text-gray-500 mb-0.5">
              {t('detail.fileSize')}
            </p>
            <p className="text-xs text-gray-800 dark:text-gray-200">
              {fileSizeBytes != null ? formatFileSize(fileSizeBytes) : '—'}
            </p>
          </div>
          {dimensions && (
            <div>
              <p className="text-[10px] text-gray-400 dark:text-gray-500 mb-0.5">
                {t('detail.resolution')}
              </p>
              <p className="text-xs text-gray-800 dark:text-gray-200">
                {dimensions.width} × {dimensions.height}
              </p>
            </div>
          )}
          {video.progress > 0 && (
            <div>
              <p className="text-[10px] text-gray-400 dark:text-gray-500 mb-0.5">
                {t('detail.watchProgress')}
              </p>
              <p className="text-xs text-gray-800 dark:text-gray-200">
                {formatTime(video.progress)}
              </p>
            </div>
          )}
          <div>
            <p className="text-[10px] text-gray-400 dark:text-gray-500 mb-0.5">
              {t('detail.createdAt')}
            </p>
            <p className="text-xs text-gray-800 dark:text-gray-200">
              {new Date(video.created_at).toLocaleDateString()}
            </p>
          </div>
          <div>
            <p className="text-[10px] text-gray-400 dark:text-gray-500 mb-0.5">
              {t('detail.playCount')}
            </p>
            <p className="text-xs text-gray-800 dark:text-gray-200">
              {video.watch_count ?? 0}
              {t('detail.playCountUnit')}
            </p>
          </div>
        </div>
        {progressPercent !== null && progressPercent > 0 && (
          <div>
            <p className="text-[10px] text-gray-400 dark:text-gray-500 mb-1">
              {t('detail.watchProgress')}
            </p>
            <div className="h-1.5 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
              <div
                className="h-full bg-blue-500 rounded-full"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
          </div>
        )}
      </div>

      {/* サムネイル変更 */}
      <div>
        <label className="block text-xs font-medium text-gray-400 dark:text-gray-500 mb-1.5">
          {t('detail.thumbnail')}
        </label>
        <div className="flex items-center gap-2 flex-wrap">
          <input
            type="number"
            min={0}
            step={1}
            className="w-20 px-2 py-1 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
            value={thumbTimestamp}
            onChange={(e) => setThumbTimestamp(e.target.value)}
          />
          <span className="text-xs text-gray-500 dark:text-gray-400 shrink-0">
            {t('detail.captureAt')}
          </span>
          <button
            type="button"
            onClick={handleCaptureThumb}
            disabled={isCapturingThumb}
            className="px-3 py-1 bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 text-xs rounded disabled:opacity-50"
          >
            {isCapturingThumb ? t('detail.capturing') : t('detail.capture')}
          </button>
        </div>
        {localMediaType === 'audio' && (
          <div className="mt-2">
            <button
              type="button"
              onClick={handleGenerateWaveform}
              disabled={isGeneratingWaveform}
              className="px-3 py-1 bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 text-xs rounded disabled:opacity-50"
            >
              {isGeneratingWaveform ? t('detail.waveformGenerating') : t('detail.waveformGenerate')}
            </button>
          </div>
        )}
      </div>

      {/* 字幕 */}
      <div>
        <div className="flex items-center gap-2 mb-1.5">
          <label className="text-xs font-medium text-gray-400 dark:text-gray-500">
            {t('detail.subtitle')}
          </label>
          <button
            type="button"
            onClick={handleScanSubtitles}
            disabled={isScanningSubs}
            className="px-2 py-0.5 bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 text-xs rounded disabled:opacity-50"
          >
            {isScanningSubs ? t('detail.searchingSubtitle') : t('detail.searchSubtitle')}
          </button>
        </div>
        {subtitles.length === 0 && !isScanningSubs && (
          <p className="text-xs text-gray-400 dark:text-gray-500">{t('detail.subtitleHelp')}</p>
        )}
        {subtitles.length > 0 && (
          <div className="flex flex-col gap-1">
            {subtitles.map((sub) => (
              <div key={sub.path} className="flex items-center gap-2 text-xs">
                <span className="flex-1 truncate text-gray-700 dark:text-gray-300">{sub.name}</span>
                <span className="text-gray-400 dark:text-gray-500 uppercase">{sub.ext}</span>
                <button
                  type="button"
                  onClick={() => handleLoadSubtitle(sub.path)}
                  className={`px-2 py-0.5 rounded text-xs ${
                    loadedSubtitle === sub.path
                      ? 'bg-green-600 text-white'
                      : 'bg-blue-600 hover:bg-blue-700 text-white'
                  }`}
                >
                  {loadedSubtitle === sub.path
                    ? t('detail.subtitleLoaded')
                    : t('detail.subtitleLoad')}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
