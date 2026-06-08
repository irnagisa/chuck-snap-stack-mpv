import { useEffect, useRef, useState } from 'react';
import { useShallow } from 'zustand/shallow';
import { usePlayerStore } from '../../store/usePlayerStore';
import { formatTime } from '../../utils/time';

export function MiniPlayer() {
  const {
    currentVideo, playbackTime, duration, isPaused,
    queue, queueIndex, isMiniPlayer,
    pauseResume, seekTo, quit, playNext, playPrev, toggleMiniPlayer,
  } = usePlayerStore(useShallow((s) => ({
    currentVideo: s.currentVideo,
    playbackTime: s.playbackTime,
    duration: s.duration,
    isPaused: s.isPaused,
    queue: s.queue,
    queueIndex: s.queueIndex,
    isMiniPlayer: s.isMiniPlayer,
    pauseResume: s.pauseResume,
    seekTo: s.seekTo,
    quit: s.quit,
    playNext: s.playNext,
    playPrev: s.playPrev,
    toggleMiniPlayer: s.toggleMiniPlayer,
  })));

  const isDraggingSeek = useRef(false);
  const [localSeek, setLocalSeek] = useState(0);

  useEffect(() => {
    if (!isDraggingSeek.current) setLocalSeek(playbackTime);
  }, [playbackTime]);

  if (!isMiniPlayer) return null;

  const pct = duration > 0 ? (playbackTime / duration) * 100 : 0;
  const hasPrev = queue.length > 0 && queueIndex > 0;
  const hasNext = queue.length > 0 && queueIndex < queue.length - 1;
  const title = currentVideo
    ? (currentVideo.title ?? currentVideo.path.split('/').pop() ?? '')
    : '再生中の動画なし';

  return (
    <div className="flex flex-col h-screen w-screen bg-gray-900 text-white overflow-hidden select-none">
      {/* タイトル行 */}
      <div className="flex items-center gap-2 px-3 pt-3 pb-1 shrink-0">
        <span className="flex-1 text-xs text-gray-300 truncate min-w-0" title={title}>
          {title}
        </span>
        <button
          type="button"
          onClick={toggleMiniPlayer}
          className="text-gray-400 hover:text-white text-xs px-1.5 py-0.5 rounded hover:bg-gray-700 shrink-0"
          title="通常表示に戻す"
        >
          ⇲
        </button>
      </div>

      {/* シークバー */}
      <div className="px-3 pb-1 shrink-0">
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] text-gray-500 tabular-nums w-8 text-right shrink-0">
            {formatTime(localSeek)}
          </span>
          <div className="flex-1 relative h-4 flex items-center">
            <div className="absolute inset-x-0 h-1 rounded-full bg-gray-700">
              <div
                className="h-full rounded-full bg-blue-500 pointer-events-none"
                style={{ width: `${pct}%` }}
              />
            </div>
            <input
              type="range"
              className="absolute inset-x-0 w-full opacity-0 cursor-pointer h-4"
              min={0}
              max={duration > 0 ? duration : 100}
              step={0.5}
              value={localSeek}
              onChange={(e) => { isDraggingSeek.current = true; setLocalSeek(Number(e.target.value)); }}
              onMouseDown={() => { isDraggingSeek.current = true; }}
              onMouseUp={(e) => {
                isDraggingSeek.current = false;
                seekTo(Number((e.target as HTMLInputElement).value));
              }}
              onTouchStart={() => { isDraggingSeek.current = true; }}
              onTouchEnd={(e) => {
                isDraggingSeek.current = false;
                seekTo(Number((e.target as HTMLInputElement).value));
              }}
            />
          </div>
          <span className="text-[10px] text-gray-500 tabular-nums w-8 shrink-0">
            {duration > 0 ? formatTime(duration) : '--:--'}
          </span>
        </div>
      </div>

      {/* コントロールボタン */}
      <div className="flex items-center justify-center gap-1 px-3 pb-3 shrink-0">
        <button
          type="button"
          onClick={playPrev}
          disabled={!hasPrev}
          className="p-1.5 rounded hover:bg-gray-700 disabled:opacity-30 disabled:cursor-not-allowed text-gray-300"
          title="前の動画 (P)"
        >
          ⏮
        </button>
        <button
          type="button"
          onClick={pauseResume}
          className="p-1.5 rounded hover:bg-gray-700 text-white w-9 text-center"
          title={isPaused ? '再生 (Space)' : '一時停止 (Space)'}
        >
          {isPaused ? '▶' : '⏸'}
        </button>
        <button
          type="button"
          onClick={playNext}
          disabled={!hasNext}
          className="p-1.5 rounded hover:bg-gray-700 disabled:opacity-30 disabled:cursor-not-allowed text-gray-300"
          title="次の動画 (N)"
        >
          ⏭
        </button>

        <div className="flex-1" />

        {queue.length > 0 && (
          <span className="text-[10px] text-gray-500 tabular-nums">
            {queueIndex + 1}/{queue.length}
          </span>
        )}

        <button
          type="button"
          onClick={quit}
          className="p-1.5 rounded hover:bg-red-700 text-gray-400 hover:text-white text-xs ml-1"
          title="再生終了"
        >
          ✕
        </button>
      </div>
    </div>
  );
}
