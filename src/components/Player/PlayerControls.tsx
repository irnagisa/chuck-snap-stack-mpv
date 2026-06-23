import { useEffect, useRef, useState } from 'react';
import { useTranslation } from "react-i18next";
import { useShallow } from 'zustand/shallow';
import { usePlayerStore } from '../../store/usePlayerStore';
import { useModalStore } from '../../store/useModalStore';
import { useSettingsStore } from '../../store/useSettingsStore';
import { invoke } from '@tauri-apps/api/core';
import { formatTime } from '../../utils/time';

const SPEED_OPTIONS = [0.25, 0.5, 0.75, 1.0, 1.25, 1.5, 1.75, 2.0];

function PlayerSeekBar() {
  const playbackTime = usePlayerStore((s) => s.playbackTime);
  const duration = usePlayerStore((s) => s.duration);
  const chapters = usePlayerStore((s) => s.chapters);
  const abLoopA = usePlayerStore((s) => s.abLoopA);
  const abLoopB = usePlayerStore((s) => s.abLoopB);
  const seekTo = usePlayerStore((s) => s.seekTo);

  const isDragging = useRef(false);
  const [localSeek, setLocalSeek] = useState(0);

  useEffect(() => {
    if (!isDragging.current) {
      setLocalSeek(playbackTime);
    }
  }, [playbackTime]);

  const handleSeekChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setLocalSeek(Number(e.target.value));
  };

  const handleSeekStart = () => {
    isDragging.current = true;
  };

  const handleSeekEnd = (e: React.MouseEvent<HTMLInputElement> | React.TouchEvent<HTMLInputElement>) => {
    isDragging.current = false;
    seekTo(Number((e.target as HTMLInputElement).value));
  };

  const pct = (t: number) => duration > 0 ? `${(t / duration) * 100}%` : '0%';

  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-gray-400 w-10 text-right shrink-0 tabular-nums">
        {formatTime(localSeek)}
      </span>
      <div className="flex-1 relative">
        <input
          type="range"
          className="w-full h-1.5 accent-blue-500 cursor-pointer"
          min={0}
          max={duration > 0 ? duration : 100}
          step={0.5}
          value={localSeek}
          onChange={handleSeekChange}
          onMouseDown={handleSeekStart}
          onMouseUp={handleSeekEnd}
          onTouchStart={handleSeekStart}
          onTouchEnd={handleSeekEnd}
        />
        {/* チャプターマーカー */}
        {duration > 0 && chapters.map((ch, i) => (
          <div
            key={i}
            className="absolute top-0 bottom-0 w-0.5 bg-yellow-400 opacity-70 pointer-events-none"
            style={{ left: pct(ch.startTime) }}
            title={ch.title || `チャプター ${i + 1}`}
          />
        ))}
        {/* A-B ループマーカー */}
        {duration > 0 && abLoopA !== null && (
          <div
            className="absolute -top-1 w-0 h-0 pointer-events-none"
            style={{ left: pct(abLoopA) }}
            title={`A点: ${formatTime(abLoopA)}`}
          >
            <div className="w-2 h-2 bg-blue-400 rounded-full -translate-x-1/2" />
          </div>
        )}
        {duration > 0 && abLoopB !== null && (
          <div
            className="absolute -top-1 w-0 h-0 pointer-events-none"
            style={{ left: pct(abLoopB) }}
            title={`B点: ${formatTime(abLoopB)}`}
          >
            <div className="w-2 h-2 bg-red-400 rounded-full -translate-x-1/2" />
          </div>
        )}
      </div>
      <span className="text-xs text-gray-400 w-10 shrink-0 tabular-nums">
        {duration > 0 ? formatTime(duration) : '--:--'}
      </span>
    </div>
  );
}

export function PlayerControls() {
  const { t } = useTranslation();
  const {
    currentVideo, queue, queueIndex, isPaused, isLooping, isShuffle, isMiniPlayer,
    speed, abLoopA, abLoopB,
    quit, playNext, playPrev, pauseResume, toggleLoop, toggleShuffle, toggleMiniPlayer,
    setSpeed, setAbLoopA, clearAbLoop,
  } = usePlayerStore(useShallow((s) => ({
    currentVideo: s.currentVideo,
    queue: s.queue,
    queueIndex: s.queueIndex,
    isPaused: s.isPaused,
    isLooping: s.isLooping,
    isShuffle: s.isShuffle,
    isMiniPlayer: s.isMiniPlayer,
    speed: s.speed,
    abLoopA: s.abLoopA,
    abLoopB: s.abLoopB,
    quit: s.quit,
    playNext: s.playNext,
    playPrev: s.playPrev,
    pauseResume: s.pauseResume,
    toggleLoop: s.toggleLoop,
    toggleShuffle: s.toggleShuffle,
    toggleMiniPlayer: s.toggleMiniPlayer,
    setSpeed: s.setSpeed,
    setAbLoopA: s.setAbLoopA,
    clearAbLoop: s.clearAbLoop,
  })));

  const { showQueuePanel, toggleQueuePanel } = useModalStore(useShallow((s) => ({
    showQueuePanel: s.showQueuePanel,
    toggleQueuePanel: s.toggleQueuePanel,
  })));

  const screenshotDir = useSettingsStore((s) => s.screenshotDir);

  const hasPrev = queue.length > 0 && queueIndex > 0;
  const hasNext = queue.length > 0 && queueIndex < queue.length - 1;

  const abActive = abLoopA !== null;
  const abComplete = abLoopA !== null && abLoopB !== null;

  const handleScreenshot = async () => {
    try {
      const dir = screenshotDir || (await import('@tauri-apps/api/path').then((m) => m.downloadDir()));
      const ts = Date.now();
      const outPath = `${dir}/screenshot-${ts}.jpg`;
      await invoke('take_screenshot', { outputPath: outPath });
    } catch (e) {
      console.error('Screenshot failed:', e);
    }
  };

  // ミニプレイヤーモード中はフッターを非表示
  if (isMiniPlayer) return null;

  if (!currentVideo) {
    return (
      <div className="fixed bottom-0 left-0 right-0 bg-gray-900 text-white px-4 py-2 shadow-lg border-t border-gray-700 flex items-center gap-2">
        <span className="text-xs text-gray-500 shrink-0">{t('player.playbackSettings')}</span>
        <div className="w-px h-4 bg-gray-700 shrink-0" />
        <button
          type="button"
          onClick={toggleShuffle}
          className={`px-2.5 py-1 rounded text-sm shrink-0 ${isShuffle ? 'bg-blue-600 hover:bg-blue-500 text-white' : 'bg-gray-700 hover:bg-gray-600 text-gray-300'}`}
          title={isShuffle ? t('player.shuffleOff') : t('player.shuffleOn')}
        >
          {t('player.shuffleLabel')}
        </button>
        <button
          type="button"
          onClick={toggleLoop}
          className={`px-2.5 py-1 rounded text-sm shrink-0 ${isLooping ? 'bg-blue-600 hover:bg-blue-500 text-white' : 'bg-gray-700 hover:bg-gray-600 text-gray-300'}`}
          title={isLooping ? t('player.loopOff') : t('player.loopOn')}
        >
          {t('player.loopLabel')}
        </button>
      </div>
    );
  }

  return (
    <div className="fixed bottom-0 left-0 right-0 bg-gray-900 text-white px-4 pt-2 pb-3 shadow-lg border-t border-gray-700 flex flex-col gap-2">
      <PlayerSeekBar />

      <div className="flex items-center gap-1.5 flex-wrap">
        {queue.length > 0 && (
          <span className="text-xs text-gray-400 shrink-0 tabular-nums">
            {t('player.queuePosition', { current: queueIndex + 1, total: queue.length })}
          </span>
        )}
        <span className="flex-1 text-sm truncate text-gray-300 min-w-0">
          {currentVideo.title ?? currentVideo.path.split('/').pop()}
        </span>

        {/* A-B ループ */}
        <button
          type="button"
          onClick={setAbLoopA}
          className={`px-2 py-1 rounded text-xs shrink-0 ${abActive ? 'bg-blue-600 text-white' : 'bg-gray-700 hover:bg-gray-600 text-gray-300'}`}
          title={abActive ? (abComplete ? t('player.abLooping') : t('player.abSetB')) : t('player.abSetA')}
        >
          {abComplete ? 'AB' : abActive ? 'A→B?' : 'A-B'}
        </button>
        {abActive && (
          <button
            type="button"
            onClick={clearAbLoop}
            className="px-2 py-1 bg-gray-700 hover:bg-gray-600 rounded text-xs shrink-0 text-gray-400"
            title={t('player.abClear')}
          >
            ✕AB
          </button>
        )}

        {/* 速度セレクタ */}
        <select
          value={speed}
          onChange={(e) => setSpeed(Number(e.target.value))}
          className="bg-gray-700 text-gray-200 text-xs rounded px-1 py-1 shrink-0 cursor-pointer"
          title={t('player.speed')}
        >
          {SPEED_OPTIONS.map((s) => (
            <option key={s} value={s}>{s === 1.0 ? '1x' : `${s}x`}</option>
          ))}
        </select>

        {/* 前/再生/次 */}
        {queue.length > 0 && (
          <button
            type="button"
            onClick={playPrev}
            disabled={!hasPrev}
            className="px-2.5 py-1 bg-gray-700 hover:bg-gray-600 disabled:opacity-30 disabled:cursor-not-allowed rounded text-sm shrink-0"
            title={t('player.prevVideo')}
          >
            ⏮
          </button>
        )}
        <button
          type="button"
          onClick={pauseResume}
          className="px-3 py-1 bg-gray-700 hover:bg-gray-600 rounded text-sm shrink-0 w-12 text-center"
          title={isPaused ? t('player.playTooltip') : t('player.pauseTooltip')}
        >
          {isPaused ? '▶' : '⏸'}
        </button>
        {queue.length > 0 && (
          <button
            type="button"
            onClick={playNext}
            disabled={!hasNext}
            className="px-2.5 py-1 bg-gray-700 hover:bg-gray-600 disabled:opacity-30 disabled:cursor-not-allowed rounded text-sm shrink-0"
            title={t('player.nextVideo')}
          >
            ⏭
          </button>
        )}

        {/* シャッフル・ループ */}
        {queue.length > 1 && (
          <button
            type="button"
            onClick={toggleShuffle}
            className={`px-2.5 py-1 rounded text-sm shrink-0 ${isShuffle ? 'bg-blue-600 hover:bg-blue-500 text-white' : 'bg-gray-700 hover:bg-gray-600 text-gray-300'}`}
            title={isShuffle ? t('player.shuffleOff') : t('player.shuffleOn')}
          >
            ⇄
          </button>
        )}
        <button
          type="button"
          onClick={toggleLoop}
          className={`px-2.5 py-1 rounded text-sm shrink-0 ${isLooping ? 'bg-blue-600 hover:bg-blue-500 text-white' : 'bg-gray-700 hover:bg-gray-600 text-gray-300'}`}
          title={isLooping ? t('player.loopOff') : t('player.loopOn')}
        >
          ↻
        </button>

        {/* スクリーンショット */}
        <button
          type="button"
          onClick={handleScreenshot}
          className="px-2.5 py-1 bg-gray-700 hover:bg-gray-600 rounded text-sm shrink-0 text-gray-300"
          title={t('player.screenshot')}
        >
          📷
        </button>

        {/* キューパネルトグル */}
        {queue.length > 0 && (
          <button
            type="button"
            onClick={toggleQueuePanel}
            className={`px-2.5 py-1 rounded text-sm shrink-0 ${showQueuePanel ? 'bg-blue-600 hover:bg-blue-500 text-white' : 'bg-gray-700 hover:bg-gray-600 text-gray-300'}`}
            title={t('player.showQueue')}
          >
            ≡
          </button>
        )}

        <button
          type="button"
          onClick={toggleMiniPlayer}
          className="px-2.5 py-1 bg-gray-700 hover:bg-gray-600 rounded text-sm shrink-0 text-gray-300"
          title={t('player.miniPlayer')}
        >
          ⇱
        </button>
        <button
          type="button"
          onClick={quit}
          className="px-3 py-1 bg-red-600 hover:bg-red-500 rounded text-sm shrink-0"
          title={t('player.exit')}
        >
          {t('player.exit')}
        </button>
      </div>
    </div>
  );
}
