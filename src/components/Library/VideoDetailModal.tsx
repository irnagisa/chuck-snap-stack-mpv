import { useState, useEffect, useRef, useCallback } from 'react';
import { VideoOrganizerPanel } from '../common/VideoOrganizerPanel';
import { useTranslation } from 'react-i18next';
import { convertFileSrc, invoke } from '@tauri-apps/api/core';
import { appCacheDir, join } from '@tauri-apps/api/path';
import { openUrl, revealItemInDir } from '@tauri-apps/plugin-opener';
import { useLibraryStore } from '../../store/useLibraryStore';
import { useModalStore } from '../../store/useModalStore';
import { useTagStore } from '../../store/useTagStore';
import { usePlayerStore } from '../../store/usePlayerStore';
import { useSettingsStore } from '../../store/useSettingsStore';
import { TranscodeModal } from './TranscodeModal';
import { Select } from '../common/Select';
import type { Video, SubtitleFile, AiSuggestionResult, AiNewSuggestion } from '../../types';
import { listen } from '@tauri-apps/api/event';
import { toast } from '../../store/useToastStore';
import { similarityPct } from '../../utils/phash';

interface Props {
  video: Video;
  onClose: () => void;
  onViewImage?: (video: Video) => void;
}

interface SimilarVideoItem {
  id: number;
  path: string;
  title: string | null;
  thumbnail: string | null;
  duration: number | null;
  phash: string;
}

interface VideoForPhash {
  id: number;
  path: string;
  thumbnail: string | null;
}

type SimilarThreshold = 4 | 8 | 12;

function formatFileSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}


export function VideoDetailModal({ video, onClose, onViewImage }: Props) {
  const { t } = useTranslation();
  const { fetchVideos, updateVideo, rescanVideo } = useLibraryStore();
  const { play } = usePlayerStore();
  const { aiEnabled } = useSettingsStore();

  const [localTitle, setLocalTitle] = useState(video.title ?? video.path.split('/').pop() ?? '');
  const [fileSizeBytes, setFileSizeBytes] = useState<number | null>(null);
  const [dimensions, setDimensions] = useState<{ width: number; height: number } | null>(null);
  const [renameFile, setRenameFile] = useState(true);
  const [showTranscode, setShowTranscode] = useState(false);
  const [thumbTimestamp, setThumbTimestamp] = useState('5');
  const [isCapturingThumb, setIsCapturingThumb] = useState(false);
  const [localThumbnail, setLocalThumbnail] = useState(video.thumbnail ?? null);
  const [thumbCacheBust, setThumbCacheBust] = useState(0);
  const [isRescanning, setIsRescanning] = useState(false);
  const [localMediaType, setLocalMediaType] = useState<'video' | 'audio' | 'image'>(video.media_type ?? 'video');
  const [subtitles, setSubtitles] = useState<SubtitleFile[]>([]);
  const [isScanningSubs, setIsScanningSubs] = useState(false);
  const [loadedSubtitle, setLoadedSubtitle] = useState<string | null>(null);
  const [localSourceUrl, setLocalSourceUrl] = useState(video.source_url ?? '');
  const titleRef = useRef<HTMLInputElement>(null);

  // Similar videos state
  const { openDetailVideo } = useModalStore();
  const [similarLoading, setSimilarLoading] = useState(false);
  const [similarHashProgress, setSimilarHashProgress] = useState<{ done: number; total: number } | null>(null);
  const [similarVideos, setSimilarVideos] = useState<SimilarVideoItem[]>([]);
  const [similarThreshold, setSimilarThreshold] = useState<SimilarThreshold>(8);
  const [similarDetected, setSimilarDetected] = useState(false);
  const [currentPhash, setCurrentPhash] = useState<string | null>(null);

  const detectSimilar = useCallback(async (overrideThreshold?: SimilarThreshold) => {
    const activeThreshold = overrideThreshold ?? similarThreshold;
    setSimilarLoading(true);
    setSimilarHashProgress(null);
    try {
      // Compute pHash for any video without one (including this video)
      const pending = await invoke<VideoForPhash[]>('db_get_videos_without_phash');
      if (pending.length > 0) {
        setSimilarHashProgress({ done: 0, total: pending.length });
        for (let i = 0; i < pending.length; i++) {
          const v = pending[i];
          try {
            const computed = await invoke<string>('db_compute_video_phash', {
              videoId: v.id,
              videoPath: v.path,
              thumbnailPath: v.thumbnail ?? null,
            });
            if (v.id === video.id) setCurrentPhash(computed);
          } catch {
            // skip unreadable files silently
          }
          setSimilarHashProgress({ done: i + 1, total: pending.length });
        }
      }
      // Fetch stored phash for similarity % display (set if not already from computation above)
      const storedPhash = await invoke<string | null>('db_get_video_stored_phash', { videoId: video.id })
        .catch(() => null);
      if (storedPhash) setCurrentPhash(storedPhash);

      const result = await invoke<SimilarVideoItem[]>('db_find_similar_to_video', {
        videoId: video.id,
        threshold: activeThreshold,
      });
      setSimilarVideos(result);
      setSimilarDetected(true);
    } catch (e) {
      toast.error(`類似検索に失敗しました: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSimilarLoading(false);
      setSimilarHashProgress(null);
    }
  }, [video.id, similarThreshold]);

  // Auto-run similar detection on mount
  useEffect(() => {
    detectSimilar();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [video.id]);

  const handleSimilarThresholdChange = (next: SimilarThreshold) => {
    setSimilarThreshold(next);
    setSimilarDetected(false);
    setSimilarVideos([]);
    detectSimilar(next);
  };

  const handleOpenSimilar = (sim: SimilarVideoItem) => {
    const found = useLibraryStore.getState().videos.find((v) => v.id === sim.id);
    if (found) {
      openDetailVideo(found);
    } else {
      const minimal: Video = {
        id: sim.id,
        path: sim.path,
        title: sim.title,
        duration: sim.duration,
        thumbnail: sim.thumbnail,
        watched_at: null,
        progress: 0,
        rating: 0,
        category_id: null,
        has_audio: null,
        watch_count: 0,
        created_at: new Date().toISOString(),
        media_type: 'video',
        source_url: null,
        status: null,
        source_type: null,
      };
      openDetailVideo(minimal);
    }
  };

  // AI tag suggestion state
  const [aiModelDownloaded, setAiModelDownloaded] = useState<boolean | null>(null);
  const [aiDownloading, setAiDownloading] = useState(false);
  const [aiDownloadProgress, setAiDownloadProgress] = useState(0);
  const [aiAnalyzing, setAiAnalyzing] = useState(false);
  const [aiResult, setAiResult] = useState<AiSuggestionResult | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);
  const { tags, addTagToVideo, createTag, fetchTags } = useTagStore();

  useEffect(() => {
    invoke<number>('get_file_size', { path: video.path })
      .then(setFileSizeBytes)
      .catch(() => {});
    invoke<{ width: number; height: number }>('get_video_dimensions', { path: video.path })
      .then(setDimensions)
      .catch(() => {});
  }, [video.path]);

  useEffect(() => {
    invoke<{ downloaded: boolean; downloading: boolean; progress: number }>(
      'check_ai_model_status'
    )
      .then((s) => {
        setAiModelDownloaded(s.downloaded);
        setAiDownloading(s.downloading);
        setAiDownloadProgress(s.progress);
      })
      .catch(() => setAiModelDownloaded(false));
  }, []);

  useEffect(() => {
    let unlisten: (() => void) | null = null;
    let cancelled = false;
    listen<number>('ai://download-progress', (e) => {
      setAiDownloadProgress(e.payload);
      if (e.payload >= 1.0) {
        setAiDownloading(false);
        setAiModelDownloaded(true);
      }
    }).then((fn) => {
      // コンポーネントが listen() 解決前にアンマウントされた場合は
      // 即座に unlisten して登録済みリスナーを解放する
      if (cancelled) { fn(); } else { unlisten = fn; }
    });
    return () => { cancelled = true; unlisten?.(); };
  }, []);

  const handleDownloadAiModel = async () => {
    setAiDownloading(true);
    setAiDownloadProgress(0);
    setAiError(null);
    try {
      await invoke('download_ai_model');
    } catch (e) {
      setAiError(String(e));
      setAiDownloading(false);
    }
  };

  const handleAnalyzeTags = async () => {
    setAiAnalyzing(true);
    setAiError(null);
    try {
      const result = await invoke<AiSuggestionResult>('analyze_thumbnail_for_tags', {
        videoId: video.id,
      });
      setAiResult(result);
    } catch (e) {
      setAiError(String(e));
    } finally {
      setAiAnalyzing(false);
    }
  };

  const handleApplyMatchedTag = async (tagId: number) => {
    try {
      await addTagToVideo(video.id, tagId);
    } catch {
      // ignore duplicate
    }
  };

  const handleNewSuggestionClick = async (sug: AiNewSuggestion) => {
    const name = window.prompt('新しいタグ名を確認してください:', sug.name);
    if (!name) return;
    try {
      const tag = await createTag(name.trim(), '#6366f1');
      await addTagToVideo(video.id, tag.id);
      await fetchTags();
    } catch {
      // ignore duplicate
    }
  };

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

  const handlePlay = () => {
    play(video);
  };

  const handleCaptureThumb = async () => {
    const ts = parseFloat(thumbTimestamp);
    if (isNaN(ts) || ts < 0) return;
    setIsCapturingThumb(true);
    try {
      let outputPath = localThumbnail;
      if (!outputPath) {
        const cacheDir = await appCacheDir();
        const hashBuffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(video.path));
        const hash = Array.from(new Uint8Array(hashBuffer)).map((b) => b.toString(16).padStart(2, '0')).join('');
        outputPath = await join(cacheDir, 'thumbnails', hash.slice(0, 2), `${hash}.webp`);
      }
      await invoke('capture_frame_at', {
        videoPath: video.path,
        timestamp: ts,
        outputPath,
      });
      await invoke('db_update_video_thumbnail', { videoId: video.id, thumbnail: outputPath });
      setLocalThumbnail(outputPath);
      setThumbCacheBust(Date.now());
      await fetchVideos();
    } catch (e) {
      toast.error(`サムネイルの取得に失敗しました: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setIsCapturingThumb(false);
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

  const handleMediaTypeChange = async (value: string) => {
    const mt = value as 'video' | 'audio' | 'image';
    setLocalMediaType(mt);
    await updateVideo(video.id, { media_type: mt });
  };

  const handleSourceUrlSave = async () => {
    const trimmed = localSourceUrl.trim();
    await updateVideo(video.id, { source_url: trimmed || null });
  };

  const handleRescan = async () => {
    setIsRescanning(true);
    try {
      await rescanVideo(video.id);
      const ext = video.path.split('.').pop()?.toLowerCase() ?? '';
      const audioExts = ['mp3', 'flac', 'aac', 'wav', 'ogg', 'opus', 'm4a', 'wma'];
      const imageExts = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'tiff', 'heic', 'avif'];
      const mt: 'video' | 'audio' | 'image' = imageExts.includes(ext) ? 'image' : audioExts.includes(ext) ? 'audio' : 'video';
      setLocalMediaType(mt);
    } finally {
      setIsRescanning(false);
    }
  };

  return (
    <>
      {showTranscode && (
        <TranscodeModal
          video={video}
          onClose={() => {
            setShowTranscode(false);
            onClose();
          }}
        />
      )}
      <div className="flex flex-col h-full bg-white dark:bg-gray-900 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-700 shrink-0">
          <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">{t('detail.title')}</h2>
          <button
            type="button"
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 text-lg leading-none"
            onClick={onClose}
          >
            ✕
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto pb-20">
          {/* サムネイル + 再生 */}
          <div className="px-4 pt-4 pb-3 flex flex-col gap-2">
            <div
              className="relative aspect-video bg-gray-200 dark:bg-gray-700 rounded-lg overflow-hidden cursor-pointer"
              onDoubleClick={handlePlay}
            >
              {localThumbnail ? (
                <img
                  src={`${convertFileSrc(localThumbnail)}${thumbCacheBust ? `?t=${thumbCacheBust}` : ''}`}
                  alt={localTitle}
                  className={`w-full h-full ${video.media_type === 'image' ? 'object-contain bg-black' : 'object-cover'}`}
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-gray-400 dark:text-gray-500 text-3xl">
                  {video.media_type === 'image' ? '🖼' : video.media_type === 'audio' ? '♪' : '▶'}
                </div>
              )}
            </div>
            {progressPercent !== null && progressPercent > 0 && (
              <div className="h-1 bg-gray-200 dark:bg-gray-700 rounded-full">
                <div className="h-full bg-blue-500 rounded-full" style={{ width: `${progressPercent}%` }} />
              </div>
            )}
            <div className="flex gap-2">
              {video.media_type === 'image' ? (
                onViewImage && (
                  <button
                    type="button"
                    className="flex-1 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm rounded-lg font-medium"
                    onClick={() => onViewImage(video)}
                  >
                    {t('detail.viewer')}
                  </button>
                )
              ) : (
                <button
                  type="button"
                  className="flex-1 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm rounded-lg font-medium"
                  onClick={handlePlay}
                >
                  {t('detail.play')}
                </button>
              )}
              <button
                type="button"
                className="py-1.5 px-3 bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 text-xs rounded-lg font-medium disabled:opacity-50"
                onClick={handleRescan}
                disabled={isRescanning}
                title={t('detail.rescanTitle')}
              >
                {isRescanning ? t('detail.rescanning') : t('detail.rescan')}
              </button>
              {video.media_type !== 'image' && (
                <button
                  type="button"
                  className="py-1.5 px-3 bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 text-xs rounded-lg font-medium"
                  onClick={() => setShowTranscode(true)}
                >
                  AV1
                </button>
              )}

            </div>
          </div>

          <div className="flex flex-col divide-y divide-gray-100 dark:divide-gray-800 px-4">
            {/* タイトル + パス */}
            <div className="pb-4 flex flex-col gap-3">
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
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.currentTarget.blur(); } }}
                />
                <label className="flex items-center gap-1.5 mt-1.5 cursor-pointer w-fit">
                  <input
                    type="checkbox"
                    checked={renameFile}
                    onChange={(e) => setRenameFile(e.target.checked)}
                    className="w-3.5 h-3.5 accent-blue-500"
                  />
                  <span className="text-xs text-gray-400 dark:text-gray-500">{t('detail.renameFile')}</span>
                </label>
              </div>
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-xs font-medium text-gray-400 dark:text-gray-500">
                    {t('detail.path')}
                  </label>
                  <button
                    type="button"
                    className="text-xs text-gray-400 dark:text-gray-500 hover:text-blue-500 dark:hover:text-blue-400 transition-colors flex items-center gap-1"
                    onClick={() => revealItemInDir(video.path).catch((e: unknown) => toast.error(`Finder での表示に失敗しました: ${e instanceof Error ? e.message : String(e)}`))}
                    title={t('detail.openFinder')}
                  >
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                    </svg>
                    {t('detail.openFinder')}
                  </button>
                </div>
                <p className="text-xs text-gray-500 dark:text-gray-400 break-all leading-relaxed">{video.path}</p>
              </div>
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
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.currentTarget.blur(); } }}
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
            </div>

            {/* カテゴリ + タグ + 評価 */}
            <div className="py-4">
              <VideoOrganizerPanel video={video} />
            </div>

            {/* メタデータ */}
            <div className="py-4 flex flex-col gap-3">
              <div className="grid grid-cols-2 gap-x-4 gap-y-3">
                <div>
                  <label className="block text-xs font-medium text-gray-400 dark:text-gray-500 mb-1">
                    {t('detail.mediaType')}
                  </label>
                  <Select
                    value={localMediaType}
                    onChange={(e) => handleMediaTypeChange(e.target.value)}
                  >
                    <option value="video">{t('detail.mediaVideo')}</option>
                    <option value="audio">{t('detail.mediaAudio')}</option>
                    <option value="image">{t('detail.mediaImage')}</option>
                  </Select>
                </div>
                {video.duration != null && (
                  <div>
                    <label className="block text-xs font-medium text-gray-400 dark:text-gray-500 mb-1">
                      {t('detail.duration')}
                    </label>
                    <p className="text-sm text-gray-800 dark:text-gray-200">{formatDuration(video.duration)}</p>
                  </div>
                )}
                {video.progress > 0 && (
                  <div>
                    <label className="block text-xs font-medium text-gray-400 dark:text-gray-500 mb-1">
                      {t('detail.watchProgress')}
                    </label>
                    <p className="text-sm text-gray-800 dark:text-gray-200">{formatDuration(video.progress)}</p>
                  </div>
                )}
                <div>
                  <label className="block text-xs font-medium text-gray-400 dark:text-gray-500 mb-1">
                    {t('detail.fileSize')}
                  </label>
                  <p className="text-sm text-gray-800 dark:text-gray-200">
                    {fileSizeBytes != null ? formatFileSize(fileSizeBytes) : '—'}
                  </p>
                </div>
                {dimensions && (
                  <div>
                    <label className="block text-xs font-medium text-gray-400 dark:text-gray-500 mb-1">
                      {t('detail.resolution')}
                    </label>
                    <p className="text-sm text-gray-800 dark:text-gray-200">
                      {dimensions.width} × {dimensions.height}
                    </p>
                  </div>
                )}
                <div>
                  <label className="block text-xs font-medium text-gray-400 dark:text-gray-500 mb-1">
                    {t('detail.createdAt')}
                  </label>
                  <p className="text-sm text-gray-800 dark:text-gray-200">
                    {new Date(video.created_at).toLocaleDateString()}
                  </p>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-400 dark:text-gray-500 mb-1">
                    {t('detail.playCount')}
                  </label>
                  <p className="text-sm text-gray-800 dark:text-gray-200">
                    {(video.watch_count ?? 0)}{t('detail.playCountUnit')}
                  </p>
                </div>
              </div>
            </div>

            {/* カスタムサムネイル */}
            <div className="pt-4 pb-4 flex flex-col gap-2">
              <label className="block text-xs font-medium text-gray-400 dark:text-gray-500">
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
                <span className="text-xs text-gray-500 dark:text-gray-400 shrink-0">{t('detail.captureAt')}</span>
                <button
                  type="button"
                  onClick={handleCaptureThumb}
                  disabled={isCapturingThumb}
                  className="px-3 py-1 bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 text-xs rounded disabled:opacity-50"
                >
                  {isCapturingThumb ? t('detail.capturing') : t('detail.capture')}
                </button>
              </div>
            </div>

            {/* AI タグ提案 */}
            {aiEnabled && <div className="pt-4 pb-4 flex flex-col gap-2">
              <label className="block text-xs font-medium text-gray-400 dark:text-gray-500">
                AI タグ提案
              </label>

              {aiModelDownloaded === false && !aiDownloading && (
                <button
                  type="button"
                  onClick={handleDownloadAiModel}
                  className="w-full py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs rounded-lg font-medium"
                >
                  AI タグ機能を有効にする（~200 MB）
                </button>
              )}

              {aiDownloading && (
                <div className="flex flex-col gap-1">
                  <div className="h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-indigo-500 rounded-full transition-all"
                      style={{ width: `${Math.round(aiDownloadProgress * 100)}%` }}
                    />
                  </div>
                  <p className="text-xs text-gray-500 dark:text-gray-400 text-center">
                    ダウンロード中… {Math.round(aiDownloadProgress * 100)}%
                  </p>
                </div>
              )}

              {aiModelDownloaded && !aiDownloading && (
                <>
                  <button
                    type="button"
                    onClick={handleAnalyzeTags}
                    disabled={aiAnalyzing || !localThumbnail}
                    className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs rounded-lg font-medium disabled:opacity-50"
                  >
                    {aiAnalyzing ? '分析中…' : 'タグを分析する'}
                  </button>

                  {!localThumbnail && (
                    <p className="text-xs text-gray-400 dark:text-gray-500">
                      サムネイルが必要です
                    </p>
                  )}

                  {aiError && (
                    <p className="text-xs text-red-500">{aiError}</p>
                  )}

                  {aiResult && (
                    <div className="flex flex-col gap-3 mt-1">
                      {/* 既存タグ候補 */}
                      {aiResult.matched_tags.length > 0 && (
                        <div className="flex flex-col gap-1">
                          <p className="text-xs font-medium text-gray-500 dark:text-gray-400">
                            既存タグ候補
                          </p>
                          {aiResult.matched_tags.map((m) => {
                            const tag = tags.find((t) => t.id === m.tag_id);
                            if (!tag) return null;
                            return (
                              <label
                                key={m.tag_id}
                                className="flex items-center gap-2 cursor-pointer text-xs"
                              >
                                <input
                                  type="checkbox"
                                  className="w-3.5 h-3.5 accent-indigo-500"
                                  onChange={(e) => {
                                    if (e.target.checked) handleApplyMatchedTag(m.tag_id);
                                  }}
                                />
                                <span
                                  className="px-1.5 py-0.5 rounded text-white text-xs"
                                  style={{ backgroundColor: tag.color }}
                                >
                                  {tag.name}
                                </span>
                                <span className="text-gray-400 dark:text-gray-500">
                                  {(m.score * 100).toFixed(0)}%
                                </span>
                              </label>
                            );
                          })}
                        </div>
                      )}

                      {/* 新規タグ候補 */}
                      {aiResult.new_suggestions.length > 0 && (
                        <div className="flex flex-col gap-1">
                          <p className="text-xs font-medium text-gray-500 dark:text-gray-400">
                            新規タグ候補
                          </p>
                          <div className="flex flex-wrap gap-1">
                            {aiResult.new_suggestions.map((sug) => (
                              <button
                                key={sug.name}
                                type="button"
                                onClick={() => handleNewSuggestionClick(sug)}
                                className="px-2 py-0.5 bg-gray-100 hover:bg-indigo-100 dark:bg-gray-800 dark:hover:bg-indigo-900 text-gray-700 dark:text-gray-300 text-xs rounded border border-gray-200 dark:border-gray-700 hover:border-indigo-400 transition-colors"
                                title={`スコア: ${(sug.score * 100).toFixed(0)}%`}
                              >
                                + {sug.name}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </>
              )}
            </div>

            }

            {/* 字幕ファイル管理 */}
            <div className="pt-4 pb-4 flex flex-col gap-2">
              <div className="flex items-center gap-2">
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
                <p className="text-xs text-gray-400 dark:text-gray-500">
                  {t('detail.subtitleHelp')}
                </p>
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
                        {loadedSubtitle === sub.path ? t('detail.subtitleLoaded') : t('detail.subtitleLoad')}
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* 類似動画 */}
            <div className="pt-4 pb-4 flex flex-col gap-2">
              <div className="flex items-center gap-2 flex-wrap">
                <label className="text-xs font-medium text-gray-400 dark:text-gray-500 shrink-0">
                  {t('detail.similarVideos')}
                </label>
                <span className="text-xs text-gray-400 dark:text-gray-500 shrink-0 ml-auto">
                  {t('detail.similarSensitivity')}:
                </span>
                {([4, 8, 12] as SimilarThreshold[]).map((th) => (
                  <button
                    key={th}
                    type="button"
                    onClick={() => handleSimilarThresholdChange(th)}
                    className={`px-2 py-0.5 text-xs rounded transition-colors ${
                      similarThreshold === th
                        ? 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 font-medium'
                        : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
                    }`}
                  >
                    {th === 4
                      ? t('detail.similarSensHigh')
                      : th === 8
                      ? t('detail.similarSensNormal')
                      : t('detail.similarSensLow')}
                  </button>
                ))}
              </div>

              {similarLoading ? (
                <div className="flex flex-col items-center py-4 gap-2 text-xs text-gray-400 dark:text-gray-500">
                  <div className="w-4 h-4 border-2 border-gray-300 dark:border-gray-600 border-t-blue-500 rounded-full animate-spin" />
                  {similarHashProgress
                    ? t('detail.similarComputing', { done: similarHashProgress.done, total: similarHashProgress.total })
                    : '…'}
                  {similarHashProgress && (
                    <div className="w-40 bg-gray-200 dark:bg-gray-700 rounded-full h-1 mt-1">
                      <div
                        className="bg-blue-500 h-1 rounded-full transition-all"
                        style={{ width: `${(similarHashProgress.done / similarHashProgress.total) * 100}%` }}
                      />
                    </div>
                  )}
                </div>
              ) : similarDetected && similarVideos.length === 0 ? (
                <div className="flex flex-col items-center py-4 gap-1">
                  <p className="text-xs text-gray-400 dark:text-gray-500">{t('detail.similarEmpty')}</p>
                  <button
                    type="button"
                    className="mt-1 px-3 py-1 text-xs bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 rounded"
                    onClick={() => detectSimilar()}
                  >
                    {t('detail.similarRedetect')}
                  </button>
                </div>
              ) : (
                <div className="flex flex-col gap-1">
                  {similarVideos.map((sim) => {
                    const pct = currentPhash ? similarityPct(sim.phash, currentPhash) : null;
                    return (
                      <button
                        key={sim.id}
                        type="button"
                        className="flex items-center gap-3 px-2 py-2 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700/40 transition-colors text-left w-full"
                        onClick={() => handleOpenSimilar(sim)}
                      >
                        {sim.thumbnail ? (
                          <img
                            src={convertFileSrc(sim.thumbnail)}
                            alt=""
                            className="w-16 h-10 object-cover rounded shrink-0 bg-gray-200 dark:bg-gray-700"
                          />
                        ) : (
                          <div className="w-16 h-10 rounded bg-gray-200 dark:bg-gray-700 shrink-0 flex items-center justify-center text-gray-400 text-base">
                            ▶
                          </div>
                        )}
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-medium text-gray-900 dark:text-gray-100 truncate">
                            {sim.title ?? sim.path.split('/').pop()}
                          </p>
                          {sim.duration != null && (
                            <p className="text-[10px] text-gray-400 dark:text-gray-500 mt-0.5">
                              {formatDuration(sim.duration)}
                            </p>
                          )}
                        </div>
                        {pct !== null && (
                          <span
                            className={`text-[10px] font-medium shrink-0 ${
                              pct >= 95
                                ? 'text-red-500 dark:text-red-400'
                                : pct >= 88
                                ? 'text-amber-500 dark:text-amber-400'
                                : 'text-gray-400 dark:text-gray-500'
                            }`}
                          >
                            {t('detail.similarPct', { pct })}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
