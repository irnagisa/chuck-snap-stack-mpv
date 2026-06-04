import { useState, useEffect, useRef, useMemo } from 'react';
import { convertFileSrc, invoke } from '@tauri-apps/api/core';
import { useTagStore } from '../../store/useTagStore';
import { useLibraryStore } from '../../store/useLibraryStore';
import { usePlayerStore } from '../../store/usePlayerStore';
import { TagBadge } from './TagBadge';
import { TranscodeModal } from './TranscodeModal';
import { Select } from '../common/Select';
import type { Video, Tag, SubtitleFile } from '../../types';

const COLORS = [
  '#ef4444', '#f97316', '#eab308', '#22c55e',
  '#06b6d4', '#3b82f6', '#8b5cf6', '#ec4899', '#6b7280',
];

interface Props {
  video: Video;
  onClose: () => void;
}

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

function findWatchDir(filePath: string, watchDirs: string[]): string | null {
  const normalized = filePath.replace(/\\/g, '/');
  for (const dir of watchDirs) {
    const d = dir.replace(/\\/g, '/').replace(/\/$/, '');
    if (normalized.startsWith(d + '/')) return d;
  }
  return null;
}

export function VideoDetailModal({ video, onClose }: Props) {
  const { tags, categories, videoTags, addTagToVideo, removeTagFromVideo, setVideoCategory, fetchVideoTags, createTag } =
    useTagStore();
  const { db, fetchVideos, updateVideo, watchDirs, moveVideoFile } = useLibraryStore();
  const { play } = usePlayerStore();

  const [localTitle, setLocalTitle] = useState(video.title ?? video.path.split('/').pop() ?? '');
  const [localRating, setLocalRating] = useState(video.rating ?? 0);
  const [fileSizeBytes, setFileSizeBytes] = useState<number | null>(null);
  const [dimensions, setDimensions] = useState<{ width: number; height: number } | null>(null);
  const [categoryId, setCategoryId] = useState<string>(video.category_id?.toString() ?? '');
  const [moveFile, setMoveFile] = useState(true);
  const [renameFile, setRenameFile] = useState(false);
  const [tagInput, setTagInput] = useState('');
  const [newTagColor, setNewTagColor] = useState(COLORS[5]);
  const [showTranscode, setShowTranscode] = useState(false);
  const [tagInputFocused, setTagInputFocused] = useState(false);
  const [thumbTimestamp, setThumbTimestamp] = useState('5');
  const [isCapturingThumb, setIsCapturingThumb] = useState(false);
  const [subtitles, setSubtitles] = useState<SubtitleFile[]>([]);
  const [isScanningSubs, setIsScanningSubs] = useState(false);
  const [loadedSubtitle, setLoadedSubtitle] = useState<string | null>(null);
  const titleRef = useRef<HTMLInputElement>(null);

  const currentTags = videoTags[video.id] ?? [];

  useEffect(() => {
    if (db) fetchVideoTags(db, video.id);
  }, [db, video.id]);

  useEffect(() => {
    invoke<number>('get_file_size', { path: video.path })
      .then(setFileSizeBytes)
      .catch(() => {});
    invoke<{ width: number; height: number }>('get_video_dimensions', { path: video.path })
      .then(setDimensions)
      .catch(() => {});
  }, [video.path]);

  const progressPercent =
    video.duration && video.duration > 0
      ? Math.min((video.progress / video.duration) * 100, 100)
      : null;

  const tagUsageCounts = useMemo(() => {
    const counts: Record<number, number> = {};
    for (const vtags of Object.values(videoTags)) {
      for (const t of vtags) {
        counts[t.id] = (counts[t.id] ?? 0) + 1;
      }
    }
    return counts;
  }, [videoTags]);

  const filteredSuggestions = useMemo(() => {
    const unassigned = tags.filter((t) => !currentTags.some((ct) => ct.id === t.id));
    const filtered = tagInput
      ? unassigned.filter((t) => t.name.toLowerCase().includes(tagInput.toLowerCase()))
      : unassigned;
    return filtered.sort((a, b) => (tagUsageCounts[b.id] ?? 0) - (tagUsageCounts[a.id] ?? 0));
  }, [tags, currentTags, tagInput, tagUsageCounts]);

  const exactMatch = tags.some((t) => t.name.toLowerCase() === tagInput.toLowerCase());
  const showSuggestions = tagInputFocused || tagInput.length > 0;

  const handleTitleSave = async () => {
    const trimmed = localTitle.trim();
    if (!trimmed || trimmed === (video.title ?? video.path.split('/').pop())) return;

    if (renameFile) {
      const ext = video.path.includes('.') ? '.' + video.path.split('.').pop() : '';
      const newFilename = trimmed + ext;
      try {
        const newPath = await invoke<string>('rename_video_file', {
          oldPath: video.path,
          newName: newFilename,
        });
        await updateVideo(video.id, { title: trimmed, path: newPath });
      } catch (e) {
        alert(`ファイルのリネームに失敗しました: ${e}`);
      }
    } else {
      await updateVideo(video.id, { title: trimmed });
    }
  };

  const handleRatingClick = async (star: number) => {
    const next = star === localRating ? 0 : star;
    setLocalRating(next);
    await updateVideo(video.id, { rating: next });
  };

  const handleAddTag = async (tag: Tag) => {
    if (!db) return;
    await addTagToVideo(db, video.id, tag.id);
    setTagInput('');
  };

  const handleCreateAndAdd = async () => {
    if (!db || !tagInput.trim()) return;
    const tag = await createTag(db, tagInput.trim(), newTagColor);
    await addTagToVideo(db, video.id, tag.id);
    setTagInput('');
  };

  const handleRemoveTag = async (tagId: number) => {
    if (!db) return;
    await removeTagFromVideo(db, video.id, tagId);
  };

  const handleCategoryChange = async (value: string) => {
    if (!db) return;
    setCategoryId(value);
    const catId = value ? Number(value) : null;
    await setVideoCategory(db, video.id, catId);

    if (moveFile) {
      const watchDir = findWatchDir(video.path, watchDirs);
      if (watchDir) {
        const catName = catId !== null ? categories.find((c) => c.id === catId)?.name : null;
        const destDir = catName ? `${watchDir}/${catName}` : watchDir;
        await moveVideoFile(video.id, destDir);
      }
    }

    await fetchVideos();
  };

  const handlePlay = () => {
    play(video);
    onClose();
  };

  const handleCaptureThumb = async () => {
    if (!db) return;
    const ts = parseFloat(thumbTimestamp);
    if (isNaN(ts) || ts < 0) return;
    setIsCapturingThumb(true);
    try {
      await invoke('capture_frame_at', {
        videoPath: video.path,
        timestamp: ts,
        outputPath: video.thumbnail ?? '',
      });
      await db.execute('UPDATE videos SET thumbnail = ? WHERE id = ?', [video.thumbnail, video.id]);
      await fetchVideos();
    } catch (e) {
      console.error('Capture failed:', e);
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
      console.error('Subtitle load failed:', e);
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
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={onClose}
    >
      <div
        className="bg-white dark:bg-gray-900 rounded-xl shadow-xl w-full max-w-3xl mx-4 max-h-[90vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-200 dark:border-gray-700 shrink-0">
          <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">動画詳細</h2>
          <button
            type="button"
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 text-lg leading-none"
            onClick={onClose}
          >
            ✕
          </button>
        </div>

        {/* Body */}
        <div className="flex gap-6 px-6 py-5 overflow-y-auto">
          {/* Left: thumbnail + play */}
          <div className="flex flex-col gap-2.5 shrink-0 w-44">
            <div className="relative aspect-video bg-gray-200 dark:bg-gray-700 rounded-lg overflow-hidden">
              {video.thumbnail ? (
                <img
                  src={convertFileSrc(video.thumbnail)}
                  alt={localTitle}
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-gray-400 dark:text-gray-500 text-3xl">
                  ▶
                </div>
              )}
            </div>
            {progressPercent !== null && progressPercent > 0 && (
              <div className="h-1 bg-gray-200 dark:bg-gray-700 rounded-full">
                <div className="h-full bg-blue-500 rounded-full" style={{ width: `${progressPercent}%` }} />
              </div>
            )}
            <button
              type="button"
              className="w-full py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm rounded-lg font-medium"
              onClick={handlePlay}
            >
              ▶ 再生
            </button>
            <button
              type="button"
              className="w-full py-1.5 bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 text-xs rounded-lg font-medium"
              onClick={() => setShowTranscode(true)}
            >
              AV1 変換
            </button>
          </div>

          {/* Right: info */}
          <div className="flex-1 min-w-0 flex flex-col divide-y divide-gray-100 dark:divide-gray-800">
            {/* タイトル + パス */}
            <div className="pb-4 flex flex-col gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-400 dark:text-gray-500 mb-1.5">
                  タイトル
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
                  <span className="text-xs text-gray-400 dark:text-gray-500">ファイル名も変更する</span>
                </label>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-400 dark:text-gray-500 mb-1">
                  パス
                </label>
                <p className="text-xs text-gray-500 dark:text-gray-400 break-all leading-relaxed">{video.path}</p>
              </div>
            </div>

            {/* メタデータ + 評価 */}
            <div className="py-4 flex flex-col gap-3">
              <div className="flex gap-6 flex-wrap">
                {video.duration != null && (
                  <div>
                    <label className="block text-xs font-medium text-gray-400 dark:text-gray-500 mb-1">
                      再生時間
                    </label>
                    <p className="text-sm text-gray-800 dark:text-gray-200">{formatDuration(video.duration)}</p>
                  </div>
                )}
                {video.progress > 0 && (
                  <div>
                    <label className="block text-xs font-medium text-gray-400 dark:text-gray-500 mb-1">
                      視聴位置
                    </label>
                    <p className="text-sm text-gray-800 dark:text-gray-200">{formatDuration(video.progress)}</p>
                  </div>
                )}
                <div>
                  <label className="block text-xs font-medium text-gray-400 dark:text-gray-500 mb-1">
                    ファイルサイズ
                  </label>
                  <p className="text-sm text-gray-800 dark:text-gray-200">
                    {fileSizeBytes != null ? formatFileSize(fileSizeBytes) : '—'}
                  </p>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-400 dark:text-gray-500 mb-1">
                    解像度
                  </label>
                  <p className="text-sm text-gray-800 dark:text-gray-200">
                    {dimensions ? `${dimensions.width} × ${dimensions.height}` : '—'}
                  </p>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-400 dark:text-gray-500 mb-1">
                    追加日時
                  </label>
                  <p className="text-sm text-gray-800 dark:text-gray-200">
                    {new Date(video.created_at).toLocaleDateString('ja-JP')}
                  </p>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-400 dark:text-gray-500 mb-1">
                    再生回数
                  </label>
                  <p className="text-sm text-gray-800 dark:text-gray-200">
                    {(video.watch_count ?? 0)}回
                  </p>
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-400 dark:text-gray-500 mb-1.5">
                  評価
                </label>
                <div className="flex gap-1">
                  {[1, 2, 3, 4, 5].map((star) => (
                    <button
                      key={star}
                      type="button"
                      className={`text-xl leading-none transition-colors ${
                        star <= localRating
                          ? 'text-yellow-400'
                          : 'text-gray-300 dark:text-gray-600 hover:text-yellow-300'
                      }`}
                      onClick={() => handleRatingClick(star)}
                    >
                      ★
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* カテゴリ + タグ */}
            <div className="pt-4 flex flex-col gap-4">
              <div>
                <label className="block text-xs font-medium text-gray-400 dark:text-gray-500 mb-1.5">
                  カテゴリ
                </label>
                <Select
                  fullWidth
                  value={categoryId}
                  onChange={(e) => handleCategoryChange(e.target.value)}
                >
                  <option value="">なし</option>
                  {categories.map((cat) => (
                    <option key={cat.id} value={cat.id}>
                      {cat.name}
                    </option>
                  ))}
                </Select>
                <label className="flex items-center gap-1.5 mt-1.5 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={moveFile}
                    onChange={(e) => setMoveFile(e.target.checked)}
                    className="accent-blue-600"
                  />
                  <span className="text-xs text-gray-500 dark:text-gray-400">ファイルも移動</span>
                </label>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-400 dark:text-gray-500 mb-1.5">
                  タグ
                </label>
                <div className="flex flex-wrap gap-1.5 mb-2.5 min-h-6">
                  {currentTags.length > 0 ? (
                    currentTags.map((tag) => (
                      <TagBadge key={tag.id} tag={tag} onRemove={() => handleRemoveTag(tag.id)} />
                    ))
                  ) : (
                    <span className="text-xs text-gray-400 dark:text-gray-500">タグなし</span>
                  )}
                </div>
                <div className="relative">
                <input
                  className="w-full px-3 py-1.5 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400"
                  placeholder="タグを検索 / 新規作成..."
                  value={tagInput}
                  onChange={(e) => setTagInput(e.target.value)}
                  onFocus={() => setTagInputFocused(true)}
                  onBlur={() => setTimeout(() => setTagInputFocused(false), 150)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && tagInput && !exactMatch) handleCreateAndAdd();
                    if (e.key === 'Escape') { setTagInput(''); setTagInputFocused(false); }
                  }}
                />
                {showSuggestions && (
                  <div className="absolute z-10 mt-1 w-full bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded shadow-lg max-h-48 overflow-y-auto">
                    {filteredSuggestions.length === 0 && !tagInput && (
                      <p className="px-3 py-2 text-xs text-gray-400 dark:text-gray-500">タグがありません</p>
                    )}
                    {filteredSuggestions.map((tag) => (
                      <button
                        key={tag.id}
                        type="button"
                        className="w-full text-left px-3 py-1.5 text-sm hover:bg-gray-50 dark:hover:bg-gray-700 flex items-center gap-2"
                        onClick={() => handleAddTag(tag)}
                      >
                        <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: tag.color }} />
                        <span className="flex-1">{tag.name}</span>
                        {(tagUsageCounts[tag.id] ?? 0) > 0 && (
                          <span className="text-xs text-gray-400 dark:text-gray-500 shrink-0">
                            {tagUsageCounts[tag.id]}件
                          </span>
                        )}
                      </button>
                    ))}
                    {tagInput && !exactMatch && (
                      <div className="px-3 py-2 border-t border-gray-100 dark:border-gray-700">
                        <div className="flex items-center gap-1.5 mb-1.5">
                          <span className="text-xs text-gray-500 dark:text-gray-400">色:</span>
                          {COLORS.map((c) => (
                            <button
                              key={c}
                              type="button"
                              className={`w-4 h-4 rounded-full transition-transform ${
                                newTagColor === c
                                  ? 'scale-125 ring-2 ring-offset-1 ring-gray-400 dark:ring-offset-gray-800'
                                  : ''
                              }`}
                              style={{ backgroundColor: c }}
                              onClick={() => setNewTagColor(c)}
                            />
                          ))}
                        </div>
                        <button
                          type="button"
                          className="w-full text-left text-sm text-blue-600 dark:text-blue-400 hover:underline"
                          onClick={handleCreateAndAdd}
                        >
                          「{tagInput}」を新規作成して追加
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>

            {/* カスタムサムネイル */}
            <div className="pt-4 flex flex-col gap-2">
              <label className="block text-xs font-medium text-gray-400 dark:text-gray-500">
                サムネイルを変更
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={0}
                  step={1}
                  className="w-24 px-2 py-1 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
                  value={thumbTimestamp}
                  onChange={(e) => setThumbTimestamp(e.target.value)}
                  placeholder="秒"
                />
                <span className="text-xs text-gray-500 dark:text-gray-400">秒のフレームを設定</span>
                <button
                  type="button"
                  onClick={handleCaptureThumb}
                  disabled={isCapturingThumb || !video.thumbnail}
                  className="px-3 py-1 bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 text-xs rounded disabled:opacity-50"
                >
                  {isCapturingThumb ? '処理中...' : 'キャプチャ'}
                </button>
              </div>
            </div>

            {/* 字幕ファイル管理 */}
            <div className="pt-4 flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <label className="text-xs font-medium text-gray-400 dark:text-gray-500">
                  字幕ファイル
                </label>
                <button
                  type="button"
                  onClick={handleScanSubtitles}
                  disabled={isScanningSubs}
                  className="px-2 py-0.5 bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 text-xs rounded disabled:opacity-50"
                >
                  {isScanningSubs ? '検索中...' : '検索'}
                </button>
              </div>
              {subtitles.length === 0 && !isScanningSubs && (
                <p className="text-xs text-gray-400 dark:text-gray-500">
                  「検索」で同フォルダの字幕ファイルを探します
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
                        {loadedSubtitle === sub.path ? 'ロード済' : 'ロード'}
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
    </>
  );
}
