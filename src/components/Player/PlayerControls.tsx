import { useEffect, useRef, useState } from 'react';
import { useTranslation } from "react-i18next";
import { useShallow } from 'zustand/shallow';
import { usePlayerStore } from '../../store/usePlayerStore';
import { useModalStore } from '../../store/useModalStore';
import { useSettingsStore } from '../../store/useSettingsStore';
import { invoke } from '@tauri-apps/api/core';
import { formatTime } from '../../utils/time';
import { Select, Button, Slider } from '../ui';
import { Camera, ListVideo, Pause, PictureInPicture2, Play, Repeat, Shuffle, SkipBack, SkipForward, Square, X } from "lucide-react";

const SPEED_OPTIONS = [0.25, 0.5, 0.75, 1.0, 1.25, 1.5, 1.75, 2.0];

function PlayerSeekBar() {
  const playbackTime = usePlayerStore((s) => s.playbackTime);
  const duration = usePlayerStore((s) => s.duration);
  const chapters = usePlayerStore((s) => s.chapters);
  const abLoopA = usePlayerStore((s) => s.abLoopA);
  const abLoopB = usePlayerStore((s) => s.abLoopB);
  const seekTo = usePlayerStore((s) => s.seekTo);

  const { t } = useTranslation();
  const isDragging = useRef(false);
  const [localSeek, setLocalSeek] = useState(0);

  useEffect(() => {
    if (!isDragging.current) {
      setLocalSeek(playbackTime);
    }
  }, [playbackTime]);

  // ドラッグ中は表示だけ更新し、離したときにシークする
  const handleSeekChange = ([v]: number[]) => {
    isDragging.current = true;
    setLocalSeek(v);
  };

  const handleSeekCommit = ([v]: number[]) => {
    isDragging.current = false;
    seekTo(v);
  };

  const pct = (t: number) => duration > 0 ? `${(t / duration) * 100}%` : '0%';

  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-gray-400 w-10 text-right shrink-0 tabular-nums">
        {formatTime(localSeek)}
      </span>
      <div className="flex-1 relative">
        <Slider
          min={0}
          max={duration > 0 ? duration : 100}
          step={0.5}
          value={[localSeek]}
          onValueChange={handleSeekChange}
          onValueCommit={handleSeekCommit}
          thumbLabel={t('player.seek')}
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

  // 再生バーは常に暗い面なので、配下のボタン等はダーク配色で描画する (scheme-dark)
  const barClass =
    "scheme-dark fixed bottom-3 left-3 right-3 rounded-2xl bg-gray-900/95 backdrop-blur-md text-white shadow-xl ring-1 ring-white/10";

  if (!currentVideo) {
    return (
      <div className={`${barClass} px-4 py-2 flex items-center gap-2`}>
        <span className="text-xs text-gray-500 shrink-0">{t('player.playbackSettings')}</span>
        <div className="w-px h-4 bg-gray-700 shrink-0" />
        <Button
          variant="ghost"
          onClick={toggleShuffle}
          title={isShuffle ? t('player.shuffleOff') : t('player.shuffleOn')}
          aria-pressed={isShuffle}
        >
          <Shuffle aria-hidden />
          {t('player.shuffleLabel')}
        </Button>
        <Button
          variant="ghost"
          onClick={toggleLoop}
          title={isLooping ? t('player.loopOff') : t('player.loopOn')}
          aria-label={isLooping ? t('player.loopOff') : t('player.loopOn')}
          aria-pressed={isLooping}
        >
          <Repeat aria-hidden />
          {t('player.loopLabel')}
        </Button>
      </div>
    );
  }

  return (
    <div className={`${barClass} px-4 pt-2.5 pb-3 flex flex-col gap-2`}>
      <PlayerSeekBar />

      <div className="flex items-center gap-1 flex-wrap">
        {queue.length > 0 && (
          <span className="text-xs text-gray-400 shrink-0 tabular-nums">
            {t('player.queuePosition', { current: queueIndex + 1, total: queue.length })}
          </span>
        )}
        <span className="flex-1 text-sm truncate text-gray-300 min-w-0">
          {currentVideo.title ?? currentVideo.path.split('/').pop()}
        </span>

        {/* A-B ループ */}
        <Button
          variant="ghost"
          size="xs"
          onClick={setAbLoopA}
          aria-pressed={abActive}
          title={abActive ? (abComplete ? t('player.abLooping') : t('player.abSetB')) : t('player.abSetA')}
        >
          {abComplete ? 'AB' : abActive ? 'A→B?' : 'A-B'}
        </Button>
        {abActive && (
          <Button variant="ghost" size="xs" onClick={clearAbLoop} title={t('player.abClear')}>
            <X aria-hidden />
            AB
          </Button>
        )}

        {/* 速度セレクタ */}
        <Select
          value={String(speed)}
          onValueChange={(v) => setSpeed(Number(v))}
          title={t('player.speed')}
          className="shrink-0"
          options={SPEED_OPTIONS.map((s) => ({ value: String(s), label: s === 1.0 ? '1x' : `${s}x` }))}
        />

        {/* 前/再生/次 */}
        {queue.length > 0 && (
          <Button
            variant="ghost"
            size="icon"
            onClick={playPrev}
            disabled={!hasPrev}
            title={t('player.prevVideo')}
            aria-label={t('player.prevVideo')}
          >
            <SkipBack aria-hidden fill="currentColor" />
          </Button>
        )}
        <Button
          variant="primary"
          size="icon"
          onClick={pauseResume}
          title={isPaused ? t('player.playTooltip') : t('player.pauseTooltip')}
          aria-label={isPaused ? t('player.playTooltip') : t('player.pauseTooltip')}
        >
          {isPaused ? <Play aria-hidden fill="currentColor" /> : <Pause aria-hidden fill="currentColor" />}
        </Button>
        {queue.length > 0 && (
          <Button
            variant="ghost"
            size="icon"
            onClick={playNext}
            disabled={!hasNext}
            title={t('player.nextVideo')}
            aria-label={t('player.nextVideo')}
          >
            <SkipForward aria-hidden fill="currentColor" />
          </Button>
        )}

        {/* シャッフル・ループ */}
        {queue.length > 1 && (
          <Button
            variant="ghost"
            size="icon"
            onClick={toggleShuffle}
            title={isShuffle ? t('player.shuffleOff') : t('player.shuffleOn')}
            aria-label={isShuffle ? t('player.shuffleOff') : t('player.shuffleOn')}
            aria-pressed={isShuffle}
          >
            <Shuffle aria-hidden />
          </Button>
        )}
        <Button
          variant="ghost"
          size="icon"
          onClick={toggleLoop}
          title={isLooping ? t('player.loopOff') : t('player.loopOn')}
          aria-label={isLooping ? t('player.loopOff') : t('player.loopOn')}
          aria-pressed={isLooping}
        >
          <Repeat aria-hidden />
        </Button>

        {/* スクリーンショット */}
        <Button
          variant="ghost"
          size="icon"
          onClick={handleScreenshot}
          title={t('player.screenshot')}
          aria-label={t('player.screenshot')}
        >
          <Camera aria-hidden />
        </Button>

        {/* キューパネルトグル */}
        {queue.length > 0 && (
          <Button
            variant="ghost"
            size="icon"
            onClick={toggleQueuePanel}
            title={t('player.showQueue')}
            aria-label={t('player.showQueue')}
            aria-pressed={showQueuePanel}
          >
            <ListVideo aria-hidden />
          </Button>
        )}

        <Button
          variant="ghost"
          size="icon"
          onClick={toggleMiniPlayer}
          title={t('player.miniPlayer')}
          aria-label={t('player.miniPlayer')}
        >
          <PictureInPicture2 aria-hidden />
        </Button>
        <Button variant="danger-soft" onClick={quit} title={t('player.exit')}>
          <Square aria-hidden fill="currentColor" />
          {t('player.exit')}
        </Button>
      </div>
    </div>
  );
}
