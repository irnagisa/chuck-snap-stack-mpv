import { useState, useEffect, useRef, useCallback } from 'react';
import { VideoOrganizerPanel } from '../common/VideoOrganizerPanel';
import { useTranslation } from 'react-i18next';
import { invoke } from '@tauri-apps/api/core';
import { appCacheDir, join } from '@tauri-apps/api/path';
import { openUrl, revealItemInDir } from '@tauri-apps/plugin-opener';
import { useLibraryStore } from '../../store/useLibraryStore';
import { useModalStore } from '../../store/useModalStore';
import { useTagStore } from '../../store/useTagStore';
import { usePlayerStore } from '../../store/usePlayerStore';
import { useSettingsStore } from '../../store/useSettingsStore';
import { TranscodeModal } from './TranscodeModal';
import { Button, Checkbox, Dialog, Input, SegmentedControl, Select } from '../ui';
import { ThumbImage } from './MediaThumb';
import { TagBadge } from './TagBadge';
import styles from './VideoDetailModal.module.css';
import type { Video, SubtitleFile, AiSuggestionResult, AiNewSuggestion } from '../../types';
import { listen } from '@tauri-apps/api/event';
import { toast } from '../../store/useToastStore';
import { similarityPct } from '../../utils/phash';
import { formatTime, formatFileSize } from '../../utils/time';
import { Check, ExternalLink, Film, FolderOpen, Image as ImageIcon, LoaderCircle, Maximize2, Music, Play, Plus, X } from "lucide-react";

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

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** 見出し付きの区切り */
function Section({ title, actions, children }: { title: React.ReactNode; actions?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className={styles.section}>
      <div className={styles.sectionHead}>
        <h3 className={styles.sectionTitle}>{title}</h3>
        {actions}
      </div>
      {children}
    </section>
  );
}


export function VideoDetailModal({ video, onClose, onViewImage }: Props) {
  const { t } = useTranslation();
  const { fetchVideos, updateVideo, rescanVideo } = useLibraryStore();
  const { play } = usePlayerStore();
  const { aiEnabled, aiModelType } = useSettingsStore();

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
  const isLink = video.media_type === 'link';
  const [localMediaType, setLocalMediaType] = useState<'video' | 'audio' | 'image'>(
    (video.media_type === 'link' ? 'video' : video.media_type) ?? 'video'
  );
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
      toast.error(t('detail.similarFailed', { error: errorText(e) }));
    } finally {
      setSimilarLoading(false);
      setSimilarHashProgress(null);
    }
  }, [video.id, similarThreshold, t]);

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
    if (isLink) return;
    invoke<number>('get_file_size', { path: video.path })
      .then(setFileSizeBytes)
      .catch(() => {});
    invoke<{ width: number; height: number }>('get_video_dimensions', { path: video.path })
      .then(setDimensions)
      .catch(() => {});
  }, [video.path, isLink]);

  useEffect(() => {
    invoke<{ downloaded: boolean; downloading: boolean; progress: number }>(
      'check_ai_model_status',
      { modelType: aiModelType }
    )
      .then((s) => {
        setAiModelDownloaded(s.downloaded);
        setAiDownloading(s.downloading);
        setAiDownloadProgress(s.progress);
      })
      .catch(() => setAiModelDownloaded(false));
  }, [aiModelType]);

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
      await invoke('download_ai_model', { modelType: aiModelType });
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

  // 新規タグ候補: 名前を確認するダイアログを開く
  const [newTagOpen, setNewTagOpen] = useState(false);
  const [newTagName, setNewTagName] = useState('');
  const handleNewSuggestionClick = (sug: AiNewSuggestion) => {
    setNewTagName(sug.name);
    setNewTagOpen(true);
  };
  const handleCreateNewTag = async () => {
    const name = newTagName.trim();
    if (!name) return;
    setNewTagOpen(false);
    try {
      const tag = await createTag(name, '#6366f1');
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
        toast.error(t('detail.renameFailed', { error: errorText(e) }));
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
      toast.error(t('detail.captureFailed', { error: errorText(e) }));
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
      toast.error(t('detail.subtitleFailed', { error: errorText(e) }));
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

  const MediaIcon = video.media_type === 'image' ? ImageIcon : video.media_type === 'audio' ? Music : Film;

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

      {/* AI の新規タグ候補から作るタグ名の確認 */}
      <Dialog
        open={newTagOpen}
        onOpenChange={setNewTagOpen}
        size="sm"
        title={t('detail.newTagTitle')}
        description={t('detail.newTagDesc')}
        showClose={false}
        footer={
          <>
            <Button variant="secondary" onClick={() => setNewTagOpen(false)}>
              {t('detail.newTagCancel')}
            </Button>
            <Button variant="primary" disabled={!newTagName.trim()} onClick={handleCreateNewTag}>
              {t('detail.newTagCreate')}
            </Button>
          </>
        }
      >
        <Input
          size="md"
          className={styles.fullWidth}
          value={newTagName}
          onChange={(e) => setNewTagName(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') handleCreateNewTag(); }}
          aria-label={t('detail.newTagTitle')}
          autoFocus
        />
      </Dialog>

      <div className={styles.root}>
        {/* ヘッダー */}
        <div className={styles.header}>
          <h2 className={styles.title}>{t('detail.title')}</h2>
          <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label={t('detail.close')}>
            <X aria-hidden />
          </Button>
        </div>

        <div className={styles.body}>
          {/* サムネイル + 再生 */}
          <div className={styles.hero}>
            <div
              className={styles.preview}
              data-image={video.media_type === 'image' || undefined}
              onDoubleClick={handlePlay}
            >
              {localThumbnail ? (
                <ThumbImage src={localThumbnail} alt={localTitle} version={thumbCacheBust} />
              ) : (
                <div className={styles.previewEmpty}>
                  <MediaIcon aria-hidden />
                </div>
              )}
              {progressPercent !== null && progressPercent > 0 && (
                <div className={styles.progress}>
                  <div className={styles.progressBar} style={{ width: `${progressPercent}%` }} />
                </div>
              )}
            </div>

            <div className={styles.actions}>
              {isLink ? (
                <Button variant="primary" size="md" className={styles.grow} onClick={() => openUrl(video.path).catch(() => {})}>
                  <ExternalLink aria-hidden />
                  {t('detail.openInBrowser')}
                </Button>
              ) : video.media_type === 'image' ? (
                onViewImage && (
                  <Button variant="primary" size="md" className={styles.grow} onClick={() => onViewImage(video)}>
                    <Maximize2 aria-hidden />
                    {t('detail.viewer')}
                  </Button>
                )
              ) : (
                <Button variant="primary" size="md" className={styles.grow} onClick={handlePlay}>
                  <Play aria-hidden fill="currentColor" />
                  {t('detail.play')}
                </Button>
              )}
              {!isLink && (
                <Button
                  variant="secondary"
                  size="md"
                  onClick={handleRescan}
                  disabled={isRescanning}
                  title={t('detail.rescanTitle')}
                >
                  {isRescanning ? t('detail.rescanning') : t('detail.rescan')}
                </Button>
              )}
              {!isLink && video.media_type !== 'image' && (
                <Button variant="secondary" size="md" onClick={() => setShowTranscode(true)}>
                  {t('detail.av1')}
                </Button>
              )}
            </div>
          </div>

          {/* タイトル・パス・URL */}
          <section className={styles.section}>
            <div className={styles.field}>
              <label className={styles.label} htmlFor="detail-title">{t('detail.titleField')}</label>
              <Input
                id="detail-title"
                size="md"
                variant="ghost"
                className={styles.fullWidth}
                ref={titleRef}
                value={localTitle}
                onChange={(e) => setLocalTitle(e.target.value)}
                onBlur={handleTitleSave}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.currentTarget.blur(); } }}
              />
              <label className={styles.check}>
                <Checkbox checked={renameFile} onCheckedChange={(v) => setRenameFile(v === true)} />
                {t('detail.renameFile')}
              </label>
            </div>

            {!isLink && (
              <div className={styles.field}>
                <div className={styles.labelRow}>
                  <span className={styles.label}>{t('detail.path')}</span>
                  <Button
                    variant="ghost"
                    size="xs"
                    onClick={() => revealItemInDir(video.path).catch((e: unknown) => toast.error(t('detail.revealFailed', { error: errorText(e) })))}
                    title={t('detail.openFinder')}
                  >
                    <FolderOpen aria-hidden />
                    {t('detail.openFinder')}
                  </Button>
                </div>
                <p className={styles.path}>{video.path}</p>
              </div>
            )}

            <div className={styles.field}>
              <label className={styles.label} htmlFor="detail-url">{t('detail.url')}</label>
              <Input
                id="detail-url"
                size="sm"
                variant="ghost"
                className={styles.fullWidth}
                placeholder={t('detail.urlPlaceholder')}
                value={localSourceUrl}
                onChange={(e) => setLocalSourceUrl(e.target.value)}
                onBlur={handleSourceUrlSave}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.currentTarget.blur(); } }}
              />
              {localSourceUrl && (
                <button
                  type="button"
                  className={styles.link}
                  onClick={() => openUrl(localSourceUrl).catch((e: unknown) => toast.error(t('detail.openUrlFailed', { error: errorText(e) })))}
                  title={localSourceUrl}
                >
                  {localSourceUrl}
                </button>
              )}
            </div>
          </section>

          {/* カテゴリ・タグ・評価 */}
          <section className={styles.section}>
            <VideoOrganizerPanel video={video} />
          </section>

          {/* メタデータ */}
          {!isLink && (
            <section className={styles.section}>
              <dl className={styles.meta}>
                <div className={styles.metaWide}>
                  <dt>{t('detail.mediaType')}</dt>
                  <dd>
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
                  </dd>
                </div>
                {video.duration != null && (
                  <div>
                    <dt>{t('detail.duration')}</dt>
                    <dd>{formatTime(video.duration)}</dd>
                  </div>
                )}
                {video.progress > 0 && (
                  <div>
                    <dt>{t('detail.watchProgress')}</dt>
                    <dd>{formatTime(video.progress)}</dd>
                  </div>
                )}
                <div>
                  <dt>{t('detail.fileSize')}</dt>
                  <dd>{fileSizeBytes != null ? formatFileSize(fileSizeBytes) : '—'}</dd>
                </div>
                {dimensions && (
                  <div>
                    <dt>{t('detail.resolution')}</dt>
                    <dd>{dimensions.width} × {dimensions.height}</dd>
                  </div>
                )}
                <div>
                  <dt>{t('detail.createdAt')}</dt>
                  <dd>{new Date(video.created_at).toLocaleDateString()}</dd>
                </div>
                <div>
                  <dt>{t('detail.playCount')}</dt>
                  <dd>{video.watch_count ?? 0}{t('detail.playCountUnit')}</dd>
                </div>
              </dl>
            </section>
          )}

          {/* サムネイルの差し替え */}
          {!isLink && (
            <Section title={t('detail.thumbnail')}>
              <div className={styles.row}>
                <Input
                  size="sm"
                  className={styles.secondsInput}
                  type="number"
                  min={0}
                  step={1}
                  value={thumbTimestamp}
                  onChange={(e) => setThumbTimestamp(e.target.value)}
                  aria-label={t('detail.captureAt')}
                />
                <span className={styles.muted}>{t('detail.captureAt')}</span>
                <Button variant="secondary" size="sm" onClick={handleCaptureThumb} disabled={isCapturingThumb}>
                  {isCapturingThumb ? t('detail.capturing') : t('detail.capture')}
                </Button>
              </div>
            </Section>
          )}

          {/* AI タグ提案 */}
          {aiEnabled && (
            <Section title={t('detail.aiTitle')}>
              <p className={styles.warning}>{t('detail.aiNsfwWarning')}</p>

              {aiModelDownloaded === false && !aiDownloading && (
                <Button variant="primary" size="md" fullWidth onClick={handleDownloadAiModel}>
                  {t('detail.aiEnable', { size: aiModelType === 'joytag' ? '~700 MB' : '~200 MB' })}
                </Button>
              )}

              {aiDownloading && (
                <div className={styles.stackTight}>
                  <div className={styles.meter}>
                    <div className={styles.meterBar} style={{ width: `${Math.round(aiDownloadProgress * 100)}%` }} />
                  </div>
                  <p className={`${styles.muted} ${styles.center}`}>
                    {t('detail.aiDownloading', { percent: Math.round(aiDownloadProgress * 100) })}
                  </p>
                </div>
              )}

              {aiModelDownloaded && !aiDownloading && (
                <>
                  <Button variant="primary" size="sm" onClick={handleAnalyzeTags} disabled={aiAnalyzing || !localThumbnail}>
                    {aiAnalyzing ? t('detail.aiAnalyzing') : t('detail.aiAnalyze')}
                  </Button>
                  {!localThumbnail && <p className={styles.muted}>{t('detail.aiNeedThumbnail')}</p>}
                  {aiError && <p className={styles.error}>{aiError}</p>}

                  {aiResult && aiResult.matched_tags.length > 0 && (
                    <div className={styles.stackTight}>
                      <p className={styles.label}>{t('detail.aiMatched')}</p>
                      {aiResult.matched_tags.map((m) => {
                        const tag = tags.find((tg) => tg.id === m.tag_id);
                        if (!tag) return null;
                        return (
                          <label key={m.tag_id} className={styles.check}>
                            <Checkbox onCheckedChange={(v) => { if (v === true) handleApplyMatchedTag(m.tag_id); }} />
                            <TagBadge tag={tag} showIcon />
                            <span className={styles.score}>{(m.score * 100).toFixed(0)}%</span>
                          </label>
                        );
                      })}
                    </div>
                  )}

                  {aiResult && aiResult.new_suggestions.length > 0 && (
                    <div className={styles.stackTight}>
                      <p className={styles.label}>{t('detail.aiNew')}</p>
                      <div className={styles.wrap}>
                        {aiResult.new_suggestions.map((sug) => (
                          <Button
                            variant="secondary"
                            size="xs"
                            key={sug.name}
                            onClick={() => handleNewSuggestionClick(sug)}
                            title={t('detail.aiScore', { score: (sug.score * 100).toFixed(0) })}
                          >
                            <Plus aria-hidden />
                            {sug.name}
                          </Button>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}
            </Section>
          )}

          {/* 字幕 */}
          {!isLink && (
            <Section
              title={t('detail.subtitle')}
              actions={
                <Button variant="secondary" size="xs" onClick={handleScanSubtitles} disabled={isScanningSubs}>
                  {isScanningSubs ? t('detail.searchingSubtitle') : t('detail.searchSubtitle')}
                </Button>
              }
            >
              {subtitles.length === 0 && !isScanningSubs && <p className={styles.muted}>{t('detail.subtitleHelp')}</p>}
              {subtitles.length > 0 && (
                <ul className={styles.list}>
                  {subtitles.map((sub) => {
                    const loaded = loadedSubtitle === sub.path;
                    return (
                      <li key={sub.path} className={styles.subRow}>
                        <span className={styles.ellipsis}>{sub.name}</span>
                        <span className={styles.ext}>{sub.ext}</span>
                        <Button variant={loaded ? 'soft' : 'primary'} size="xs" onClick={() => handleLoadSubtitle(sub.path)}>
                          {loaded && <Check aria-hidden />}
                          {loaded ? t('detail.subtitleLoaded') : t('detail.subtitleLoad')}
                        </Button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </Section>
          )}

          {/* 類似動画 */}
          {!isLink && (
            <Section
              title={t('detail.similarVideos')}
              actions={
                <div className={styles.row}>
                  <span className={styles.muted}>{t('detail.similarSensitivity')}</span>
                  <SegmentedControl
                    size="xs"
                    aria-label={t('detail.similarSensitivity')}
                    value={String(similarThreshold)}
                    onValueChange={(v) => handleSimilarThresholdChange(Number(v) as SimilarThreshold)}
                    options={([4, 8, 12] as SimilarThreshold[]).map((th) => ({
                      value: String(th),
                      label:
                        th === 4
                          ? t('detail.similarSensHigh')
                          : th === 8
                          ? t('detail.similarSensNormal')
                          : t('detail.similarSensLow'),
                    }))}
                  />
                </div>
              }
            >
              {!similarDetected && !similarLoading ? (
                <div className={styles.placeholder}>
                  <p className={styles.muted}>{t('detail.similarNotRun')}</p>
                  <Button variant="primary" size="sm" onClick={() => detectSimilar()}>
                    {t('detail.similarDetect')}
                  </Button>
                </div>
              ) : similarLoading ? (
                <div className={styles.placeholder}>
                  <LoaderCircle className={styles.spinner} aria-hidden />
                  <p className={styles.muted}>
                    {similarHashProgress
                      ? t('detail.similarComputing', { done: similarHashProgress.done, total: similarHashProgress.total })
                      : '…'}
                  </p>
                  {similarHashProgress && (
                    <div className={`${styles.meter} ${styles.meterNarrow}`}>
                      <div
                        className={styles.meterBar}
                        style={{ width: `${(similarHashProgress.done / similarHashProgress.total) * 100}%` }}
                      />
                    </div>
                  )}
                </div>
              ) : similarVideos.length === 0 ? (
                <div className={styles.placeholder}>
                  <p className={styles.muted}>{t('detail.similarEmpty')}</p>
                  <Button variant="secondary" size="sm" onClick={() => detectSimilar()}>
                    {t('detail.similarRedetect')}
                  </Button>
                </div>
              ) : (
                <div className={styles.list}>
                  {similarVideos.map((sim) => {
                    const pct = currentPhash ? similarityPct(sim.phash, currentPhash) : null;
                    return (
                      <button key={sim.id} type="button" className={styles.similar} onClick={() => handleOpenSimilar(sim)}>
                        <span className={styles.similarThumb}>
                          {sim.thumbnail ? <ThumbImage src={sim.thumbnail} alt="" /> : <Film aria-hidden />}
                        </span>
                        <span className={styles.similarText}>
                          <span className={styles.ellipsis}>{sim.title ?? sim.path.split('/').pop()}</span>
                          {sim.duration != null && <span className={styles.subtle}>{formatTime(sim.duration)}</span>}
                        </span>
                        {pct !== null && (
                          <span className={styles.pct} data-level={pct >= 95 ? 'high' : pct >= 88 ? 'mid' : undefined}>
                            {t('detail.similarPct', { pct })}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </Section>
          )}
        </div>
      </div>
    </>
  );
}
