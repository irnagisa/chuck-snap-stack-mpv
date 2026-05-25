import { usePlayerStore } from '../../store/usePlayerStore';

function formatTime(sec: number): string {
  const s = Math.floor(sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  if (h > 0) {
    return `${h}:${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
  }
  return `${m}:${String(ss).padStart(2, '0')}`;
}

export function PlayerControls() {
  const {
    currentVideo,
    queue,
    queueIndex,
    playbackTime,
    duration,
    isPaused,
    isLooping,
    isShuffle,
    quit,
    playNext,
    playPrev,
    pauseResume,
    seekTo,
    toggleLoop,
    toggleShuffle,
  } = usePlayerStore();

  const hasPrev = queue.length > 0 && queueIndex > 0;
  const hasNext = queue.length > 0 && queueIndex < queue.length - 1;

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    seekTo(Number(e.target.value));
  };

  // 再生前 (未選択) の場合はシャッフル・ループ設定だけ見せるミニバー
  if (!currentVideo) {
    return (
      <div className="fixed bottom-0 left-0 right-0 bg-gray-900 text-white px-4 py-2 shadow-lg border-t border-gray-700 flex items-center gap-2">
        <span className="text-xs text-gray-500 shrink-0">再生設定</span>
        <div className="w-px h-4 bg-gray-700 shrink-0" />
        <button
          type="button"
          onClick={toggleShuffle}
          className={`px-2.5 py-1 rounded text-sm shrink-0 ${isShuffle ? 'bg-blue-600 hover:bg-blue-500 text-white' : 'bg-gray-700 hover:bg-gray-600 text-gray-300'}`}
          title={isShuffle ? 'シャッフル解除' : 'シャッフル再生'}
        >
          ⇄ シャッフル
        </button>
        <button
          type="button"
          onClick={toggleLoop}
          className={`px-2.5 py-1 rounded text-sm shrink-0 ${isLooping ? 'bg-blue-600 hover:bg-blue-500 text-white' : 'bg-gray-700 hover:bg-gray-600 text-gray-300'}`}
          title={isLooping ? 'ループ解除' : 'ループ再生'}
        >
          ↻ ループ
        </button>
      </div>
    );
  }

  return (
    <div className="fixed bottom-0 left-0 right-0 bg-gray-900 text-white px-4 pt-2 pb-3 shadow-lg border-t border-gray-700 flex flex-col gap-2">
      {/* シークバー行 */}
      <div className="flex items-center gap-2">
        <span className="text-xs text-gray-400 w-10 text-right shrink-0 tabular-nums">
          {formatTime(playbackTime)}
        </span>
        <input
          type="range"
          className="flex-1 h-1.5 accent-blue-500 cursor-pointer"
          min={0}
          max={duration > 0 ? duration : 100}
          step={0.5}
          value={playbackTime}
          onChange={handleSeek}
        />
        <span className="text-xs text-gray-400 w-10 shrink-0 tabular-nums">
          {duration > 0 ? formatTime(duration) : '--:--'}
        </span>
      </div>

      {/* コントロール行 */}
      <div className="flex items-center gap-2">
        {queue.length > 0 && (
          <span className="text-xs text-gray-400 shrink-0 tabular-nums">
            {queueIndex + 1} / {queue.length}
          </span>
        )}
        <span className="flex-1 text-sm truncate text-gray-300 min-w-0">
          {currentVideo.title ?? currentVideo.path.split('/').pop()}
        </span>
        {hasPrev && (
          <button
            type="button"
            onClick={playPrev}
            className="px-2.5 py-1 bg-gray-700 hover:bg-gray-600 rounded text-sm shrink-0"
            title="前の動画 (P)"
          >
            ⏮
          </button>
        )}
        <button
          type="button"
          onClick={pauseResume}
          className="px-3 py-1 bg-gray-700 hover:bg-gray-600 rounded text-sm shrink-0 w-12 text-center"
          title={isPaused ? '再生 (Space)' : '一時停止 (Space)'}
        >
          {isPaused ? '▶' : '⏸'}
        </button>
        {hasNext && (
          <button
            type="button"
            onClick={playNext}
            className="px-2.5 py-1 bg-gray-700 hover:bg-gray-600 rounded text-sm shrink-0"
            title="次の動画 (N)"
          >
            ⏭
          </button>
        )}
        {queue.length > 1 && (
          <button
            type="button"
            onClick={toggleShuffle}
            className={`px-2.5 py-1 rounded text-sm shrink-0 ${isShuffle ? 'bg-blue-600 hover:bg-blue-500 text-white' : 'bg-gray-700 hover:bg-gray-600 text-gray-300'}`}
            title={isShuffle ? 'シャッフル解除' : 'シャッフル再生'}
          >
            ⇄
          </button>
        )}
        <button
          type="button"
          onClick={toggleLoop}
          className={`px-2.5 py-1 rounded text-sm shrink-0 ${isLooping ? 'bg-blue-600 hover:bg-blue-500 text-white' : 'bg-gray-700 hover:bg-gray-600 text-gray-300'}`}
          title={isLooping ? 'ループ解除' : 'ループ再生'}
        >
          ↻
        </button>
        <button
          type="button"
          onClick={quit}
          className="px-3 py-1 bg-red-600 hover:bg-red-500 rounded text-sm shrink-0"
          title="終了"
        >
          終了
        </button>
      </div>
    </div>
  );
}
